'use client';

import { useTranslations } from 'next-intl';
import { CircleOff, History, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { cn } from '@/lib/utils';
import { getModelIcon } from '@/lib/model-icons';
import type { SiteModelRouteType } from '@/api/endpoints/site-channel';
import { getRouteSourceTone, getRouteTypeTone } from './constants';
import {
    type SiteModelView,
    formatHistoryTime,
    routeSourceLabel,
    routeTypeLabel,
} from './utils';
import {
    getModelHistoryCount,
    getModelLastRequestAt,
    modelNeedsAttention,
} from './helpers';
import { MoveRoutePopover, SelectionCheckbox } from './controls';
import { HistorySummary } from './HistorySummary';

export function SiteChannelMobileModelCard({
    model,
    isSelected,
    isPending,
    onToggleSelection,
    onMove,
    onToggleDisabled,
    onDeleteManualModel,
    onNavigateToChannel,
}: {
    model: SiteModelView;
    isSelected: boolean;
    isPending: boolean;
    onToggleSelection: (checked: boolean) => void;
    onMove: (routeType: SiteModelRouteType) => void;
    onToggleDisabled: () => void;
    onDeleteManualModel: () => void;
    onNavigateToChannel: (channelId: number) => void;
}) {
    const t = useTranslations('siteChannel');
    const { Avatar: ModelAvatar } = getModelIcon(model.model_name);
    const historyCount = getModelHistoryCount(model);

    return (
        <article
            className={cn(
                'min-w-0 rounded-2xl border border-border/70 bg-card p-3 shadow-sm',
                isSelected && 'bg-muted/40 ring-1 ring-primary/20',
                model.disabled && 'opacity-70',
                isPending && 'pointer-events-none opacity-60',
            )}
        >
            <header className="flex min-w-0 items-start gap-2.5">
                <SelectionCheckbox
                    checked={isSelected}
                    disabled={isPending}
                    ariaLabel={t('table.selectModelAria', { name: model.model_name })}
                    onCheckedChange={onToggleSelection}
                    className="mt-1 size-5 shrink-0"
                />
                <div className="mt-0.5 shrink-0 rounded-lg border border-border/60 bg-background p-1">
                    <ModelAvatar size={24} />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 break-words text-sm font-semibold leading-5 text-foreground">{model.model_name}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {model.group_name || model.group_key}
                    </div>
                </div>
                <Badge
                    variant="outline"
                    className={cn(
                        'h-6 shrink-0 px-2 text-2xs',
                        model.disabled
                            ? 'border-destructive/30 bg-destructive/10 text-destructive'
                            : 'border-success/30 bg-success/10 text-success',
                    )}
                >
                    {model.disabled ? t('badge.disabled') : t('badge.enabled')}
                </Badge>
            </header>

            <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge variant="outline" className={cn('h-6 px-2 text-2xs', getRouteTypeTone(model.route_type))}>
                    {routeTypeLabel(model.route_type, t)}
                </Badge>
                <Badge variant="outline" className={cn('h-6 px-2 text-2xs', getRouteSourceTone(model.route_source))}>
                    {routeSourceLabel(model.route_source, t)}
                </Badge>
                {model.source === 'manual' ? (
                    <Badge variant="outline" className="h-6 border-primary/30 bg-primary/10 px-2 text-2xs text-primary">
                        {t('badge.custom')}
                    </Badge>
                ) : null}
                {modelNeedsAttention(model) ? (
                    <Badge variant="outline" className="h-6 border-warning/30 bg-warning/10 px-2 text-2xs text-warning">
                        {t('badge.attention')}
                    </Badge>
                ) : null}
            </div>

            <dl className="mt-3 grid min-w-0 grid-cols-2 gap-2 text-xs">
                <div className="min-w-0 rounded-xl bg-muted/25 px-2.5 py-2">
                    <dt className="text-muted-foreground">Key</dt>
                    <dd className="mt-0.5 font-medium text-foreground">
                        {model.enabled_key_count}/{model.key_count}
                        {!model.has_keys ? <span className="ml-1 text-warning">{t('table.missingKeyShort')}</span> : null}
                    </dd>
                </div>
                <div className="min-w-0 rounded-xl bg-muted/25 px-2.5 py-2">
                    <dt className="text-muted-foreground">{t('table.columnLastRequest')}</dt>
                    <dd className="mt-0.5 truncate font-medium text-foreground">{formatHistoryTime(getModelLastRequestAt(model), t)}</dd>
                    <div className="mt-0.5 text-2xs text-muted-foreground">{t('table.historyCount', { n: historyCount })}</div>
                </div>
                <div className="min-w-0 rounded-xl bg-muted/25 px-2.5 py-2">
                    <dt className="text-muted-foreground">{t('table.columnMapping')}</dt>
                    <dd className="mt-0.5 truncate font-medium text-foreground">{model.manual_override ? t('table.mappingManual') : t('table.mappingAuto')}</dd>
                </div>
                <div className="min-w-0 rounded-xl bg-muted/25 px-2.5 py-2">
                    <dt className="text-muted-foreground">{t('table.columnChannel')}</dt>
                    <dd className="mt-0.5">
                        {model.projected_channel_id ? (
                            <button
                                type="button"
                                onClick={() => onNavigateToChannel(model.projected_channel_id!)}
                                className="min-h-10 rounded-lg border border-border px-2 font-medium text-foreground"
                            >
                                #{model.projected_channel_id}
                            </button>
                        ) : (
                            <span className="text-muted-foreground">—</span>
                        )}
                    </dd>
                </div>
            </dl>

            <footer className="mt-3 flex items-center justify-end gap-1 border-t border-border/60 pt-2">
                <MoveRoutePopover
                    currentRouteType={model.route_type}
                    disabled={isPending || model.disabled}
                    buttonClassName="flex size-10 items-center justify-center p-0"
                    onMove={onMove}
                />
                <Popover>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className="flex size-10 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
                            aria-label={t('table.viewHistoryAria', { name: model.model_name })}
                        >
                            <History className="size-4" />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" side="top" className="w-auto rounded-2xl border border-border/70 bg-card p-0 shadow-xl">
                        <HistorySummary model={model} />
                    </PopoverContent>
                </Popover>
                {model.source === 'manual' ? (
                    <ConfirmAction
                        title={t('confirm.deleteModelTitle')}
                        description={t('confirm.deleteModelDescription', {
                            name: model.model_name,
                            group: model.group_name || model.group_key,
                        })}
                        onConfirm={onDeleteManualModel}
                        disabled={isPending}
                    >
                        <button
                            type="button"
                            disabled={isPending}
                            className="flex size-10 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                            aria-label={t('table.deleteManualModelAria', { name: model.model_name })}
                        >
                            <Trash2 className="size-4" />
                        </button>
                    </ConfirmAction>
                ) : null}
                <button
                    type="button"
                    onClick={onToggleDisabled}
                    disabled={isPending}
                    className={cn(
                        'flex size-10 items-center justify-center rounded-lg transition disabled:opacity-50',
                        model.disabled
                            ? 'text-destructive hover:bg-destructive/10'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                    aria-label={model.disabled ? t('table.enableModelAria', { name: model.model_name }) : t('table.disableModelAria', { name: model.model_name })}
                >
                    <CircleOff className="size-4" />
                </button>
            </footer>
        </article>
    );
}
