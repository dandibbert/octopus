'use client';

import { useMemo, useState } from 'react';
import {
    ArrowDownWideNarrow,
    ArrowDownZA,
    ArrowUpAZ,
    ArrowUpNarrowWide,
    Clock3,
    KeyRound,
    LayoutGrid,
    List,
    Network,
    Plus,
    RefreshCw,
    Search,
    SlidersHorizontal,
    Waypoints,
    WandSparkles,
    X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
    MorphingDialog,
    MorphingDialogTrigger,
    MorphingDialogContainer,
    MorphingDialogContent,
} from '@/components/ui/morphing-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useNavStore, type NavItem } from '@/components/modules/navbar';
import { CreateDialogContent as ChannelCreateContent } from '@/components/modules/channel/Create';
import { CreateDialogContent as GroupCreateContent } from '@/components/modules/group/Create';
import { GroupAutoGroupDialogContent } from '@/components/modules/group/AutoGroupDialog';
import { CreateDialogContent as ModelCreateContent } from '@/components/modules/model/Create';
import { AliasDialogContent } from '@/components/modules/model/AliasManager';
import { useSiteUIStore } from '@/components/modules/site/ui-store';
import { useLogUIStore } from '@/components/modules/log/ui-store';
import { LogFilterPopover } from '@/components/modules/log/FilterPopover';
import { useProxyPoolDialogStore } from '@/components/modules/proxy-pool/dialog-store';
import { useCompletionStore } from '@/components/modules/site-channel/completion-store';
import { useEffectiveChannelTab } from '@/components/modules/channel/tab-store';
import { useSiteEnabled } from '@/api/endpoints/setting';
import { useTranslations } from 'next-intl';
import { useSearchStore } from './search-store';
import { ToolbarMenu, type ToolbarAction } from './ToolbarMenu';
import {
    useToolbarViewOptionsStore,
    TOOLBAR_PAGES,
    type ToolbarPage,
    type ToolbarSortField,
    type ToolbarSortOrder,
} from './view-options-store';

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

function CreateDialogContent({ activeItem }: { activeItem: ToolbarPage }) {
    switch (activeItem) {
        case 'site':
            return null;
        case 'channel':
            return <ChannelCreateContent />;
        case 'group':
            return <GroupCreateContent />;
        case 'model':
            return <ModelCreateContent />;
        case 'log':
            return null;
    }
}

export function Toolbar() {
    const t = useTranslations('toolbar');
    const tProxyPool = useTranslations('proxyPool');
    const tModelCreate = useTranslations('model.create');
    const tModelAlias = useTranslations('model.alias');
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

    // Log actions
    const requestLogRefresh = useLogUIStore((s) => s.requestRefresh);
    const isLogRefreshing = useLogUIStore((s) => s.isRefreshing);

    // Proxy pool
    const openProxyPool = useProxyPoolDialogStore((s) => s.open);

    // Completion (for channel site tab)
    const { enabled: siteEnabled } = useSiteEnabled();
    const activeChannelTab = useEffectiveChannelTab();
    const completionPendingCount = useCompletionStore((s) => s.pendingCount);
    const openCompletionDialog = useCompletionStore((s) => s.openDialog);

    const [expandedSearchItem, setExpandedSearchItem] = useState<ToolbarPage | null>(null);
    const [viewOptionsOpen, setViewOptionsOpen] = useState(false);
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [autoGroupDialogOpen, setAutoGroupDialogOpen] = useState(false);
    const [aliasDialogOpen, setAliasDialogOpen] = useState(false);

    const searchExpanded = expandedSearchItem === toolbarItem;

    const isLogToolbar = toolbarItem === 'log';
    const showLayoutOptions = toolbarItem === 'channel' || toolbarItem === 'model';
    const showSiteSortOptions = toolbarItem === 'site';
    const showCombinedSortOptions = toolbarItem === 'channel' || toolbarItem === 'group';
    const showSortOptions = !isLogToolbar;

    // 构建工具栏按钮配置
    const actions = useMemo((): ToolbarAction[] => {
        const result: ToolbarAction[] = [];

        // 代理池入口平时挂在站点页。站点功能关闭后站点页不存在，而手动渠道
        // 仍可能使用池模式，于是入口落到渠道页，避免池配置无处管理。
        if (toolbarItem === (siteEnabled ? 'site' : 'channel')) {
            result.push({
                id: 'proxy-pool',
                icon: <Network className="size-4" />,
                label: tProxyPool('name'),
                onClick: () => openProxyPool(),
                priority: 'large', // 单个 large 项 md 以上即平铺，多个才推迟到 xl
            });
        }

        // 站点页面按钮
        if (toolbarItem === 'site') {
            result.push({
                id: 'create-site',
                icon: <Plus className="size-4" />,
                label: t('actions.createSite'),
                onClick: requestOpenCreateSite,
                priority: 'desktop', // md 以上平铺，<md 仅在"更多"菜单确实显示时折叠
            });
        }

        // 渠道页面按钮
        if (toolbarItem === 'channel') {
            // 站点渠道 tab 显示统一补全按钮
            if (activeChannelTab === 'site' && completionPendingCount > 0) {
                result.push({
                    id: 'completion',
                    icon: <KeyRound className="size-4" />,
                    label: t('actions.completionKey'),
                    onClick: openCompletionDialog,
                    badge: completionPendingCount,
                    priority: 'large', // 单个 large 项 md 以上即平铺，多个才推迟到 xl
                });
            }

            result.push({
                id: 'create-channel',
                icon: <Plus className="size-4" />,
                label: t('actions.createChannel'),
                onClick: () => setCreateDialogOpen(true),
                priority: 'desktop',
            });
        }

        // 分组页面按钮
        if (toolbarItem === 'group') {
            result.push(
                {
                    id: 'auto-group',
                    icon: <WandSparkles className="size-4" />,
                    label: t('actions.autoGroup'),
                    onClick: () => setAutoGroupDialogOpen(true),
                    priority: 'large',
                },
                {
                    id: 'create-group',
                    icon: <Plus className="size-4" />,
                    label: t('actions.createGroup'),
                    onClick: () => setCreateDialogOpen(true),
                    priority: 'desktop',
                }
            );
        }

        // 模型页面按钮
        if (toolbarItem === 'model') {
            result.push(
                {
                    id: 'model-aliases',
                    icon: <Waypoints className="size-4" />,
                    label: tModelAlias('toolbarButton'),
                    onClick: () => setAliasDialogOpen(true),
                    priority: 'large',
                },
                {
                    id: 'create-model',
                    icon: <Plus className="size-4" />,
                    label: tModelCreate('toolbarButton'),
                    onClick: () => setCreateDialogOpen(true),
                    priority: 'desktop',
                }
            );
        }

        // 日志页面按钮
        if (toolbarItem === 'log') {
            result.push({
                id: 'refresh',
                icon: <RefreshCw className={cn('size-4', isLogRefreshing && 'animate-spin')} />,
                label: t('actions.refresh'),
                onClick: requestLogRefresh,
                disabled: isLogRefreshing,
                priority: 'desktop',
            });
        }

        return result;
    }, [
        toolbarItem,
        siteEnabled,
        activeChannelTab,
        completionPendingCount,
        isLogRefreshing,
        openProxyPool,
        requestOpenCreateSite,
        openCompletionDialog,
        requestLogRefresh,
        t,
        tModelAlias,
        tModelCreate,
        tProxyPool,
    ]);

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
                {!searchExpanded && <ToolbarMenu actions={actions} />}
            </motion.div>
        </AnimatePresence>

            {/* 对话框通过 portal 渲染，统一包在隐藏容器中（display:none 不参与 flex 布局），
                避免其触发器外层 div 作为 flex 子项在工具栏右侧产生逐页不同的间隔 */}
            <div className="hidden">
                {/* 创建对话框 (channel/group/model) */}
                {toolbarItem !== 'site' && toolbarItem !== 'log' && (
                    <MorphingDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                        <MorphingDialogTrigger>
                            <button type="button" className="hidden">
                                Hidden trigger
                            </button>
                        </MorphingDialogTrigger>
                        <MorphingDialogContainer>
                            <MorphingDialogContent className="w-fit max-w-full bg-card text-card-foreground px-4 py-3 rounded-3xl custom-shadow max-h-[calc(100dvh-1rem)] flex flex-col overflow-hidden sm:px-6 sm:py-4">
                                <CreateDialogContent activeItem={toolbarItem} />
                            </MorphingDialogContent>
                        </MorphingDialogContainer>
                    </MorphingDialog>
                )}

                {/* 自动分组对话框 */}
                {toolbarItem === 'group' && (
                    <MorphingDialog open={autoGroupDialogOpen} onOpenChange={setAutoGroupDialogOpen}>
                        <MorphingDialogTrigger>
                            <button type="button" className="hidden">
                                Hidden trigger
                            </button>
                        </MorphingDialogTrigger>
                        <MorphingDialogContainer>
                            <MorphingDialogContent className="w-fit max-w-full bg-card text-card-foreground px-4 py-3 rounded-3xl custom-shadow max-h-[calc(100dvh-1rem)] flex flex-col overflow-hidden sm:px-6 sm:py-4">
                                <GroupAutoGroupDialogContent />
                            </MorphingDialogContent>
                        </MorphingDialogContainer>
                    </MorphingDialog>
                )}

                {/* 模型名称映射对话框 */}
                {toolbarItem === 'model' && (
                    <MorphingDialog open={aliasDialogOpen} onOpenChange={setAliasDialogOpen}>
                        <MorphingDialogTrigger>
                            <button type="button" className="hidden">
                                Hidden trigger
                            </button>
                        </MorphingDialogTrigger>
                        <MorphingDialogContainer>
                            <MorphingDialogContent className="w-fit max-w-full rounded-3xl bg-card px-4 py-3 text-card-foreground custom-shadow max-h-[calc(100dvh-1rem)] flex flex-col overflow-hidden sm:px-6 sm:py-4">
                                <AliasDialogContent />
                            </MorphingDialogContent>
                        </MorphingDialogContainer>
                    </MorphingDialog>
                )}
            </div>
        </>
    );
}

export { useSearchStore } from './search-store';
export { useToolbarViewOptionsStore } from './view-options-store';
