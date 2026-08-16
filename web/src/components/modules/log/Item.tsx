'use client';

import { useEffect, useMemo, useState } from 'react';
import { Clock, Zap, AlertCircle, ArrowDownToLine, ArrowUpFromLine, DollarSign, ArrowRight, ArrowDown, Send, MessageSquare, Loader2, RotateCw, ChevronDown, ChevronUp, Pin, KeyRound, CircleOff, Link } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { motion, AnimatePresence } from 'motion/react';
import JsonView from '@uiw/react-json-view';
import { githubDarkTheme } from '@uiw/react-json-view/githubDark';
import { githubLightTheme } from '@uiw/react-json-view/githubLight';
import { useTheme } from 'next-themes';
import { getLogDetail, type RelayLog, type RelayLogWSMode, type RelayLogWSExecMode, type RelayLogWSRecovery, type ChannelAttempt, type AttemptStatus, type LogSiteActionTarget as ApiLogSiteActionTarget, type LogSiteActionTargets as ApiLogSiteActionTargets } from '@/api/endpoints/log';
import { getModelIcon } from '@/lib/model-icons';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { CopyIconButton } from '@/components/common/CopyButton';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    MorphingDialog,
    MorphingDialogTrigger,
    MorphingDialogContainer,
    MorphingDialogContent,
    MorphingDialogClose,
    MorphingDialogTitle,
    MorphingDialogDescription,
    useMorphingDialog,
} from '@/components/ui/morphing-dialog';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/animate-ui/components/animate/tooltip';
import { toast } from '@/components/common/Toast';
import { useUpdateSiteChannelModelDisabled } from '@/api/endpoints/site-channel';

export type LogSiteActionTarget = ApiLogSiteActionTarget;
export type LogSiteActionTargets = ApiLogSiteActionTargets;

function formatTime(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

function formatDurationCompact(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const s = ms / 1000;
    if (s < 10) return `${s.toFixed(2)}s`;
    if (s < 100) return `${s.toFixed(1)}s`;
    return `${Math.round(s)}s`;
}

function sanitizeErrorMessage(raw: string | undefined | null): string {
    if (!raw) return '';
    let text = raw.replace(/^upstream error:\s*(\d+):\s*/i, (_m, code) => `[HTTP ${code}] `);
    if (/<\/?(html|body|head|title|div|p|h[1-6]|br|script|style)[\s>]/i.test(text)) {
        const titleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const h1Match = text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        const summarySource = titleMatch?.[1] || h1Match?.[1] || '';
        const summary = summarySource
            ? summarySource.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
            : '(HTML response)';
        const stripped = text
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/\s+/g, ' ')
            .trim();
        const detail = stripped.length > 500 ? `${stripped.slice(0, 500)}…` : stripped;
        text = summary && detail && detail !== summary ? `${summary} — ${detail}` : (summary || detail || '(HTML response)');
    }
    return text;
}

interface MergedAttempt extends ChannelAttempt {
    repeat: number;
    lastAttemptNum: number;
    totalDuration: number;
}

function mergeAdjacentAttempts(attempts: ChannelAttempt[]): MergedAttempt[] {
    const out: MergedAttempt[] = [];
    for (const a of attempts) {
        const last = out[out.length - 1];
        if (
            last
            && last.channel_id === a.channel_id
            && last.channel_key_id === a.channel_key_id
            && last.model_name === a.model_name
            && last.status === a.status
            && (last.msg ?? '') === (a.msg ?? '')
        ) {
            last.repeat += 1;
            last.lastAttemptNum = a.attempt_num;
            last.totalDuration += a.duration;
            continue;
        }
        out.push({
            ...a,
            repeat: 1,
            lastAttemptNum: a.attempt_num,
            totalDuration: a.duration,
        });
    }
    return out;
}

function makeDisableTargetKey(target: LogSiteActionTarget | null | undefined) {
    if (!target) return '';
    return `${target.site_id}\u0000${target.account_id}\u0000${target.group_key}\u0000${target.model_name}`;
}

function formatCompactTokenCount(value: number): string {
    if (value < 1000) return value.toLocaleString();
    // 截断到指定小数位（非四舍五入）：先放大取 floor 再缩回，1e-9 修正浮点下溢。
    const trunc = (n: number, decimals: number) => {
        const factor = 10 ** decimals;
        return (Math.floor(n * factor + 1e-9) / factor).toFixed(decimals);
    };
    if (value < 10000) return `${trunc(value / 1000, 2)}K`;
    if (value < 1000000) return `${trunc(value / 1000, 1)}K`;
    return `${trunc(value / 1000000, 2)}M`;
}

function hasCacheTokens(log: RelayLog) {
    return (log.cache_read_tokens != null && log.cache_read_tokens > 0)
        || (log.cache_write_tokens != null && log.cache_write_tokens > 0);
}

// 投影渠道命名 "站点/账号/分组-端点后缀"，Anthropic 端点后缀为 -Anthropic。
// 仅 Anthropic 端点的 input_tokens 不含 cache_read（Anthropic 原生语义），不应做减法；
// OpenAI/Gemini 等的 input_tokens 已含 cache_read。见 SiteModelRouteType 后缀映射。
function isAnthropicChannel(channelName: string): boolean {
    if (!channelName) return false;
    return /-Anthropic$/.test(channelName);
}

function getHeadlineInputTokens(log: RelayLog) {
    if (!hasCacheTokens(log)) return log.input_tokens;
    const cacheRead = log.cache_read_tokens ?? 0;
    const cacheWrite = log.cache_write_tokens ?? 0;
    // OpenAI 等语义：input 已含 cache_read（必然 input ≥ cache_read），减去命中得新输入；
    // Anthropic：input 不含 cache_read，绝不减（含恢复对话等 input ≥ cache_read 的情况）；
    // 数值兜底：input < cache_read 时即便误判为含缓存语义也不减，避免畸形上游归零。
    const dedupedInput = !isAnthropicChannel(log.channel_name) && log.input_tokens >= cacheRead
        ? log.input_tokens - cacheRead
        : log.input_tokens;
    return Math.max(0, dedupedInput + cacheWrite);
}

function getWSBadgeMeta(mode: RelayLogWSMode | null | undefined, usedWS: boolean | undefined, t: ReturnType<typeof useTranslations<'log.card'>>) {
    if (!usedWS && !mode) return null;

    switch (mode) {
        case 'continuation':
            return {
                label: t('wsContinuation'),
                className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                description: t('wsContinuationHint'),
            };
        case 'replay':
            return {
                label: t('wsReplay'),
                className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
                description: t('wsReplayHint'),
            };
        case 'fresh':
        default:
            return {
                label: t('ws'),
                className: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
                description: t('wsFreshHint'),
            };
    }
}

function getWSExecBadgeMeta(mode: RelayLogWSExecMode | null | undefined, t: ReturnType<typeof useTranslations<'log.card'>>) {
    switch (mode) {
        case 'passthrough':
            return {
                label: t('wsPassthrough'),
                className: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
                description: t('wsPassthroughHint'),
            };
        case 'transform':
            return {
                label: t('wsTransform'),
                className: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
                description: t('wsTransformHint'),
            };
        default:
            return null;
    }
}

function getWSRecoveryBadgeMeta(recovery: RelayLogWSRecovery | null | undefined, t: ReturnType<typeof useTranslations<'log.card'>>) {
    switch (recovery) {
        case 'reconnect':
            return {
                label: t('wsReconnect'),
                className: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
                description: t('wsReconnectHint'),
            };
        case 'replay':
            return {
                label: t('wsReplayRecovery'),
                className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
                description: t('wsReplayRecoveryHint'),
            };
        case 'downgrade':
            return {
                label: t('wsDowngrade'),
                className: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
                description: t('wsDowngradeHint'),
            };
        default:
            return null;
    }
}

function getAttemptStatusMeta(status: AttemptStatus, t: ReturnType<typeof useTranslations<'log.card'>>) {
    switch (status) {
        case 'success':
            return {
                label: t('success'),
                badgeClassName: 'bg-primary/15 text-primary',
                containerClassName: 'bg-primary/5 border-primary/20 hover:bg-primary/10',
                messageClassName: 'text-primary/90 border-primary/30',
            };
        case 'skipped':
            return {
                label: t('skipped'),
                badgeClassName: 'bg-muted text-muted-foreground',
                containerClassName: 'bg-muted/40 border-border/60 hover:bg-muted/60',
                messageClassName: 'text-muted-foreground border-border/50',
            };
        case 'circuit_break':
            return {
                label: t('circuitBreak'),
                badgeClassName: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
                containerClassName: 'bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/10',
                messageClassName: 'text-amber-700 dark:text-amber-300 border-amber-500/30',
            };
        case 'failed':
        default:
            return {
                label: t('failed'),
                badgeClassName: 'bg-destructive/15 text-destructive',
                containerClassName: 'bg-destructive/5 border-destructive/20 hover:bg-destructive/10',
                messageClassName: 'text-destructive/90 border-destructive/30',
            };
    }
}

type LogCardTranslator = ReturnType<typeof useTranslations<'log.card'>>;

function formatLedgerAmount(value: number): string {
    if (!Number.isFinite(value)) return '—';
    const formatted = new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 12,
        useGrouping: false,
    }).format(value);
    return `$${formatted}`;
}

function hasBillingDiagnostics(log: RelayLog): boolean {
    return Boolean(
        log.billing_basis
        || log.billing_class_id
        || log.billing_resolution_method
        || log.billing_price_source
        || log.billing_price_version
        || log.billing_price_mode
        || log.billing_cost_status,
    );
}

function getLedgerAmountLabel(
    amount: number | undefined,
    status: string | undefined,
    recorded: boolean,
    allowLegacyAmount: boolean,
    t: LogCardTranslator,
): string {
    if (!recorded) {
        return allowLegacyAmount && amount != null ? formatLedgerAmount(amount) : '—';
    }
    if (status === 'free') return t('billingFreeAmount');
    if (status === 'unknown' || status === 'conflict' || amount == null) {
        return t('billingAmountUnavailable');
    }
    return formatLedgerAmount(amount);
}

function getBillingBasisLabel(basis: RelayLog['billing_basis'], t: LogCardTranslator): string {
    switch (basis) {
        case 'actual':
            return t('billingBasisActual');
        case 'requested':
            return t('billingBasisRequested');
        case 'routed':
            return t('billingBasisRouted');
        case 'fixed_sku':
            return t('billingBasisFixedSku');
        default:
            return '—';
    }
}

function getPriceModeLabel(mode: RelayLog['billing_price_mode'], t: LogCardTranslator): string {
    switch (mode) {
        case 'explicit':
            return t('billingPriceModeExplicit');
        case 'free':
            return t('billingPriceModeFree');
        case 'inherited':
            return t('billingPriceModeInherited');
        case 'unknown':
            return t('billingPriceModeUnknown');
        default:
            return '—';
    }
}

function getPriceSourceLabel(source: string | undefined, t: LogCardTranslator): string {
    switch (source) {
        case 'user':
            return t('billingSourceUser');
        case 'remote':
            return t('billingSourceRemote');
        case 'builtin':
            return t('billingSourceBuiltin');
        case 'auto':
            return t('billingSourceAuto');
        default:
            return source || '—';
    }
}

function getPriceResolutionMethodLabel(method: string | undefined, status: string | undefined, t: LogCardTranslator): string {
    switch (method) {
        case 'route_fallback':
            return status === 'unknown'
                ? t('billingMethodRouteFallbackUnknown')
                : t('billingMethodRouteFallback');
        case 'route_binding':
            return t('billingMethodRouteBinding');
        case 'fixed_sku':
            return t('billingMethodFixedSku');
        case 'actual_pending':
            return t('billingMethodActualPending');
        case 'actual_override':
            return t('billingMethodActualOverride');
        case 'exact':
            return t('billingMethodExact');
        case 'provider_prefix':
            return t('billingMethodProviderPrefix');
        case 'channel_wrapper':
            return t('billingMethodChannelWrapper');
        case 'channel_alias':
            return t('billingMethodChannelAlias');
        case 'provider_alias':
            return t('billingMethodProviderAlias');
        case 'alias':
            return t('billingMethodAlias');
        case 'catalog':
            return t('billingMethodCatalog');
        case 'unknown':
            return t('billingMethodUnknown');
        default:
            // 未知扩展值保留原始标识，避免前端吞掉后端新增的诊断信息。
            return method || '—';
    }
}

function getBillingStatusMeta(status: string | undefined, recorded: boolean, t: LogCardTranslator) {
    if (!recorded) {
        return {
            label: t('billingStatusNotRecorded'),
            className: 'bg-muted text-muted-foreground',
        };
    }

    switch (status) {
        case 'resolved':
            return {
                label: t('billingStatusResolved'),
                className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
            };
        case 'free':
            return {
                label: t('billingStatusFree'),
                className: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
            };
        case 'unknown':
            return {
                label: t('billingStatusUnknown'),
                className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
            };
        case 'conflict':
            return {
                label: t('billingStatusConflict'),
                className: 'bg-destructive/15 text-destructive',
            };
        default:
            return {
                label: status || t('billingStatusNotRecorded'),
                className: 'bg-muted text-muted-foreground',
            };
    }
}

interface PriceLedgerCardProps {
    title: string;
    amount?: number;
    status?: string;
    basis?: RelayLog['billing_basis'];
    sku?: string;
    method?: string;
    source?: string;
    version?: string;
    mode?: RelayLog['billing_price_mode'];
    kind: 'billing' | 'provider';
    t: LogCardTranslator;
}

function PriceLedgerCard({
    title,
    amount,
    status,
    basis,
    sku,
    method,
    source,
    version,
    mode,
    kind,
    t,
}: PriceLedgerCardProps) {
    const recorded = Boolean(status || basis || sku || method || source || version || mode);
    const statusMeta = getBillingStatusMeta(status, recorded, t);
    // 历史用户账本在诊断字段引入前已经持久化 cost，可以继续展示；Provider
    // 的历史默认值却是 0，缺少 status 时不能把它误报成真实的上游成本。
    const amountRecorded = kind === 'provider' ? Boolean(status) : recorded;
    const amountLabel = getLedgerAmountLabel(amount, status, amountRecorded, kind === 'billing', t);
    const localizedSource = getPriceSourceLabel(source, t);
    const sourceLabel = source
        ? (version ? `${localizedSource} · ${version}` : localizedSource)
        : '—';

    return (
        <div className="min-w-0 rounded-xl border border-border/60 bg-background/50 p-3">
            <div className="mb-3 flex min-w-0 items-start gap-2">
                <div className={cn(
                    'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg',
                    kind === 'billing'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
                )}>
                    {kind === 'billing' ? <DollarSign className="size-4" /> : <ArrowUpFromLine className="size-4" />}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-foreground">{title}</span>
                        <Badge className={cn('h-5 border-0 px-1.5 text-[10px] shadow-none', statusMeta.className)}>
                            {statusMeta.label}
                        </Badge>
                    </div>
                    <div className={cn(
                        'mt-0.5 break-words text-base font-semibold tabular-nums md:truncate',
                        status === 'unknown' && 'text-amber-700 dark:text-amber-300',
                        status === 'conflict' && 'text-destructive',
                        status !== 'unknown' && status !== 'conflict' && 'text-foreground',
                    )} title={amountLabel}>
                        {amountLabel}
                    </div>
                </div>
            </div>

            <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-2">
                {kind === 'billing' ? (
                    <div className="flex min-w-0 items-baseline gap-1.5">
                        <dt className="shrink-0 text-muted-foreground">{t('billingBasisLabel')}</dt>
                        <dd className="min-w-0 break-words text-foreground md:truncate" title={basis || ''}>{getBillingBasisLabel(basis, t)}</dd>
                    </div>
                ) : null}
                <div className="flex min-w-0 items-baseline gap-1.5">
                    <dt className="shrink-0 text-muted-foreground">{t('billingSkuLabel')}</dt>
                    <dd className="min-w-0 break-all font-mono text-foreground md:truncate" title={sku || ''}>{sku || '—'}</dd>
                </div>
                <div className="flex min-w-0 items-baseline gap-1.5">
                    <dt className="shrink-0 text-muted-foreground">{t('billingMethodLabel')}</dt>
                    <dd className="min-w-0 break-words text-foreground md:truncate" title={method || ''}>
                        {getPriceResolutionMethodLabel(method, status, t)}
                    </dd>
                </div>
                <div className="flex min-w-0 items-baseline gap-1.5">
                    <dt className="shrink-0 text-muted-foreground">{t('billingSourceLabel')}</dt>
                    <dd className="min-w-0 break-words text-foreground md:truncate" title={sourceLabel}>{sourceLabel}</dd>
                </div>
                {kind === 'billing' ? (
                    <div className="flex min-w-0 items-baseline gap-1.5">
                        <dt className="shrink-0 text-muted-foreground">{t('billingModeLabel')}</dt>
                        <dd className="min-w-0 break-words text-foreground md:truncate" title={mode || ''}>{getPriceModeLabel(mode, t)}</dd>
                    </div>
                ) : null}
            </dl>
        </div>
    );
}

interface RetryBadgeWithTooltipProps {
    channelName: string;
    brandColor: string;
    attempts: ChannelAttempt[];
}

function RetryBadgeWithTooltip({ channelName, brandColor, attempts }: RetryBadgeWithTooltipProps) {
    const t = useTranslations('log.card');
    const merged = useMemo(() => mergeAdjacentAttempts(attempts), [attempts]);

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Badge
                    variant="secondary"
                    className="shrink-0 text-xs px-1.5 py-0 cursor-help"
                    style={{ backgroundColor: `${brandColor}15`, color: brandColor }}
                >
                    <RotateCw className="size-3 mr-1 opacity-80" />
                    {channelName}
                </Badge>
            </TooltipTrigger>
            <TooltipContent className="border bg-card p-2 min-w-[280px] shadow-sm rounded-3xl flex flex-col gap-1">
                {merged.map((attempt, idx) => {
                    const statusMeta = getAttemptStatusMeta(attempt.status, t);

                    return (
                        <div key={idx} className="flex flex-col w-full">
                            <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors">
                                <Badge
                                    className={cn(
                                        'h-5 shrink-0 px-1.5 text-[10px] font-bold uppercase shadow-none border-0',
                                        statusMeta.badgeClassName,
                                    )}
                                >
                                    {statusMeta.label}
                                </Badge>
                                <div className="flex min-w-0 flex-col flex-1">
                                    <span className="truncate text-xs font-semibold text-foreground">
                                        {attempt.channel_name}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground">
                                        {attempt.model_name} • {formatDuration(attempt.totalDuration)}
                                    </span>
                                </div>
                                {attempt.repeat > 1 ? (
                                    <Badge variant="outline" className="shrink-0 h-5 px-1.5 text-[10px] font-semibold tabular-nums">
                                        ×{attempt.repeat}
                                    </Badge>
                                ) : null}
                            </div>
                            {idx < merged.length - 1 ? (
                                <div className="flex justify-center py-0.5">
                                    <ArrowDown className="size-3 text-muted-foreground/30" />
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </TooltipContent>
        </Tooltip>
    );
}

function WSModeBadge({ log }: { log: RelayLog }) {
    const t = useTranslations('log.card');
    const modeMeta = getWSBadgeMeta(log.ws_mode, log.used_ws, t);
    const execMeta = getWSExecBadgeMeta(log.ws_exec_mode, t);
    const recoveryMeta = getWSRecoveryBadgeMeta(log.ws_recovery, t);

    if (!modeMeta && !execMeta && !recoveryMeta) return null;

    return (
        <div className="flex items-center gap-1.5 shrink-0">
            {modeMeta ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Badge
                            variant="secondary"
                            className={cn('shrink-0 gap-1 px-1.5 py-0 text-xs', modeMeta.className)}
                        >
                            <Link className="size-3.5 shrink-0" />
                            {modeMeta.label}
                        </Badge>
                    </TooltipTrigger>
                    <TooltipContent>{modeMeta.description}</TooltipContent>
                </Tooltip>
            ) : null}
            {execMeta ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Badge
                            variant="secondary"
                            className={cn('shrink-0 gap-1 px-1.5 py-0 text-xs', execMeta.className)}
                        >
                            <Link className="size-3.5 shrink-0" />
                            {execMeta.label}
                        </Badge>
                    </TooltipTrigger>
                    <TooltipContent>{execMeta.description}</TooltipContent>
                </Tooltip>
            ) : null}
            {recoveryMeta ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Badge
                            variant="secondary"
                            className={cn('shrink-0 gap-1 px-1.5 py-0 text-xs', recoveryMeta.className)}
                        >
                            <RotateCw className="size-3.5 shrink-0" />
                            {recoveryMeta.label}
                        </Badge>
                    </TooltipTrigger>
                    <TooltipContent>{recoveryMeta.description}</TooltipContent>
                </Tooltip>
            ) : null}
        </div>
    );
}

function DeferredJsonContent({ content, fallbackText, isLoading }: { content: string | undefined; fallbackText: string; isLoading?: boolean }) {
    const { resolvedTheme } = useTheme();
    const { isOpen } = useMorphingDialog();
    const [shouldRender, setShouldRender] = useState(false);

    const parsed = useMemo(() => {
        if (!content) return { isJson: false, data: null };
        try {
            return { isJson: true, data: JSON.parse(content) };
        } catch {
            return { isJson: false, data: content };
        }
    }, [content]);

    useEffect(() => {
        if (isOpen) {
            const timer = setTimeout(() => setShouldRender(true), 300);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    if (!isOpen) {
        if (shouldRender) setShouldRender(false);
        return null;
    }

    if (!content) {
        return (
            <pre className="p-4 text-xs text-muted-foreground whitespace-pre-wrap wrap-break-word leading-relaxed">
                {isLoading ? 'Loading…' : fallbackText}
            </pre>
        );
    }

    return (
        <AnimatePresence mode="wait">
            {!shouldRender ? (
                <motion.div
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="p-4 flex items-center justify-center h-full"
                >
                    <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
                </motion.div>
            ) : parsed.isJson ? (
                <motion.div
                    key="json"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="p-4"
                >
                    <JsonView
                        value={parsed.data as object}
                        style={{
                            ...(resolvedTheme === 'dark' ? githubDarkTheme : githubLightTheme),
                            fontSize: '12px',
                            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                            backgroundColor: 'transparent',
                        }}
                        displayDataTypes={false}
                        displayObjectSize={false}
                        collapsed={false}
                    />
                </motion.div>
            ) : (
                <motion.pre
                    key="text"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="p-4 text-xs text-muted-foreground whitespace-pre-wrap wrap-break-word font-mono leading-relaxed"
                >
                    {content}
                </motion.pre>
            )}
        </AnimatePresence>
    );
}

function AttemptDisableButton({
    target,
    pending,
    onDisable,
}: {
    target: LogSiteActionTarget | null;
    pending: boolean;
    onDisable: (target: LogSiteActionTarget) => void;
}) {
    const t = useTranslations('log.card');

    if (!target?.can_disable_model) return null;

    const tooltipLabel = target.model_disabled
        ? t('disabled')
        : pending
            ? t('disabling')
            : t('disableModel');

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    disabled={pending || target.model_disabled}
                    onClick={() => onDisable(target)}
                    className={cn(
                        'inline-flex size-7 items-center justify-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-60',
                        target.model_disabled
                            ? 'text-destructive hover:bg-destructive/10'
                            : 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
                    )}
                >
                    {pending ? (
                        <Loader2 className="size-4 animate-spin" />
                    ) : (
                        <CircleOff className="size-4" />
                    )}
                </button>
            </TooltipTrigger>
            <TooltipContent>{tooltipLabel}</TooltipContent>
        </Tooltip>
    );
}

export function LogCard({ log, siteTargets }: { log: RelayLog; siteTargets: LogSiteActionTargets | null }) {
    const t = useTranslations('log.card');
    const sourceT = useTranslations('toolbar.popover.logFilter.source');
    const displayActualModelName = useMemo(
        () => log.actual_model_name?.trim() || log.request_model_name?.trim() || '',
        [log.actual_model_name, log.request_model_name],
    );
    const { Avatar: ModelAvatar, color: brandColor } = useMemo(
        () => getModelIcon(displayActualModelName),
        [displayActualModelName]
    );
    const requestAPIKeyName = useMemo(() => log.request_api_key_name?.trim() ?? '', [log.request_api_key_name]);
    const disableMutation = useUpdateSiteChannelModelDisabled();

    const hasError = !!log.error;
    const hasAttempts = (log.attempts?.length ?? 0) > 0;
    const hasMultipleAttempts = (log.attempts?.length ?? 0) > 1;
    const [isDiagnosticExpanded, setIsDiagnosticExpanded] = useState(false);
    const [confirmDisableOpen, setConfirmDisableOpen] = useState(false);
    const [activeDisableTarget, setActiveDisableTarget] = useState<LogSiteActionTarget | null>(null);
    const [pendingDisableKey, setPendingDisableKey] = useState<string | null>(null);
    const [detailLog, setDetailLog] = useState<RelayLog | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailRequestID, setDetailRequestID] = useState(0);

    const attemptTargets = siteTargets?.attempt_targets ?? [];
    const legacyErrorTarget = siteTargets?.legacy_error_target ?? null;
    const showDiagnosticPanel = hasError || hasAttempts;
    const diagnosticTitle = hasAttempts ? t('retryDetails') : t('errorInfo');
    const diagnosticIcon = hasAttempts ? RotateCw : AlertCircle;
    const DiagnosticIcon = diagnosticIcon;
    const displayLog = detailLog ?? log;

    useEffect(() => {
        if (detailRequestID === 0 || detailLog) return;
        let cancelled = false;
        getLogDetail(log.id)
            .then((item) => {
                if (!cancelled) setDetailLog(item);
            })
            .catch((error) => {
                if (!cancelled) {
                    toast.error(error instanceof Error ? error.message : 'Failed to load log detail');
                }
            })
            .finally(() => {
                if (!cancelled) setDetailLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [detailLog, detailRequestID, log.id]);

    const openDisableDialog = (target: LogSiteActionTarget) => {
        if (!target.can_disable_model || target.model_disabled) return;
        setActiveDisableTarget(target);
        setConfirmDisableOpen(true);
    };

    const handleConfirmDisableOpenChange = (open: boolean) => {
        if (!open && disableMutation.isPending) return;
        setConfirmDisableOpen(open);
        if (!open) {
            setActiveDisableTarget(null);
        }
    };

    const confirmDisableModel = () => {
        if (!activeDisableTarget || !activeDisableTarget.can_disable_model || activeDisableTarget.model_disabled) return;

        const target = activeDisableTarget;
        const targetKey = makeDisableTargetKey(target);
        setPendingDisableKey(targetKey);

        disableMutation.mutate(
            {
                siteId: target.site_id,
                accountId: target.account_id,
                payload: [
                    {
                        group_key: target.group_key,
                        model_name: target.model_name,
                        disabled: true,
                    },
                ],
            },
            {
                onSuccess: () => {
                    setConfirmDisableOpen(false);
                    setActiveDisableTarget(null);
                    toast.success(`已禁用 ${target.group_name} / ${target.model_name}`);
                },
                onError: (error) => {
                    toast.error(error.message);
                },
                onSettled: () => {
                    setPendingDisableKey(null);
                },
            },
        );
    };

    const isDisablePending = (target: LogSiteActionTarget | null) => {
        if (!target || !pendingDisableKey) return false;
        return pendingDisableKey === makeDisableTargetKey(target);
    };

    return (
        <TooltipProvider>
            <MorphingDialog>
                <MorphingDialogTrigger
                    onClick={() => {
                        if (!detailLog && !detailLoading) {
                            setDetailLoading(true);
                            setDetailRequestID((value) => value + 1);
                        }
                    }}
                    className={cn(
                        'rounded-3xl border bg-card w-full text-left',
                        hasError ? 'border-destructive/40' : 'border-border',
                    )}
                >
                    <div className={cn('p-4 grid grid-cols-[auto_1fr] gap-4', hasError ? 'items-start' : 'items-center')}>
                        <ModelAvatar size={40} />
                        <div className="min-w-0 flex flex-col gap-3">
                            <div className="flex items-start gap-3 min-w-0">
                                <div className="min-w-0 flex-1 md:hidden">
                                    <div className="flex min-w-0 items-start gap-2 text-sm">
                                        <span className="min-w-0 flex-1 line-clamp-2 break-all font-semibold leading-5 text-card-foreground" title={log.request_model_name}>
                                            {log.request_model_name}
                                        </span>
                                        {log.request_source && log.request_source !== 'api' ? (
                                            <Badge variant="outline" className="mt-0.5 shrink-0 px-1.5 py-0 text-[10px]">
                                                {log.request_source === 'playground'
                                                    ? sourceT('playground')
                                                    : log.request_source === 'health_check'
                                                        ? sourceT('health_check')
                                                        : log.request_source}
                                            </Badge>
                                        ) : null}
                                    </div>
                                    <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                                        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/50" />
                                        {hasMultipleAttempts ? (
                                            <RetryBadgeWithTooltip
                                                channelName={log.channel_name}
                                                brandColor={brandColor}
                                                attempts={log.attempts!}
                                            />
                                        ) : (
                                            <Badge
                                                variant="secondary"
                                                className="shrink-0 px-1.5 py-0 text-[10px]"
                                                style={{ backgroundColor: `${brandColor}15`, color: brandColor }}
                                            >
                                                {log.channel_name}
                                            </Badge>
                                        )}
                                        <span className="min-w-0 flex-1 line-clamp-1 break-all" title={displayActualModelName}>
                                            {displayActualModelName}
                                        </span>
                                        {log.attempts?.some((attempt) => attempt.sticky) ? (
                                            <Pin className="size-3.5 shrink-0 text-amber-500" />
                                        ) : null}
                                    </div>
                                    <div className="mt-2">
                                        <WSModeBadge log={log} />
                                    </div>
                                </div>
                                <div className="hidden min-w-0 flex-1 items-center gap-2 text-sm md:flex">
                                    <span className="font-semibold text-card-foreground truncate" title={log.request_model_name}>
                                        {log.request_model_name}
                                    </span>
                                    {log.request_source && log.request_source !== 'api' ? (
                                        <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
                                            {log.request_source === 'playground'
                                                ? sourceT('playground')
                                                : log.request_source === 'health_check'
                                                    ? sourceT('health_check')
                                                    : log.request_source}
                                        </Badge>
                                    ) : null}
                                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/50" />
                                    {hasMultipleAttempts ? (
                                        <RetryBadgeWithTooltip
                                            channelName={log.channel_name}
                                            brandColor={brandColor}
                                            attempts={log.attempts!}
                                        />
                                    ) : (
                                        <Badge
                                            variant="secondary"
                                            className="shrink-0 text-xs px-1.5 py-0"
                                            style={{ backgroundColor: `${brandColor}15`, color: brandColor }}
                                        >
                                            {log.channel_name}
                                        </Badge>
                                    )}
                                    <span className="text-muted-foreground truncate" title={displayActualModelName}>
                                        {displayActualModelName}
                                    </span>
                                    {log.attempts?.some((attempt) => attempt.sticky) ? (
                                        <Pin className="size-3.5 shrink-0 text-amber-500" />
                                    ) : null}
                                </div>
                                <div className="hidden md:block">
                                    <WSModeBadge log={log} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs tabular-nums text-muted-foreground lg:flex lg:flex-wrap lg:items-center lg:gap-x-8 lg:[&>div]:shrink-0 lg:[&>div]:whitespace-nowrap">
                                <div className="flex items-center gap-1.5">
                                    <Clock className="size-3.5 shrink-0" style={{ color: brandColor }} />
                                    <span>{formatTime(log.time)}</span>
                                </div>
                                {requestAPIKeyName ? (
                                    <div className="flex items-center gap-1.5">
                                        <KeyRound className="size-3.5 shrink-0 text-orange-500" />
                                        <span className="truncate" title={requestAPIKeyName}>
                                            {requestAPIKeyName}
                                        </span>
                                    </div>
                                ) : null}
                                <div className="flex items-center gap-1.5 whitespace-nowrap">
                                    <Zap className="size-3.5 shrink-0 text-amber-500" />
                                    <span>{t('duration')} {formatDurationCompact(log.ftut)} / {formatDurationCompact(log.use_time)}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <ArrowDownToLine className={cn('size-3.5 shrink-0', hasCacheTokens(log) ? 'text-sky-500' : 'text-green-500')} />
                                    <span className="flex items-center gap-1">
                                        {t('input')}
                                        <span className="tabular-nums">{getHeadlineInputTokens(log).toLocaleString()}</span>
                                        {hasCacheTokens(log) && log.cache_read_tokens != null && log.cache_read_tokens > 0 ? (
                                            <Badge
                                                variant="secondary"
                                                className="shrink-0 px-1.5 py-0 text-[11px] bg-sky-500/15 text-sky-600 dark:text-sky-400"
                                            >
                                                {formatCompactTokenCount(log.cache_read_tokens)}
                                            </Badge>
                                        ) : null}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <ArrowUpFromLine className="size-3.5 shrink-0 text-purple-500" />
                                    <span>{t('output')} {log.output_tokens.toLocaleString()}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <DollarSign className="size-3.5 shrink-0 text-emerald-500" />
                                    <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                        {t('cost')} {getLedgerAmountLabel(
                                            Number.isFinite(log.cost) ? log.cost : undefined,
                                            log.billing_cost_status,
                                            hasBillingDiagnostics(log),
                                            true,
                                            t,
                                        )}
                                    </span>
                                </div>
                            </div>
                            {hasError ? (
                                <div className="p-2.5 rounded-xl bg-destructive/10 border border-destructive/20 overflow-hidden">
                                    <p className="text-xs text-destructive line-clamp-2">{sanitizeErrorMessage(log.error)}</p>
                                </div>
                            ) : null}
                        </div>
                    </div>
                </MorphingDialogTrigger>

                <MorphingDialogContainer>
                    <MorphingDialogContent className="relative flex h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-3xl bg-card p-4 text-card-foreground md:h-[calc(100dvh-2rem)] md:w-[80vw] md:px-6 md:py-4">
                        <MorphingDialogClose className="top-4 right-5 text-muted-foreground hover:text-foreground transition-colors" />
                        <MorphingDialogTitle className="mb-3 min-w-0 pr-12 text-sm md:flex md:items-start md:gap-3 md:pr-16">
                            <div className="min-w-0 md:hidden">
                                <div className="flex min-w-0 items-start gap-2">
                                    <ModelAvatar size={28} />
                                    <span className="min-w-0 flex-1 line-clamp-2 break-all font-semibold leading-5 text-card-foreground">{log.request_model_name}</span>
                                </div>
                                <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/50" />
                                    {hasMultipleAttempts ? (
                                        <RetryBadgeWithTooltip
                                            channelName={log.channel_name}
                                            brandColor={brandColor}
                                            attempts={log.attempts!}
                                        />
                                    ) : (
                                        <Badge
                                            variant="secondary"
                                            className="shrink-0 px-1.5 py-0 text-[10px]"
                                            style={{ backgroundColor: `${brandColor}15`, color: brandColor }}
                                        >
                                            {log.channel_name}
                                        </Badge>
                                    )}
                                    <span className="min-w-0 flex-1 line-clamp-1 break-all">{displayActualModelName}</span>
                                    {log.attempts?.some((attempt) => attempt.sticky) ? (
                                        <Pin className="size-3.5 shrink-0 text-amber-500" />
                                    ) : null}
                                </div>
                                <div className="mt-2">
                                    <WSModeBadge log={log} />
                                </div>
                            </div>
                            <div className="hidden min-w-0 flex-1 items-center gap-2 md:flex">
                                <ModelAvatar size={28} />
                                <span className="font-semibold text-card-foreground truncate">{log.request_model_name}</span>
                                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/50" />
                                {hasMultipleAttempts ? (
                                    <RetryBadgeWithTooltip
                                        channelName={log.channel_name}
                                        brandColor={brandColor}
                                        attempts={log.attempts!}
                                    />
                                ) : (
                                    <Badge
                                        variant="secondary"
                                        className="shrink-0 text-xs px-1.5 py-0"
                                        style={{ backgroundColor: `${brandColor}15`, color: brandColor }}
                                    >
                                        {log.channel_name}
                                    </Badge>
                                )}
                                <span className="text-muted-foreground truncate">{displayActualModelName}</span>
                                {log.attempts?.some((attempt) => attempt.sticky) ? (
                                    <Pin className="size-3.5 shrink-0 text-amber-500" />
                                ) : null}
                            </div>
                            <div className="hidden md:block">
                                <WSModeBadge log={log} />
                            </div>
                        </MorphingDialogTitle>

                        <MorphingDialogDescription className="flex-1 min-h-0">
                            <div className="flex flex-col min-h-0 h-full gap-4">
                                {showDiagnosticPanel ? (
                                    <div
                                        className={cn(
                                            'flex-initial min-h-0 flex flex-col rounded-2xl border overflow-hidden max-h-[40%]',
                                            hasError
                                                ? 'bg-destructive/5 border-destructive/20'
                                                : 'bg-secondary/30 border-border/50',
                                        )}
                                    >
                                        <div
                                            className={cn(
                                                'flex items-center gap-2 px-3 py-2.5 shrink-0 cursor-pointer select-none hover:bg-muted/50 transition-colors',
                                                hasError && 'hover:bg-destructive/10',
                                            )}
                                            onClick={() => setIsDiagnosticExpanded(!isDiagnosticExpanded)}
                                        >
                                            <DiagnosticIcon className={cn('size-4', hasError ? 'text-destructive' : 'text-muted-foreground')} />
                                            <span className={cn('text-sm font-medium', hasError ? 'text-destructive' : 'text-secondary-foreground')}>
                                                {diagnosticTitle}
                                            </span>
                                            <div className="ml-auto flex items-center gap-2">
                                                {hasAttempts ? (
                                                    <Badge
                                                        variant="outline"
                                                        className={cn(
                                                            'text-xs border-0',
                                                            hasError
                                                                ? 'bg-destructive/10 text-destructive'
                                                                : 'bg-secondary text-secondary-foreground',
                                                        )}
                                                    >
                                                        {log.total_attempts || log.attempts!.length} {t('attempts')}
                                                    </Badge>
                                                ) : null}
                                                {isDiagnosticExpanded ? (
                                                    <ChevronUp className="size-4 text-muted-foreground" />
                                                ) : (
                                                    <ChevronDown className="size-4 text-muted-foreground" />
                                                )}
                                            </div>
                                        </div>

                                        <AnimatePresence initial={false}>
                                            {isDiagnosticExpanded ? (
                                                <motion.div
                                                    initial={{ height: 0, opacity: 0 }}
                                                    animate={{ height: 'auto', opacity: 1 }}
                                                    exit={{ height: 0, opacity: 0 }}
                                                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                                                    className="overflow-hidden flex flex-col min-h-0"
                                                >
                                                    <div className="min-h-0 flex-1 p-2">
                                                    <div className="flex h-full flex-col gap-4 overflow-auto p-1">
                                                        {hasError ? (
                                                            <div className="relative pl-1">
                                                                <div className="absolute right-0 top-0">
                                                                    <CopyIconButton
                                                                        text={log.error ?? ''}
                                                                        className="p-1 rounded-md text-destructive/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
                                                                        copyIconClassName="size-4"
                                                                        checkIconClassName="size-4"
                                                                    />
                                                                </div>
                                                                <p className="text-sm text-destructive whitespace-pre-wrap wrap-break-word pr-8 leading-relaxed">
                                                                    {sanitizeErrorMessage(log.error)}
                                                                </p>
                                                                {!hasAttempts && legacyErrorTarget ? (
                                                                    <div className="mt-3 flex justify-end">
                                                                        <AttemptDisableButton
                                                                            target={legacyErrorTarget}
                                                                            pending={isDisablePending(legacyErrorTarget)}
                                                                            onDisable={openDisableDialog}
                                                                        />
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                        ) : null}

                                                        {hasAttempts ? (
                                                            <div className="flex flex-col gap-2">
                                                                {(() => {
                                                                    const attemptsArr = log.attempts!;
                                                                    const merged: Array<MergedAttempt & { originalIndex: number }> = [];
                                                                    for (let i = 0; i < attemptsArr.length; i++) {
                                                                        const a = attemptsArr[i];
                                                                        const last = merged[merged.length - 1];
                                                                        if (
                                                                            last
                                                                            && last.channel_id === a.channel_id
                                                                            && last.channel_key_id === a.channel_key_id
                                                                            && last.model_name === a.model_name
                                                                            && last.status === a.status
                                                                            && (last.msg ?? '') === (a.msg ?? '')
                                                                        ) {
                                                                            last.repeat += 1;
                                                                            last.lastAttemptNum = a.attempt_num;
                                                                            last.totalDuration += a.duration;
                                                                            continue;
                                                                        }
                                                                        merged.push({
                                                                            ...a,
                                                                            repeat: 1,
                                                                            lastAttemptNum: a.attempt_num,
                                                                            totalDuration: a.duration,
                                                                            originalIndex: i,
                                                                        });
                                                                    }
                                                                    return merged.map((attempt, idx) => {
                                                                        const statusMeta = getAttemptStatusMeta(attempt.status, t);
                                                                        const attemptTarget = attemptTargets[attempt.originalIndex] ?? null;
                                                                        const canDisableAttempt = attempt.status === 'failed' && !!attemptTarget?.can_disable_model;
                                                                        const sanitizedMsg = sanitizeErrorMessage(attempt.msg);

                                                                        return (
                                                                            <div
                                                                                key={`${attempt.attempt_num || idx}-${attempt.channel_id}-${attempt.model_name}-${idx}`}
                                                                                className={cn(
                                                                                    'text-xs p-2.5 rounded-xl border transition-colors flex flex-col gap-2',
                                                                                    statusMeta.containerClassName,
                                                                                )}
                                                                            >
                                                                                <div className="flex items-start gap-2">
                                                                                    <Badge
                                                                                        className={cn(
                                                                                            'h-5 shrink-0 px-1.5 text-[10px] font-bold uppercase shadow-none border-0',
                                                                                            statusMeta.badgeClassName,
                                                                                        )}
                                                                                    >
                                                                                        {statusMeta.label}
                                                                                    </Badge>
                                                                                    <div className="min-w-0 flex-1">
                                                                                        <div className="flex items-center gap-2">
                                                                                            <span className="font-semibold text-foreground">
                                                                                                {attempt.channel_name}
                                                                                            </span>
                                                                                            <span className="text-muted-foreground truncate">
                                                                                                ({attempt.model_name})
                                                                                            </span>
                                                                                            {attempt.sticky ? (
                                                                                                <Pin className="size-3.5 shrink-0 text-amber-500" />
                                                                                            ) : null}
                                                                                            {attempt.repeat > 1 ? (
                                                                                                <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-semibold tabular-nums">
                                                                                                    ×{attempt.repeat}
                                                                                                </Badge>
                                                                                            ) : null}
                                                                                        </div>
                                                                                    </div>
                                                                                    <div className="ml-auto flex items-center gap-2 shrink-0">
                                                                                        <span className="text-muted-foreground tabular-nums font-mono">
                                                                                            {formatDuration(attempt.totalDuration)}
                                                                                        </span>
                                                                                        {canDisableAttempt ? (
                                                                                            <AttemptDisableButton
                                                                                                target={attemptTarget}
                                                                                                pending={isDisablePending(attemptTarget)}
                                                                                                onDisable={openDisableDialog}
                                                                                            />
                                                                                        ) : null}
                                                                                    </div>
                                                                                </div>
                                                                                {sanitizedMsg ? (
                                                                                    <div className={cn('pl-2 border-l-2 text-[11px] leading-relaxed whitespace-pre-wrap wrap-break-word', statusMeta.messageClassName)}>
                                                                                        {sanitizedMsg}
                                                                                    </div>
                                                                                ) : null}
                                                                            </div>
                                                                        );
                                                                    });
                                                                })()}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                    </div>
                                                </motion.div>
                                            ) : null}
                                        </AnimatePresence>
                                    </div>
                                ) : null}

                                <details className="group shrink-0 overflow-hidden rounded-2xl border border-border/60 bg-muted/20 text-xs">
                                    <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/35 [&::-webkit-details-marker]:hidden">
                                        <div className="min-w-0 flex-1">
                                            <div className="text-[11px] text-muted-foreground">{t('modelPath')}</div>
                                            <div
                                                className="mt-0.5 whitespace-normal break-all font-mono text-foreground md:truncate md:whitespace-nowrap"
                                                title={`${displayLog.request_model_name} → ${displayLog.routed_model_name || '—'} → ${displayLog.actual_model_name || '—'}`}
                                            >
                                                {displayLog.request_model_name} → {displayLog.routed_model_name || '—'} → {displayLog.actual_model_name || '—'}
                                            </div>
                                        </div>
                                        <div className="hidden shrink-0 items-center gap-3 text-[11px] md:flex">
                                            <span className="text-emerald-600 dark:text-emerald-400">
                                                {t('billingReceivable')} {getLedgerAmountLabel(
                                                    Number.isFinite(displayLog.cost) ? displayLog.cost : undefined,
                                                    displayLog.billing_cost_status,
                                                    hasBillingDiagnostics(displayLog),
                                                    true,
                                                    t,
                                                )}
                                            </span>
                                            <span className="text-muted-foreground">
                                                {t('providerCost')} {getLedgerAmountLabel(
                                                    displayLog.provider_cost != null && Number.isFinite(displayLog.provider_cost) ? displayLog.provider_cost : undefined,
                                                    displayLog.provider_cost_status,
                                                    hasBillingDiagnostics(displayLog),
                                                    true,
                                                    t,
                                                )}
                                            </span>
                                        </div>
                                        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                                    </summary>
                                    <div className="border-t border-border/60 p-3">
                                    <div className="mb-3 min-w-0">
                                        <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
                                            <span>{t('modelPath')}</span>
                                            {displayLog.price_estimated ? (
                                                <Badge className="h-5 border-0 bg-amber-500/15 px-1.5 text-[10px] text-amber-700 shadow-none dark:text-amber-300">
                                                    {t('billingPriceEstimated')}
                                                </Badge>
                                            ) : null}
                                            {displayLog.usage_estimated ? (
                                                <Badge className="h-5 border-0 bg-orange-500/15 px-1.5 text-[10px] text-orange-700 shadow-none dark:text-orange-300">
                                                    {t('billingUsageEstimated')}
                                                </Badge>
                                            ) : null}
                                            {displayLog.model_mismatch ? (
                                                <Badge className="h-5 border-0 bg-destructive/15 px-1.5 text-[10px] text-destructive shadow-none">
                                                    {t('billingModelMismatch')}
                                                </Badge>
                                            ) : null}
                                        </div>
                                        <div
                                            className="mt-0.5 whitespace-normal break-all font-mono text-foreground md:truncate md:whitespace-nowrap"
                                            title={`${displayLog.request_model_name} → ${displayLog.routed_model_name || '—'} → ${displayLog.actual_model_name || '—'}`}
                                        >
                                            {displayLog.request_model_name} → {displayLog.routed_model_name || '—'} → {displayLog.actual_model_name || '—'}
                                        </div>
                                        {displayLog.requested_canonical_id || displayLog.routed_canonical_id || displayLog.actual_canonical_id ? (
                                            <div
                                                className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground"
                                                title={`${displayLog.requested_canonical_id || '—'} → ${displayLog.routed_canonical_id || '—'} → ${displayLog.actual_canonical_id || '—'}`}
                                            >
                                                <Link className="size-3 shrink-0" />
                                                <span className="min-w-0 whitespace-normal break-all font-mono md:truncate md:whitespace-nowrap">
                                                    {displayLog.requested_canonical_id || '—'} → {displayLog.routed_canonical_id || '—'} → {displayLog.actual_canonical_id || '—'}
                                                </span>
                                            </div>
                                        ) : null}
                                        {displayLog.request_id ? (
                                            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                                                <span className="shrink-0">{t('requestId')}</span>
                                                <code className="min-w-0 whitespace-normal break-all md:truncate md:whitespace-nowrap" title={displayLog.request_id}>{displayLog.request_id}</code>
                                            </div>
                                        ) : null}
                                    </div>

                                    <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                                        <PriceLedgerCard
                                            title={t('billingReceivable')}
                                            amount={Number.isFinite(displayLog.cost) ? displayLog.cost : undefined}
                                            status={displayLog.billing_cost_status}
                                            basis={displayLog.billing_basis}
                                            sku={displayLog.billing_class_id}
                                            method={displayLog.billing_resolution_method}
                                            source={displayLog.billing_price_source}
                                            version={displayLog.billing_price_version}
                                            mode={displayLog.billing_price_mode}
                                            kind="billing"
                                            t={t}
                                        />
                                        <PriceLedgerCard
                                            title={t('providerCost')}
                                            amount={displayLog.provider_cost != null && Number.isFinite(displayLog.provider_cost)
                                                ? displayLog.provider_cost
                                                : undefined}
                                            status={displayLog.provider_cost_status}
                                            sku={displayLog.provider_billing_class_id}
                                            method={displayLog.provider_resolution_method}
                                            source={displayLog.provider_price_source}
                                            version={displayLog.provider_price_version}
                                            kind="provider"
                                            t={t}
                                        />
                                    </div>
                                    </div>
                                </details>

                                <div className="flex-1 min-h-0 overflow-hidden">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full min-h-0">
                                        <div className="flex flex-col rounded-2xl border border-border bg-muted/30 overflow-hidden min-h-0">
                                            <div className="flex items-center gap-2 px-3 md:px-4 py-2.5 md:py-3 border-b border-border bg-muted/50 shrink-0">
                                                <Send className="size-4 text-green-500" />
                                                <span className="text-sm font-medium text-card-foreground">{t('requestContent')}</span>
                                                <Badge variant="secondary" className="ml-auto text-xs">
                                                    {getHeadlineInputTokens(displayLog).toLocaleString()} {t('tokens')}
                                                </Badge>
                                            </div>
                                            <div className="min-h-0 flex-1 p-2">
                                                <div className="h-full min-h-0 overflow-auto">
                                                    <DeferredJsonContent content={displayLog.request_content} fallbackText={t('noRequestContent')} isLoading={detailLoading} />
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex flex-col rounded-2xl border border-border bg-muted/30 overflow-hidden min-h-0">
                                            <div className="flex items-center gap-2 px-3 md:px-4 py-2.5 md:py-3 border-b border-border bg-muted/50 shrink-0">
                                                <MessageSquare className="size-4 text-purple-500" />
                                                <span className="text-sm font-medium text-card-foreground">{t('responseContent')}</span>
                                                <Badge variant="secondary" className="ml-auto text-xs">
                                                    {displayLog.output_tokens.toLocaleString()} {t('tokens')}
                                                </Badge>
                                            </div>
                                            <div className="min-h-0 flex-1 p-2">
                                                <div className="h-full min-h-0 overflow-auto">
                                                    <DeferredJsonContent content={displayLog.response_content} fallbackText={t('noResponseContent')} isLoading={detailLoading} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </MorphingDialogDescription>

                        <div className="flex flex-wrap items-center gap-3 md:gap-4 pt-4 mt-auto text-xs text-muted-foreground shrink-0">
                            <div className="flex items-center gap-1.5">
                                <Clock className="size-3.5" style={{ color: brandColor }} />
                                <span className="tabular-nums">{formatTime(log.time)}</span>
                            </div>
                            {requestAPIKeyName ? (
                                <div className="flex min-w-0 items-center gap-1.5">
                                    <KeyRound className="size-3.5 shrink-0 text-orange-500" />
                                    <span className="truncate" title={requestAPIKeyName}>
                                        {requestAPIKeyName}
                                    </span>
                                </div>
                            ) : null}
                            <div className="flex items-center gap-1.5">
                                <Zap className="size-3.5 text-amber-500" />
                                <span>{t('duration')}: {formatDurationCompact(log.ftut)} / {formatDurationCompact(log.use_time)}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <DollarSign className="size-3.5 text-emerald-500" />
                                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                    {t('cost')}: {getLedgerAmountLabel(
                                        Number.isFinite(displayLog.cost) ? displayLog.cost : undefined,
                                        displayLog.billing_cost_status,
                                        hasBillingDiagnostics(displayLog),
                                        true,
                                        t,
                                    )}
                                </span>
                            </div>
                        </div>
                    </MorphingDialogContent>
                </MorphingDialogContainer>
            </MorphingDialog>
            {activeDisableTarget?.can_disable_model ? (
                <AlertDialog open={confirmDisableOpen} onOpenChange={handleConfirmDisableOpenChange}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>确认禁用站点模型</AlertDialogTitle>
                            <AlertDialogDescription>
                                将在 {activeDisableTarget.site_name} / {activeDisableTarget.account_name} / {activeDisableTarget.group_name} 中禁用模型 {activeDisableTarget.model_name}。
                                禁用后对应投影渠道和分组会刷新为最新状态。
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel disabled={disableMutation.isPending}>取消</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={confirmDisableModel}
                                disabled={disableMutation.isPending}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                                {disableMutation.isPending ? '禁用中...' : '确认禁用'}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            ) : null}
        </TooltipProvider>
    );
}
