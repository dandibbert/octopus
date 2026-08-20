import { useRef, useState } from 'react';
import {
    Trash2,
    CheckCircle2,
    XCircle,
    FileText,
    DollarSign,
    Clock,
    Activity,
    TrendingUp,
    Globe,
    Key
} from 'lucide-react';
import { useUpdateChannel, useDeleteChannel, type Channel, type UpdateChannelRequest } from '@/api/endpoints/channel';
import {
    MorphingDialogTitle,
    MorphingDialogDescription,
    MorphingDialogClose,
    useMorphingDialog,
} from '@/components/ui/morphing-dialog';
import { Tabs, TabsContents, TabsContent } from '@/components/animate-ui/primitives/animate/tabs';
import { type StatsMetricsFormatted } from '@/api/endpoints/stats';
import { useTranslations } from 'next-intl';
import { toast } from '@/components/common/Toast';
import { Button } from '@/components/ui/button';
import { ChannelForm, type ChannelFormData } from './Form';
import { formatMoney } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useSiteEnabled } from '@/api/endpoints/setting';
import { useJumpStore } from '@/stores/jump';
import { ChannelModelActions } from './ModelActions';

export function CardContent({ channel, stats }: { channel: Channel; stats: StatsMetricsFormatted }) {
    const { setIsOpen } = useMorphingDialog();
    const updateChannel = useUpdateChannel();
    const deleteChannel = useDeleteChannel();
    const requestJump = useJumpStore((state) => state.requestJump);
    const { enabled: siteEnabled } = useSiteEnabled();
    const [isEditing, setIsEditing] = useState(false);
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [formData, setFormData] = useState<ChannelFormData>({
        name: channel.name,
        type: channel.type,
        enabled: channel.enabled,
        base_urls: channel.base_urls?.length ? channel.base_urls : [{ url: '', delay: 0 }],
        custom_header: channel.custom_header ?? [],
        ws_mode: channel.ws_mode ?? 'inherit',
        proxy_mode: channel.proxy_mode ?? 'direct',
        proxy_config_id: channel.proxy_config_id ?? null,
        param_override: channel.param_override ?? '',
        keys: channel.keys.length > 0
            ? channel.keys.map((k) => ({
                id: k.id,
                enabled: k.enabled,
                channel_key: k.channel_key,
                status_code: k.status_code,
                last_use_time_stamp: k.last_use_time_stamp,
                total_cost: k.total_cost,
                remark: k.remark,
            }))
            : [{ enabled: true, channel_key: '', remark: '' }],
        model: channel.model,
        custom_model: channel.custom_model,
        auto_sync: channel.auto_sync,
        auto_group: channel.auto_group,
        match_regex: channel.match_regex ?? '',
        provider: channel.provider ?? '',
        model_wrappers: (channel.model_wrappers ?? []).join(', '),
        billing_basis: channel.billing_basis ?? 'actual',
        billing_class_id: channel.billing_class_id ?? '',
        billing_unknown_policy: channel.billing_unknown_policy ?? 'use_routed',
        provider_unknown_policy: channel.provider_unknown_policy ?? 'use_routed',
    });
    const t = useTranslations('channel.detail');
    const tModelActions = useTranslations('channel.model_actions');
    const tProxy = useTranslations('proxyPool');

    const currentView = isEditing ? 'editing' : 'viewing';

    const setView = (editing: boolean) => {
        setIsEditing(editing);
        // Tabs 内容切换后回到新视图起点，避免沿用详情页底部的 scrollTop。
        window.requestAnimationFrame(() => {
            scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'auto' });
        });
    };

    const baseUrlsEqual = (a: Channel['base_urls'] | undefined, b: Channel['base_urls'] | undefined) =>
        JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
    const headersEqual = (a: Channel['custom_header'] | undefined, b: Channel['custom_header'] | undefined) =>
        JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

    const handleUpdate = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const req: UpdateChannelRequest = { id: channel.id };

        // only send changed fields to avoid accidental clears
        if (formData.name !== channel.name) req.name = formData.name;
        if (formData.type !== channel.type) req.type = formData.type;
        if (formData.enabled !== channel.enabled) req.enabled = formData.enabled;
        if (!baseUrlsEqual(formData.base_urls, channel.base_urls)) {
            req.base_urls = (formData.base_urls ?? []).filter((u) => u.url.trim()).map((u) => ({
                url: u.url.trim(),
                delay: Number(u.delay || 0),
            }));
        }
        if (formData.model !== channel.model) req.model = formData.model;
        if (formData.custom_model !== channel.custom_model) req.custom_model = formData.custom_model;
        if (formData.proxy_mode === 'pool' && !formData.proxy_config_id) {
            toast.error(tProxy('selectRequired'));
            return;
        }
        if (formData.proxy_mode !== channel.proxy_mode) req.proxy_mode = formData.proxy_mode;
        if ((formData.proxy_config_id ?? null) !== (channel.proxy_config_id ?? null) || formData.proxy_mode !== channel.proxy_mode) {
            req.proxy_config_id = formData.proxy_mode === 'pool' ? formData.proxy_config_id : null;
        }
        if (formData.auto_sync !== channel.auto_sync) req.auto_sync = formData.auto_sync;
        if (formData.auto_group !== channel.auto_group) req.auto_group = formData.auto_group;
        if (formData.provider.trim() !== (channel.provider ?? '')) req.provider = formData.provider.trim();
        const nextWrappers = formData.model_wrappers.split(',').map((value) => value.trim()).filter(Boolean);
        if (JSON.stringify(nextWrappers) !== JSON.stringify(channel.model_wrappers ?? [])) req.model_wrappers = nextWrappers;
        if (formData.billing_basis !== (channel.billing_basis ?? 'actual')) req.billing_basis = formData.billing_basis;
        if (formData.billing_class_id.trim() !== (channel.billing_class_id ?? '')) req.billing_class_id = formData.billing_class_id.trim() || null;
        if (formData.billing_unknown_policy !== (channel.billing_unknown_policy ?? 'use_routed')) req.billing_unknown_policy = formData.billing_unknown_policy;
        if (formData.provider_unknown_policy !== (channel.provider_unknown_policy ?? 'use_routed')) req.provider_unknown_policy = formData.provider_unknown_policy;
        if ((formData.ws_mode ?? 'inherit') !== (channel.ws_mode ?? 'inherit')) req.ws_mode = formData.ws_mode;

        if (!headersEqual(formData.custom_header, channel.custom_header)) {
            req.custom_header = (formData.custom_header ?? [])
                .map((h) => ({ header_key: h.header_key.trim(), header_value: h.header_value, delete: h.delete === true }))
                .filter((h) => h.header_key);
        }


        const nextParamOverride = formData.param_override.trim();
        const curParamOverride = channel.param_override ?? '';
        if (nextParamOverride !== curParamOverride) {
            // Empty string means "clear" for patch semantics; backend maps it to NULL.
            req.param_override = nextParamOverride;
        }

        const nextMatchRegex = formData.match_regex.trim();
        const curMatchRegex = channel.match_regex ?? '';
        if (nextMatchRegex !== curMatchRegex) {
            // Empty string means "clear" for patch semantics; backend maps it to NULL.
            req.match_regex = nextMatchRegex;
        }

        const originalKeys = channel.keys;
        const originalByID = new Map(originalKeys.map((k) => [k.id, k]));
        const nextKeys = formData.keys ?? [];

        const nextIDs = new Set(nextKeys.filter((k) => typeof k.id === 'number').map((k) => k.id as number));
        const keys_to_delete = originalKeys.filter((k) => !nextIDs.has(k.id)).map((k) => k.id);

        const keys_to_add = nextKeys
            .filter((k) => !k.id && k.channel_key.trim())
            .map((k) => ({ enabled: k.enabled, channel_key: k.channel_key, remark: k.remark ?? '' }));

        const keys_to_update = nextKeys
            .filter((k) => typeof k.id === 'number' && originalByID.has(k.id as number))
            .map((k) => {
                const orig = originalByID.get(k.id as number)!;
                const u: { id: number; enabled?: boolean; channel_key?: string; remark?: string } = { id: k.id as number };
                if (k.enabled !== orig.enabled) u.enabled = k.enabled;
                if (k.channel_key !== orig.channel_key) u.channel_key = k.channel_key;
                if ((k.remark ?? '') !== orig.remark) u.remark = k.remark ?? '';
                return Object.keys(u).length > 1 ? u : null;
            })
            .filter((u) => u !== null) as Array<{ id: number; enabled?: boolean; channel_key?: string; remark?: string }>;

        if (keys_to_add.length > 0) req.keys_to_add = keys_to_add;
        if (keys_to_update.length > 0) req.keys_to_update = keys_to_update;
        if (keys_to_delete.length > 0) req.keys_to_delete = keys_to_delete;

        updateChannel.mutate(req, {
            onSuccess: () => {
                setIsEditing(false);
                setIsOpen(false);
            }
        });
    };

    const handleDeleteClick = () => {
        if (!isConfirmingDelete) {
            setIsConfirmingDelete(true);
            return;
        }

        setIsOpen(false);
        setTimeout(() => {
            deleteChannel.mutate(channel.id);
        }, 300);
    };

    const handleManagedSourceJump = (target: 'site' | 'site-channel') => {
        if (!channel.managed_source) return;

        setIsOpen(false);
        requestJump(
            target === 'site'
                ? {
                    kind: 'site-account',
                    siteId: channel.managed_source.site_id,
                    accountId: channel.managed_source.site_account_id,
                }
                : {
                    kind: 'site-channel-account',
                    siteId: channel.managed_source.site_id,
                    accountId: channel.managed_source.site_account_id,
                },
        );
    };

    return (
        <>
            <MorphingDialogTitle>
                <header className="mb-6 flex items-center justify-between">
                    <h2 className="text-2xl font-bold text-card-foreground">
                        {isEditing ? t('title.edit') : t('title.view')}
                    </h2>
                    {channel.managed ? (
                        <Badge variant="outline" className="ml-3 border-warning/30 bg-warning/10 text-warning">
                            {t('managed.badge')}
                        </Badge>
                    ) : null}
                    <MorphingDialogClose
                        className="relative top-0 right-0"
                        variants={{
                            initial: { opacity: 0, scale: 0.8 },
                            animate: { opacity: 1, scale: 1 },
                            exit: { opacity: 0, scale: 0.8 }
                        }}
                    />
                </header>
            </MorphingDialogTitle>

            <MorphingDialogDescription className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl p-2">
                <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-2 [-webkit-overflow-scrolling:touch]">
                <Tabs value={currentView}>
                    <TabsContents>
                        <TabsContent value="viewing" >
                            <div className="space-y-4 pb-2 lg:space-y-5">
                                {channel.managed ? (
                                    <section className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
                                        <div>
                                            {t('managed.description')}
                                        </div>
                                        {siteEnabled && channel.managed_source ? (
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="min-h-10 rounded-xl border-warning/30 bg-card/70 text-warning hover:bg-card"
                                                    onClick={() => handleManagedSourceJump('site')}
                                                >
                                                    {t('managed.viewSite')}
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="min-h-10 rounded-xl border-warning/30 bg-card/70 text-warning hover:bg-card"
                                                    onClick={() => handleManagedSourceJump('site-channel')}
                                                >
                                                    {t('managed.viewSiteChannel')}
                                                </Button>
                                            </div>
                                        ) : null}
                                    </section>
                                ) : null}

                                <dl className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                                    <div className="rounded-2xl border bg-linear-to-br from-chart-1/10 to-chart-1/5 p-3 sm:p-4">
                                        <dt className="flex items-center gap-2 mb-2 text-xs font-medium text-muted-foreground">
                                            <Activity className="size-4 text-chart-1" />
                                            {t('metrics.totalRequests')}
                                        </dt>
                                        <dd className="text-xl sm:text-2xl font-bold text-chart-1">
                                            {stats.request_count.formatted.value}
                                            <span className="text-xs font-normal ml-1 text-muted-foreground">{stats.request_count.formatted.unit}</span>
                                        </dd>
                                    </div>

                                    <div className="rounded-2xl border bg-linear-to-br from-chart-3/10 to-chart-3/5 p-3 sm:p-4">
                                        <dt className="flex items-center gap-2 mb-2 text-xs font-medium text-muted-foreground">
                                            <FileText className="size-4 text-chart-3" />
                                            {t('metrics.totalToken')}
                                        </dt>
                                        <dd className="text-xl sm:text-2xl font-bold text-chart-3">
                                            {stats.total_token.formatted.value}
                                            <span className="text-xs font-normal ml-1 text-muted-foreground">{stats.total_token.formatted.unit}</span>
                                        </dd>
                                    </div>

                                    <div className="rounded-2xl border bg-linear-to-br from-chart-5/10 to-chart-5/5 p-3 sm:p-4">
                                        <dt className="flex items-center gap-2 mb-2 text-xs font-medium text-muted-foreground">
                                            <DollarSign className="size-4 text-chart-5" />
                                            {t('metrics.totalCost')}
                                        </dt>
                                        <dd className="text-xl sm:text-2xl font-bold text-chart-5">
                                            {stats.total_cost.formatted.value}
                                            <span className="text-xs font-normal ml-1 text-muted-foreground">{stats.total_cost.formatted.unit}</span>
                                        </dd>
                                    </div>
                                </dl>

                                {/* 请求详情 */}
                                <section className="space-y-3">
                                    <h4 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                        <TrendingUp className="size-3.5" />
                                        {t('sections.requests')}
                                    </h4>
                                    <dl className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                                        <div className="rounded-2xl border bg-card p-3 sm:p-4 transition-colors hover:bg-accent/5">
                                            <dt className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
                                                <CheckCircle2 className="size-4 text-accent" />
                                                {t('metrics.successRequests')}
                                            </dt>
                                            <dd className="text-2xl font-bold text-accent">
                                                {stats.request_success.formatted.value}
                                                <span className="text-sm font-normal ml-1 text-muted-foreground">{stats.request_success.formatted.unit}</span>
                                            </dd>
                                        </div>

                                        <div className="rounded-2xl border bg-card p-3 sm:p-4 transition-colors hover:bg-accent/5">
                                            <dt className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
                                                <XCircle className="size-4 text-destructive" />
                                                {t('metrics.failedRequests')}
                                            </dt>
                                            <dd className="text-2xl font-bold text-destructive">
                                                {stats.request_failed.formatted.value}
                                                <span className="text-sm font-normal ml-1 text-muted-foreground">{stats.request_failed.formatted.unit}</span>
                                            </dd>
                                        </div>
                                    </dl>
                                </section>

                                {/* Token 使用 */}
                                <section className="space-y-3">
                                    <h4 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                        <FileText className="size-3.5" />
                                        {t('sections.tokens')}
                                    </h4>
                                    <dl className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                                        <div className="rounded-2xl border bg-card p-3 sm:p-4 transition-colors hover:bg-accent/5">
                                            <dt className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
                                                <div className="size-2 rounded-full bg-chart-1" />
                                                {t('metrics.inputToken')}
                                            </dt>
                                            <dd className="text-2xl font-bold text-card-foreground">
                                                {stats.input_token.formatted.value}
                                                <span className="text-sm font-normal ml-1 text-muted-foreground">{stats.input_token.formatted.unit}</span>
                                            </dd>
                                        </div>

                                        <div className="rounded-2xl border bg-card p-3 sm:p-4 transition-colors hover:bg-accent/5">
                                            <dt className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
                                                <div className="size-2 rounded-full bg-chart-3" />
                                                {t('metrics.outputToken')}
                                            </dt>
                                            <dd className="text-2xl font-bold text-card-foreground">
                                                {stats.output_token.formatted.value}
                                                <span className="text-sm font-normal ml-1 text-muted-foreground">{stats.output_token.formatted.unit}</span>
                                            </dd>
                                        </div>
                                    </dl>
                                </section>

                                {/* 成本详情 */}
                                <section className="space-y-3">
                                    <h4 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                        <DollarSign className="size-3.5" />
                                        {t('sections.costs')}
                                    </h4>
                                    <dl className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                                        <div className="rounded-2xl border bg-card p-3 sm:p-4 transition-colors hover:bg-accent/5">
                                            <dt className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
                                                <div className="size-2 rounded-full bg-chart-2" />
                                                {t('metrics.inputCost')}
                                            </dt>
                                            <dd className="text-2xl font-bold text-card-foreground">
                                                {stats.input_cost.formatted.value}
                                                <span className="text-sm font-normal ml-1 text-muted-foreground">{stats.input_cost.formatted.unit}</span>
                                            </dd>
                                        </div>

                                        <div className="rounded-2xl border bg-card p-3 sm:p-4 transition-colors hover:bg-accent/5">
                                            <dt className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
                                                <div className="size-2 rounded-full bg-chart-5" />
                                                {t('metrics.outputCost')}
                                            </dt>
                                            <dd className="text-2xl font-bold text-card-foreground">
                                                {stats.output_cost.formatted.value}
                                                <span className="text-sm font-normal ml-1 text-muted-foreground">{stats.output_cost.formatted.unit}</span>
                                            </dd>
                                        </div>
                                    </dl>
                                </section>

                                {/* Base URLs */}
                                <section className="space-y-3">
                                    <h4 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                        <Globe className="size-3.5" />
                                        {t('sections.baseUrls')}
                                    </h4>
                                    <div className="rounded-2xl border bg-card overflow-hidden">
                                        {channel.base_urls?.map((url, i) => (
                                            <div key={i} className="flex items-center justify-between p-3 sm:p-4 border-b last:border-0 hover:bg-accent/5 transition-colors">
                                                <div className="flex flex-col gap-1 min-w-0">
                                                    <span className="font-mono text-sm whitespace-normal break-all select-all md:truncate md:whitespace-nowrap">{url.url}</span>
                                                </div>
                                                <Badge
                                                    variant="secondary"
                                                    className={cn(
                                                        "h-5 px-1.5 text-xs",
                                                        url.delay < 300
                                                            ? "bg-success/15 text-success"
                                                            : url.delay < 1000
                                                                ? "bg-warning/15 text-warning"
                                                                : "bg-destructive/15 text-destructive"
                                                    )}
                                                >
                                                    {url.delay}ms
                                                </Badge>
                                            </div>
                                        ))}
                                        {(!channel.base_urls || channel.base_urls.length === 0) && (
                                            <div className="p-4 text-sm text-muted-foreground text-center">{t('noBaseUrls')}</div>
                                        )}
                                    </div>
                                </section>

                                {/* Keys */}
                                <section className="space-y-3">
                                    <h4 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                        <Key className="size-3.5" />
                                        {t('sections.keys')}
                                    </h4>
                                    <div className="rounded-2xl border bg-card overflow-hidden">
                                        {channel.keys?.map((key) => (
                                            <div key={key.id} className="flex items-center gap-3 p-3 sm:p-4 border-b last:border-0 hover:bg-accent/5 transition-colors">
                                                <div className={cn("size-2 shrink-0 rounded-full", key.enabled ? "bg-success" : "bg-destructive")} />

                                                <span className="font-mono text-sm truncate min-w-0 flex-1">
                                                    {key.channel_key.length > 10
                                                        ? `${key.channel_key.slice(0, 4)}...${key.channel_key.slice(-4)}`
                                                        : key.channel_key}
                                                </span>

                                                {key.remark && (
                                                    <span className="text-xs text-muted-foreground truncate max-w-24" title={key.remark}>
                                                        {key.remark}
                                                    </span>
                                                )}

                                                <div className="flex items-center gap-2 shrink-0">
                                                    {key.last_use_time_stamp > 0 && (
                                                        <span className="hidden whitespace-nowrap text-xs text-muted-foreground md:inline-block">
                                                            {new Date(key.last_use_time_stamp * 1000).toLocaleString()}
                                                        </span>
                                                    )}

                                                    {key.status_code !== 0 && (
                                                        <Badge
                                                            variant="secondary"
                                                            className={cn(
                                                                "h-5 px-1.5 text-3xs",
                                                                key.status_code === 200
                                                                    ? "bg-success/15 text-success"
                                                                    : key.status_code === 401 ||
                                                                        key.status_code === 403 ||
                                                                        key.status_code === 429 ||
                                                                        key.status_code >= 500
                                                                        ? "bg-destructive/15 text-destructive"
                                                                        : "bg-warning/15 text-warning"
                                                            )}
                                                        >
                                                            {key.status_code}
                                                        </Badge>
                                                    )}

                                                    <Badge variant="secondary" className="h-5 px-1.5 text-3xs">
                                                        {formatMoney(key.total_cost).formatted.value}
                                                        {formatMoney(key.total_cost).formatted.unit}
                                                    </Badge>
                                                </div>
                                            </div>
                                        ))}
                                        {(!channel.keys || channel.keys.length === 0) && (
                                            <div className="p-4 text-sm text-muted-foreground text-center">{t('noKeys')}</div>
                                        )}
                                    </div>
                                </section>

                                {/* 等待时间 */}
                                <dl className="rounded-2xl border bg-card p-3 sm:p-4 transition-colors hover:bg-accent/5">
                                    <dt className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
                                        <Clock className="size-4 text-primary" />
                                        {t('metrics.avgWaitTime')}
                                    </dt>
                                    <dd className="text-2xl font-bold text-primary">
                                        {stats.wait_time.formatted.value}
                                        <span className="text-sm font-normal ml-1 text-muted-foreground">{stats.wait_time.formatted.unit}</span>
                                    </dd>
                                </dl>
                            </div>

                            <section className="space-y-3 border-t border-border/60 pt-4">
                                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{tModelActions('section_title')}</h4>
                                <ChannelModelActions channel={channel} onNavigate={() => setIsOpen(false)} />
                            </section>
                        </TabsContent>

                        <TabsContent value="editing">
                            <ChannelForm
                                formData={formData}
                                onFormDataChange={setFormData}
                                onSubmit={handleUpdate}
                                isPending={updateChannel.isPending}
                                submitText={t('actions.save')}
                                pendingText={t('actions.saving')}
                                onCancel={() => setView(false)}
                                cancelText={t('actions.cancel')}
                                idPrefix="channel"
                                channelId={channel.id}
                            />
                        </TabsContent>
                    </TabsContents>
                </Tabs>
                </div>
                {/* 沿用上游的 Morph 层级：操作区属于共享描述平面，
                    但仍固定在详情滚动区之外。 */}
                {!channel.managed && !isEditing ? (
                    <div className="grid shrink-0 gap-2 border-t border-border/60 pt-3 sm:grid-cols-2">
                        <Button
                            onClick={() => (isConfirmingDelete ? setIsConfirmingDelete(false) : setView(true))}
                            variant={isConfirmingDelete ? 'secondary' : 'default'}
                            className="h-11 w-full rounded-2xl"
                        >
                            {isConfirmingDelete ? t('actions.cancel') : t('actions.edit')}
                        </Button>
                        <Button
                            onClick={handleDeleteClick}
                            disabled={deleteChannel.isPending}
                            variant="destructive"
                            className="h-11 w-full rounded-2xl"
                        >
                            <Trash2 className={`size-4 transition-transform ${isConfirmingDelete ? 'scale-110' : ''}`} />
                            {deleteChannel.isPending
                                ? t('actions.deleting')
                                : isConfirmingDelete
                                    ? t('actions.confirmDelete')
                                    : t('actions.delete')}
                        </Button>
                    </div>
                ) : null}
            </MorphingDialogDescription>
        </>
    );
}
