'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslations } from 'next-intl';
import { ArrowUpDown, CircleOff, History, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { cn } from '@/lib/utils';
import { getModelIcon } from '@/lib/model-icons';
import { useIsMobile } from '@/hooks/use-mobile';
import type { SiteModelRouteType } from '@/api/endpoints/site-channel';
import { getRouteSourceTone, getRouteTypeTone, isSupportedRouteType } from './constants';
import {
    type SiteModelView,
    formatHistoryTime,
    routeSourceLabel,
    routeTypeLabel,
} from './utils';
import type { SiteChannelTableSort, SiteChannelTableSortField } from './ui-store';
import {
    getGuessedRouteReason,
    getModelHistoryCount,
    getModelLastRequestAt,
    getUnknownRouteReason,
    makeModelKey,
    modelNeedsAttention,
} from './helpers';
import { MoveRoutePopover, SelectionCheckbox } from './controls';
import { SiteChannelMobileModelCard } from './MobileModelCard';
import { HistorySummary } from './HistorySummary';

export type SiteChannelTableHandle = { scrollToModelKey: (key: string) => void };

// 10 columns: checkbox / 模型 / 分组 / 端点格式 / 来源 / Key / 状态 / 最近请求 / 渠道 / 操作.
// Shared by the sticky header row and every body row so columns stay aligned, and
// the explicit widths drive horizontal scroll inside the min-w-[74rem] block.
const SITE_CHANNEL_GRID_TEMPLATE =
    '3rem minmax(13rem,1.4fr) minmax(10rem,1fr) 9rem 6rem 5.5rem 7.5rem 9rem 6rem 7.5rem';

// Match VirtualizedGrid: measure layout height (offsetHeight) rather than the
// transformed visual height, so animations/scale don't shrink row measurements.
const measureRowHeight = (element: Element) =>
    element instanceof HTMLElement
        ? element.offsetHeight
        : element.getBoundingClientRect().height;

export const SiteChannelTableView = forwardRef<
    SiteChannelTableHandle,
    {
        models: SiteModelView[];
        resetKey: string;
        allVisibleSelected: boolean;
        pendingModelKeys: Set<string>;
        selectedModelKeys: Set<string>;
        compactMode: boolean;
        tableSort: SiteChannelTableSort;
        highlightedModelKey: string | null;
        onToggleModelSelection: (modelKey: string, checked: boolean) => void;
        onToggleAllVisible: (checked: boolean) => void;
        onSortChange: (field: SiteChannelTableSortField) => void;
        onMoveModel: (model: SiteModelView, routeType: SiteModelRouteType) => void;
        onToggleDisabled: (model: SiteModelView) => void;
        onDeleteManualModel: (model: SiteModelView) => void;
        onNavigateToChannel: (channelId: number) => void;
    }
>(function SiteChannelTableView({
    models,
    resetKey,
    allVisibleSelected,
    pendingModelKeys,
    selectedModelKeys,
    compactMode,
    tableSort,
    highlightedModelKey,
    onToggleModelSelection,
    onToggleAllVisible,
    onSortChange,
    onMoveModel,
    onToggleDisabled,
    onDeleteManualModel,
    onNavigateToChannel,
}, ref) {
    'use no memo';

    const t = useTranslations('siteChannel');
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const isMobile = useIsMobile();

    // eslint-disable-next-line react-hooks/incompatible-library
    const rowVirtualizer = useVirtualizer({
        count: models.length,
        getScrollElement: () => scrollRef.current,
        getItemKey: (index) => makeModelKey(models[index].group_key, models[index].model_name),
        estimateSize: () => isMobile ? (compactMode ? 196 : 220) : (compactMode ? 44 : 64),
        measureElement: measureRowHeight,
        overscan: 8,
    });

    useImperativeHandle(ref, () => ({
        scrollToModelKey: (key: string) => {
            const index = models.findIndex(
                (model) => makeModelKey(model.group_key, model.model_name) === key,
            );
            if (index >= 0) {
                rowVirtualizer.scrollToIndex(index, { align: 'center' });
            }
        },
    }), [models, rowVirtualizer]);

    // Scroll back to the top whenever the filter / search / quick-filter scope changes.
    useEffect(() => {
        rowVirtualizer.scrollToIndex(0);
    }, [resetKey, rowVirtualizer]);

    // Re-estimate off-screen row heights when compact mode toggles; visible rows are
    // re-measured automatically via measureElement.
    useEffect(() => {
        rowVirtualizer.measure();
    }, [compactMode, isMobile, rowVirtualizer]);

    const renderSortHead = (field: SiteChannelTableSortField, label: string) => (
        <button
            type="button"
            onClick={() => onSortChange(field)}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
        >
            <span>{label}</span>
            <ArrowUpDown className={cn('size-3.5', tableSort.field === field && 'text-foreground')} />
        </button>
    );

    const cellPaddingClass = compactMode ? 'py-2' : 'py-3';

    if (isMobile) {
        const mobileSortLabel: Record<SiteChannelTableSortField, string> = {
            model_name: t('table.columnModel'),
            group_name: t('table.columnGroup'),
            route_type: t('table.columnRouteType'),
            last_request_at: t('table.columnLastRequest'),
        };

        return (
            <div className="h-full min-h-0 w-full p-2">
            <div
                ref={scrollRef}
                role="list"
                className="h-full w-full touch-pan-y overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]"
            >
                <div className="sticky top-0 z-20 mb-2 flex min-h-12 items-center justify-between gap-2 rounded-xl border border-border/70 bg-card/95 px-3 py-2 shadow-sm backdrop-blur">
                    <label className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                        <SelectionCheckbox
                            checked={allVisibleSelected}
                            disabled={models.length === 0}
                            ariaLabel={t('table.selectVisibleAria')}
                            onCheckedChange={onToggleAllVisible}
                            className="size-5 shrink-0"
                        />
                        <span className="truncate">{t('table.selectAllVisible', { n: models.length })}</span>
                    </label>
                    <Popover>
                        <PopoverTrigger asChild>
                            <button
                                type="button"
                                className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-border/70 bg-background px-3 text-xs font-medium text-foreground"
                            >
                                <ArrowUpDown className="size-3.5" />
                                {mobileSortLabel[tableSort.field]}
                            </button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-52 rounded-2xl border border-border/70 bg-card p-2 shadow-xl">
                            <div className="grid gap-1">
                                {(Object.entries(mobileSortLabel) as [SiteChannelTableSortField, string][]).map(([field, label]) => (
                                    <button
                                        key={field}
                                        type="button"
                                        onClick={() => onSortChange(field)}
                                        className={cn(
                                            'flex min-h-11 items-center justify-between rounded-xl px-3 text-left text-sm transition hover:bg-muted',
                                            tableSort.field === field && 'bg-muted/60 font-medium text-foreground',
                                        )}
                                    >
                                        <span>{label}</span>
                                        {tableSort.field === field ? (
                                            <span className="text-xs text-muted-foreground">{tableSort.order === 'asc' ? t('table.sortAsc') : t('table.sortDesc')}</span>
                                        ) : null}
                                    </button>
                                ))}
                            </div>
                        </PopoverContent>
                    </Popover>
                </div>

                <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                        const model = models[virtualRow.index];
                        const modelKey = makeModelKey(model.group_key, model.model_name);
                        const isPending = pendingModelKeys.has(modelKey);
                        const isSelected = selectedModelKeys.has(modelKey);

                        return (
                            <div
                                key={modelKey}
                                data-index={virtualRow.index}
                                ref={rowVirtualizer.measureElement}
                                role="listitem"
                                className={cn(
                                    'absolute left-0 w-full pb-2',
                                    highlightedModelKey === modelKey && 'rounded-2xl ring-2 ring-primary/35 ring-offset-1 ring-offset-background',
                                )}
                                style={{ top: `${virtualRow.start}px` }}
                            >
                                <SiteChannelMobileModelCard
                                    model={model}
                                    isSelected={isSelected}
                                    isPending={isPending}
                                    onToggleSelection={(checked) => onToggleModelSelection(modelKey, checked)}
                                    onMove={(routeType) => onMoveModel(model, routeType)}
                                    onToggleDisabled={() => onToggleDisabled(model)}
                                    onDeleteManualModel={() => onDeleteManualModel(model)}
                                    onNavigateToChannel={onNavigateToChannel}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>
            </div>
        );
    }

    return (
        <div
            ref={scrollRef}
            role="table"
            className="h-full w-full overflow-auto overscroll-contain"
        >
            <div className="min-w-[74rem]">
                <div
                    role="row"
                    className="sticky top-0 z-10 grid items-center gap-2 border-b border-border/70 bg-card px-4 py-2.5"
                    style={{ gridTemplateColumns: SITE_CHANNEL_GRID_TEMPLATE }}
                >
                    <div role="columnheader">
                        <SelectionCheckbox
                            checked={allVisibleSelected}
                            disabled={models.length === 0}
                            ariaLabel={t('table.selectVisibleAria')}
                            onCheckedChange={onToggleAllVisible}
                        />
                    </div>
                    <div role="columnheader">{renderSortHead('model_name', t('table.columnModel'))}</div>
                    <div role="columnheader">{renderSortHead('group_name', t('table.columnGroup'))}</div>
                    <div role="columnheader">{renderSortHead('route_type', t('table.columnRouteType'))}</div>
                    <div role="columnheader" className="text-xs font-medium text-muted-foreground">{t('table.columnSource')}</div>
                    <div role="columnheader" className="text-xs font-medium text-muted-foreground">Key</div>
                    <div role="columnheader" className="text-xs font-medium text-muted-foreground">{t('table.columnStatus')}</div>
                    <div role="columnheader">{renderSortHead('last_request_at', t('table.columnLastRequest'))}</div>
                    <div role="columnheader" className="text-xs font-medium text-muted-foreground">{t('table.columnChannel')}</div>
                    <div role="columnheader" className="text-right text-xs font-medium text-muted-foreground">{t('table.columnActions')}</div>
                </div>
                <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                        const model = models[virtualRow.index];
                        const modelKey = makeModelKey(model.group_key, model.model_name);
                        const { Avatar: ModelAvatar } = getModelIcon(model.model_name);
                        const isPending = pendingModelKeys.has(modelKey);
                        const isSelected = selectedModelKeys.has(modelKey);
                        const historyCount = getModelHistoryCount(model);

                        return (
                            <div
                                key={modelKey}
                                data-index={virtualRow.index}
                                ref={rowVirtualizer.measureElement}
                                role="row"
                                data-state={isSelected ? 'selected' : undefined}
                                className={cn(
                                    'absolute left-0 grid w-full items-center gap-2 border-b border-border/60 px-4',
                                    cellPaddingClass,
                                    isSelected && 'bg-muted/40',
                                    model.disabled && 'opacity-60',
                                    isPending && 'opacity-70',
                                    highlightedModelKey === modelKey && 'ring-2 ring-primary/35 ring-inset',
                                )}
                                style={{
                                    top: `${virtualRow.start}px`,
                                    gridTemplateColumns: SITE_CHANNEL_GRID_TEMPLATE,
                                }}
                            >
                                <div role="cell" className="min-w-0">
                                    <SelectionCheckbox
                                        checked={isSelected}
                                        disabled={isPending}
                                        ariaLabel={t('table.selectModelAria', { name: model.model_name })}
                                        onCheckedChange={(checked) => onToggleModelSelection(modelKey, checked)}
                                    />
                                </div>
                                <div role="cell" className="min-w-0">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <ModelAvatar size={18} />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex min-w-0 items-center gap-1.5">
                                                <span className="min-w-0 truncate text-sm font-medium">{model.model_name}</span>
                                                {model.source === 'manual' ? (
                                                    <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-3xs border-primary/30 bg-primary/10 text-primary">{t('badge.custom')}</Badge>
                                                ) : null}
                                            </div>
                                            {!compactMode ? (
                                                <div className="text-2xs text-muted-foreground">
                                                    {model.manual_override ? t('table.mappingManual') : t('table.mappingAuto')}
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                </div>
                                <div role="cell" className="min-w-0">
                                    <div className="max-w-[14rem] truncate text-sm">{model.group_name || model.group_key}</div>
                                </div>
                                <div role="cell" className="min-w-0">
                                    <div className="flex flex-wrap gap-1.5">
                                        <Badge variant="outline" className={cn('h-6 px-2 text-2xs', getRouteTypeTone(model.route_type))}>
                                            {routeTypeLabel(model.route_type, t)}
                                        </Badge>
                                        {!isSupportedRouteType(model.route_type) ? (
                                            <Badge
                                                variant="outline"
                                                className="h-6 px-2 text-2xs border-warning/30 bg-warning/10 text-warning"
                                                title={getUnknownRouteReason(model, t) ?? undefined}
                                            >
                                                {t('badge.needsManualRoute')}
                                            </Badge>
                                        ) : null}
                                        {isSupportedRouteType(model.route_type) && model.route_metadata?.route_guessed ? (
                                            <Badge
                                                variant="outline"
                                                className="h-6 px-2 text-2xs border-info/30 bg-info/10 text-info"
                                                title={getGuessedRouteReason(model, t) ?? undefined}
                                            >
                                                {t('badge.guessedByName')}
                                            </Badge>
                                        ) : null}
                                    </div>
                                </div>
                                <div role="cell" className="min-w-0">
                                    <Badge variant="outline" className={cn('h-6 px-2 text-2xs', getRouteSourceTone(model.route_source))}>
                                        {routeSourceLabel(model.route_source, t)}
                                    </Badge>
                                </div>
                                <div role="cell" className="min-w-0">
                                    <div className="text-sm">
                                        {model.enabled_key_count}/{model.key_count}
                                    </div>
                                    {!model.has_keys ? (
                                        <div className="text-2xs text-warning">{t('table.missingKey')}</div>
                                    ) : null}
                                </div>
                                <div role="cell" className="min-w-0">
                                    <div className="flex flex-wrap gap-1.5">
                                        {model.disabled ? (
                                            <Badge variant="outline" className="h-6 px-2 text-2xs border-destructive/30 bg-destructive/10 text-destructive">
                                                {t('badge.disabled')}
                                            </Badge>
                                        ) : (
                                            <Badge variant="outline" className="h-6 px-2 text-2xs border-success/30 bg-success/10 text-success">
                                                {t('badge.enabled')}
                                            </Badge>
                                        )}
                                        {modelNeedsAttention(model) ? (
                                            <Badge variant="outline" className="h-6 px-2 text-2xs border-warning/30 bg-warning/10 text-warning">
                                                {t('badge.attention')}
                                            </Badge>
                                        ) : null}
                                    </div>
                                </div>
                                <div role="cell" className="min-w-0">
                                    <div className="text-sm">{formatHistoryTime(getModelLastRequestAt(model), t)}</div>
                                    <div className="text-2xs text-muted-foreground">{t('table.historyCount', { n: historyCount })}</div>
                                </div>
                                <div role="cell" className="min-w-0">
                                    {model.projected_channel_id ? (
                                        <button
                                            type="button"
                                            onClick={() => onNavigateToChannel(model.projected_channel_id!)}
                                            className="inline-flex rounded-full border border-border px-2 py-1 text-xs transition hover:border-primary/30 hover:bg-primary/5"
                                        >
                                            #{model.projected_channel_id}
                                        </button>
                                    ) : (
                                        <span className="text-sm text-muted-foreground">-</span>
                                    )}
                                </div>
                                <div role="cell" className="min-w-0">
                                    <div className="flex justify-end gap-1">
                                        <MoveRoutePopover
                                            currentRouteType={model.route_type}
                                            disabled={isPending || model.disabled}
                                            onMove={(routeType) => onMoveModel(model, routeType)}
                                        />
                                        <HoverCard>
                                            <HoverCardTrigger asChild>
                                                <button
                                                    type="button"
                                                    className="rounded-lg p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                                                >
                                                    <History className="size-4" />
                                                </button>
                                            </HoverCardTrigger>
                                            <HoverCardContent
                                                side="top"
                                                align="end"
                                                className="w-auto max-w-none rounded-2xl border border-border/70 bg-card p-0 shadow-xl"
                                            >
                                                <HistorySummary model={model} />
                                            </HoverCardContent>
                                        </HoverCard>
                                        {model.source === 'manual' ? (
                                            <ConfirmAction
                                                title={t('confirm.deleteModelTitle')}
                                                description={t('confirm.deleteModelDescription', {
                                                    name: model.model_name,
                                                    group: model.group_name || model.group_key,
                                                })}
                                                onConfirm={() => onDeleteManualModel(model)}
                                                disabled={isPending}
                                            >
                                                <button
                                                    type="button"
                                                    disabled={isPending}
                                                    className="rounded-lg p-1 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                                                    title={t('table.deleteManualModelTitle')}
                                                >
                                                    <Trash2 className="size-4" />
                                                </button>
                                            </ConfirmAction>
                                        ) : null}
                                        <button
                                            type="button"
                                            onClick={() => onToggleDisabled(model)}
                                            disabled={isPending}
                                            className={cn(
                                                'rounded-lg p-1 transition',
                                                model.disabled
                                                    ? 'text-destructive hover:bg-destructive/10'
                                                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                                            )}
                                        >
                                            <CircleOff className="size-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
});
