'use client';

import { useState } from 'react';
import {
    ArrowDownWideNarrow,
    ArrowDownZA,
    ArrowUpAZ,
    ArrowUpNarrowWide,
    Clock3,
    LayoutGrid,
    List,
    Network,
    Plus,
    Search,
    SlidersHorizontal,
    X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useNavStore, type NavItem } from '@/components/modules/navbar';
import { useSiteUIStore } from '@/components/modules/site/ui-store';
import { LogFilterPopover } from '@/components/modules/log/FilterPopover';
import { useProxyPoolDialogStore } from '@/components/modules/proxy-pool/dialog-store';
import { useTranslations } from 'next-intl';
import { useSearchStore } from './search-store';
import { ToolbarMenu } from './ToolbarMenu';
import {
    useToolbarViewOptionsStore,
    TOOLBAR_PAGES,
    type ToolbarPage,
    type ToolbarSortField,
    type ToolbarSortOrder,
} from './view-options-store';

import { ChannelToolbarActions } from '../channel/ToolbarActions';
import { GroupToolbarActions } from '../group/ToolbarActions';
import { ModelToolbarActions } from '../model/ToolbarActions';
import { LogToolbarActions } from '../log/ToolbarActions';

const PAGE_ACTIONS = {
    channel: ChannelToolbarActions,
    group: GroupToolbarActions,
    model: ModelToolbarActions,
    log: LogToolbarActions,
};

type CombinedSortOption = {
    value: `${ToolbarSortField}-${ToolbarSortOrder}`;
    field: ToolbarSortField;
    order: ToolbarSortOrder;
    labelKey: string;
};

const COMBINED_SORT_OPTIONS: readonly CombinedSortOption[] = [
    { value: 'name-asc', field: 'name', order: 'asc', labelKey: 'popover.nameAsc' },
    { value: 'name-desc', field: 'name', order: 'desc', labelKey: 'popover.nameDesc' },
    { value: 'created-asc', field: 'created', order: 'asc', labelKey: 'popover.createdAsc' },
    { value: 'created-desc', field: 'created', order: 'desc', labelKey: 'popover.createdDesc' },
] as const;

const SITE_SORT_OPTIONS: readonly CombinedSortOption[] = [
    { value: 'name-asc', field: 'name', order: 'asc', labelKey: 'popover.nameAsc' },
    { value: 'name-desc', field: 'name', order: 'desc', labelKey: 'popover.nameDesc' },
    { value: 'balance-desc', field: 'balance', order: 'desc', labelKey: 'popover.balanceDesc' },
    { value: 'balance-asc', field: 'balance', order: 'asc', labelKey: 'popover.balanceAsc' },
] as const;

function isToolbarPage(item: NavItem): item is ToolbarPage {
    return (TOOLBAR_PAGES as readonly NavItem[]).includes(item);
}

export function Toolbar() {
    const t = useTranslations('toolbar');
    const tProxyPool = useTranslations('proxyPool');
    const { activeItem } = useNavStore();
    const toolbarItem = isToolbarPage(activeItem) ? activeItem : null;
    const searchTerm = useSearchStore((s) => (toolbarItem ? s.searchTerms[toolbarItem] || '' : ''));
    const setSearchTerm = useSearchStore((s) => s.setSearchTerm);
    const layout = useToolbarViewOptionsStore((s) => (toolbarItem ? s.getLayout(toolbarItem) : 'grid'));
    const sortField = useToolbarViewOptionsStore((s) =>
        toolbarItem === 'site' || toolbarItem === 'channel' || toolbarItem === 'group' ? s.getSortField(toolbarItem) : 'name'
    );
    const sortOrder = useToolbarViewOptionsStore((s) => (toolbarItem ? s.getSortOrder(toolbarItem) : 'asc'));
    const setLayout = useToolbarViewOptionsStore((s) => s.setLayout);
    const setSortConfig = useToolbarViewOptionsStore((s) => s.setSortConfig);
    const setSortOrder = useToolbarViewOptionsStore((s) => s.setSortOrder);

    // Site actions
    const requestOpenCreateSite = useSiteUIStore((s) => s.requestOpenCreateDialog);
    const requestOpenImportDialog = useSiteUIStore((s) => s.requestOpenImportDialog);
    const requestOpenArchivedDialog = useSiteUIStore((s) => s.requestOpenArchivedDialog);
    const requestSyncAll = useSiteUIStore((s) => s.requestSyncAll);
    const requestCheckinAll = useSiteUIStore((s) => s.requestCheckinAll);

    const openProxyPool = useProxyPoolDialogStore((s) => s.open);

    const [expandedSearchItem, setExpandedSearchItem] = useState<ToolbarPage | null>(null);
    const [viewOptionsOpen, setViewOptionsOpen] = useState(false);

    const searchExpanded = expandedSearchItem === toolbarItem;

    const isLogToolbar = toolbarItem === 'log';
    const showLayoutOptions = toolbarItem === 'channel' || toolbarItem === 'model';
    const showSiteSortOptions = toolbarItem === 'site';
    const showCombinedSortOptions = toolbarItem === 'channel' || toolbarItem === 'group';
    const showSortOptions = !isLogToolbar;

    const PageActions = toolbarItem && toolbarItem !== 'site' ? PAGE_ACTIONS[toolbarItem] : null;

    if (!toolbarItem) return null;

    return (
        <>
        <AnimatePresence mode="wait">
            <motion.div
                key="toolbar"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.2 }}
                className="flex max-w-full min-w-0 items-center gap-1 sm:gap-2"
            >
                {/* 搜索框 - 始终可见 */}
                <div
                    role="search"
                    className={cn(
                        'relative h-9 shrink-0 transition-[width] duration-200',
                        searchExpanded ? 'w-36 sm:w-44' : 'w-9',
                    )}
                >
                    {!searchExpanded ? (
                        <motion.button
                            type="button"
                            layoutId="search-box"
                            aria-label={t('search.open')}
                            title={t('search.open')}
                            onClick={() => setExpandedSearchItem(toolbarItem)}
                            className={buttonVariants({
                                variant: 'ghost',
                                size: 'icon',
                                className:
                                    'absolute inset-0 rounded-xl transition-none hover:bg-transparent text-muted-foreground hover:text-foreground',
                            })}
                        >
                            <motion.span layout="position">
                                <Search className="size-4 transition-colors duration-300" />
                            </motion.span>
                        </motion.button>
                    ) : (
                        <motion.div
                            layoutId="search-box"
                            className="absolute inset-0 flex h-9 min-w-0 items-center gap-2 rounded-xl border bg-background px-3"
                            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                        >
                            <motion.span layout="position">
                                <Search className="size-4 text-muted-foreground shrink-0" />
                            </motion.span>
                            <input
                                type="search"
                                aria-label={t('search.open')}
                                placeholder={t('search.placeholder')}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(toolbarItem, e.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Escape') {
                                        event.preventDefault();
                                        setExpandedSearchItem(null);
                                    }
                                }}
                                autoFocus
                                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                            />
                            <button
                                type="button"
                                aria-label={t('search.close')}
                                onClick={() => {
                                    setSearchTerm(toolbarItem, '');
                                    setExpandedSearchItem(null);
                                }}
                                className="p-0.5 rounded shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <X className="size-3.5" />
                            </button>
                        </motion.div>
                    )}
                </div>

                {/* 日志页面的筛选按钮 */}
                {!searchExpanded && isLogToolbar && <LogFilterPopover />}

                {/* 设置按钮 - 始终可见（除了日志页面） */}
                {!searchExpanded && !isLogToolbar && (
                    <Popover open={viewOptionsOpen} onOpenChange={setViewOptionsOpen}>
                        <PopoverTrigger asChild>
                            <button
                                type="button"
                                aria-label={t('popover.ariaLabel')}
                                className={buttonVariants({
                                    variant: 'ghost',
                                    size: 'icon',
                                    className:
                                        'rounded-xl transition-none hover:bg-transparent text-muted-foreground hover:text-foreground',
                                })}
                            >
                                <SlidersHorizontal className="size-4 transition-colors duration-300" />
                            </button>
                        </PopoverTrigger>
                        <PopoverContent
                            align="center"
                            side="bottom"
                            sideOffset={8}
                            className="w-[min(16rem,calc(100vw-1rem))] rounded-2xl border border-border/60 bg-card p-3 shadow-xl"
                        >
                            <div className="grid gap-3">
                                {showLayoutOptions && (
                                    <div className="grid gap-2">
                                        <p className="text-xs font-medium text-muted-foreground">
                                            {t('popover.layout')}
                                        </p>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setLayout(toolbarItem, 'grid')}
                                                className={cn(
                                                    'h-8 rounded-lg border text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors',
                                                    layout === 'grid'
                                                        ? 'border-primary/30 bg-primary text-primary-foreground'
                                                        : 'border-border bg-muted/20 text-foreground hover:bg-muted/30'
                                                )}
                                            >
                                                <LayoutGrid className="size-3.5" />
                                                {t('popover.grid')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setLayout(toolbarItem, 'list')}
                                                className={cn(
                                                    'h-8 rounded-lg border text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors',
                                                    layout === 'list'
                                                        ? 'border-primary/30 bg-primary text-primary-foreground'
                                                        : 'border-border bg-muted/20 text-foreground hover:bg-muted/30'
                                                )}
                                            >
                                                <List className="size-3.5" />
                                                {t('popover.list')}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {showSortOptions && (
                                    <div className="grid gap-2">
                                        <p className="text-xs font-medium text-muted-foreground">
                                            {t('popover.sort')}
                                        </p>
                                        {showSiteSortOptions ? (
                                            <div className="grid grid-cols-2 gap-2">
                                                {SITE_SORT_OPTIONS.map((option) => (
                                                    <button
                                                        key={option.value}
                                                        type="button"
                                                        onClick={() => {
                                                            const active =
                                                                sortField === option.field &&
                                                                sortOrder === option.order;
                                                            setSortConfig(
                                                                'site',
                                                                active ? 'default' : option.field,
                                                                active ? 'asc' : option.order
                                                            );
                                                        }}
                                                        className={cn(
                                                            'h-8 rounded-lg border text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors',
                                                            sortField === option.field &&
                                                                sortOrder === option.order
                                                                ? 'border-primary/30 bg-primary text-primary-foreground'
                                                                : 'border-border bg-muted/20 text-foreground hover:bg-muted/30'
                                                        )}
                                                    >
                                                        {option.field === 'balance' ? (
                                                            option.order === 'desc' ? (
                                                                <ArrowDownWideNarrow className="size-3.5" />
                                                            ) : (
                                                                <ArrowUpNarrowWide className="size-3.5" />
                                                            )
                                                        ) : option.order === 'desc' ? (
                                                            <ArrowDownZA className="size-3.5" />
                                                        ) : (
                                                            <ArrowUpAZ className="size-3.5" />
                                                        )}
                                                        {t(option.labelKey)}
                                                    </button>
                                                ))}
                                            </div>
                                        ) : showCombinedSortOptions ? (
                                            <div className="grid grid-cols-2 gap-2">
                                                {COMBINED_SORT_OPTIONS.map((option) => (
                                                    <button
                                                        key={option.value}
                                                        type="button"
                                                        onClick={() => {
                                                            if (
                                                                toolbarItem === 'channel' ||
                                                                toolbarItem === 'group'
                                                            ) {
                                                                setSortConfig(
                                                                    toolbarItem,
                                                                    option.field,
                                                                    option.order
                                                                );
                                                            }
                                                        }}
                                                        className={cn(
                                                            'h-8 rounded-lg border text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors',
                                                            sortField === option.field &&
                                                                sortOrder === option.order
                                                                ? 'border-primary/30 bg-primary text-primary-foreground'
                                                                : 'border-border bg-muted/20 text-foreground hover:bg-muted/30'
                                                        )}
                                                    >
                                                        {option.field === 'name' ? (
                                                            option.order === 'desc' ? (
                                                                <ArrowDownZA className="size-3.5" />
                                                            ) : (
                                                                <ArrowUpAZ className="size-3.5" />
                                                            )
                                                        ) : (
                                                            <Clock3 className="size-3.5" />
                                                        )}
                                                        {t(option.labelKey)}
                                                    </button>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-2 gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setSortOrder(toolbarItem, 'asc')}
                                                    className={cn(
                                                        'h-8 rounded-lg border text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors',
                                                        sortOrder === 'asc'
                                                            ? 'border-primary/30 bg-primary text-primary-foreground'
                                                            : 'border-border bg-muted/20 text-foreground hover:bg-muted/30'
                                                    )}
                                                >
                                                    <ArrowUpAZ className="size-3.5" />
                                                    {t('popover.nameAsc')}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setSortOrder(toolbarItem, 'desc')}
                                                    className={cn(
                                                        'h-8 rounded-lg border text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors',
                                                        sortOrder === 'desc'
                                                            ? 'border-primary/30 bg-primary text-primary-foreground'
                                                            : 'border-border bg-muted/20 text-foreground hover:bg-muted/30'
                                                    )}
                                                >
                                                    <ArrowDownZA className="size-3.5" />
                                                    {t('popover.nameDesc')}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* 站点页面的全局操作 */}
                                {toolbarItem === 'site' && (
                                    <div className="grid gap-2">
                                        <p className="text-xs font-medium text-muted-foreground">{t('popover.globalActions.title')}</p>
                                        <div className="grid gap-2">
                                            <button
                                                type="button"
                                                onClick={requestOpenImportDialog}
                                                className="h-8 rounded-lg border px-2 text-xs font-medium text-left transition-colors border-border bg-muted/20 text-foreground hover:bg-muted/30"
                                            >
                                                {t('popover.globalActions.importSites')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={requestSyncAll}
                                                className="h-8 rounded-lg border px-2 text-xs font-medium text-left transition-colors border-border bg-muted/20 text-foreground hover:bg-muted/30"
                                            >
                                                {t('popover.globalActions.syncAll')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={requestCheckinAll}
                                                className="h-8 rounded-lg border px-2 text-xs font-medium text-left transition-colors border-border bg-muted/20 text-foreground hover:bg-muted/30"
                                            >
                                                {t('popover.globalActions.checkinAll')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={requestOpenArchivedDialog}
                                                className="h-8 rounded-lg border px-2 text-xs font-medium text-left transition-colors border-border bg-muted/20 text-foreground hover:bg-muted/30"
                                            >
                                                {t('popover.globalActions.archivedSites')}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </PopoverContent>
                    </Popover>
                )}

                {/* 统一的工具按钮菜单（新增 + 按钮位于最右侧） */}
                {!searchExpanded && (PageActions ? <PageActions /> : <ToolbarMenu actions={[
                    { id: 'proxy-pool', icon: <Network className="size-4" />, label: tProxyPool('name'), onClick: openProxyPool, priority: 'large' },
                    { id: 'create-site', icon: <Plus className="size-4" />, label: t('actions.createSite'), onClick: requestOpenCreateSite, priority: 'desktop' },
                ]} />)}
            </motion.div>
        </AnimatePresence>

        </>
    );
}

export { useSearchStore } from './search-store';
export { useToolbarViewOptionsStore } from './view-options-store';
