'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Loader2, MessageSquareText, MoreHorizontal, Plus, RotateCcw, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Channel, ExecutionHealthResult } from '@/api/endpoints/channel';
import { useChannelModelHealth, useCreateGroupFromChannelModel } from '@/api/endpoints/channel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/components/common/Toast';
import { openPlayground } from '@/stores/playground';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/animate-ui/components/animate/tooltip';

const normalizePrefix = (value: string) => value.toLowerCase().trim().replace(/\s+/g, '-').replace(/^-+|-+$/g, '');

const automaticGroupName = (model: string, prefixEnabled: boolean, prefix: string) => {
    const normalizedPrefix = normalizePrefix(prefix);
    return prefixEnabled && normalizedPrefix ? `${normalizedPrefix}-${model}` : model;
};

const getErrorCode = (error: unknown) => {
    if (!error || typeof error !== 'object' || !('errorCode' in error)) return undefined;
    return typeof error.errorCode === 'string' ? error.errorCode : undefined;
};

const getErrorMessage = (error: unknown) => {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
    return String(error);
};

export function ChannelModelActions({ channel, onNavigate }: { channel: Channel; onNavigate?: () => void }) {
    const t = useTranslations('channel.model_actions');
    const tAttemptStatus = useTranslations('group.health.attemptStatus');
    const models = useMemo(
        () => Array.from(new Set(
            `${channel.model},${channel.custom_model}`
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean),
        )),
        [channel.model, channel.custom_model],
    );
    const createGroup = useCreateGroupFromChannelModel();
    const health = useChannelModelHealth();
    const createFormRef = useRef<HTMLDivElement>(null);
    const [creating, setCreating] = useState<string | null>(null);
    const [prefixEnabled, setPrefixEnabled] = useState(true);
    const [prefix, setPrefix] = useState(normalizePrefix(channel.name));
    const [groupName, setGroupName] = useState('');
    const [groupNameDirty, setGroupNameDirty] = useState(false);
    const [results, setResults] = useState<Record<string, ExecutionHealthResult>>({});
    const [testingModels, setTestingModels] = useState<Set<string>>(() => new Set());
    const [openMenu, setOpenMenu] = useState<string | null>(null);

    useEffect(() => {
        if (!creating) return;
        const frame = window.requestAnimationFrame(() => {
            createFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [creating]);

    const beginCreate = (model: string) => {
        const nextPrefix = normalizePrefix(channel.name);
        setPrefix(nextPrefix);
        setPrefixEnabled(true);
        setGroupName(automaticGroupName(model, true, nextPrefix));
        setGroupNameDirty(false);
        setCreating(model);
    };

    const updatePrefix = (value: string) => {
        setPrefix(value);
        if (creating && !groupNameDirty) {
            setGroupName(automaticGroupName(creating, prefixEnabled, value));
        }
    };

    const togglePrefix = (enabled: boolean) => {
        setPrefixEnabled(enabled);
        if (creating && !groupNameDirty) {
            setGroupName(automaticGroupName(creating, enabled, prefix));
        }
    };

    const restoreAutomaticName = () => {
        if (!creating) return;
        setGroupName(automaticGroupName(creating, prefixEnabled, prefix));
        setGroupNameDirty(false);
    };

    const submit = () => {
        if (!creating || !groupName.trim()) return;
        const submittedName = groupName.trim();
        createGroup.mutate(
            { channelId: channel.id, model: creating, groupName: submittedName },
            {
                onSuccess: () => {
                    toast.success(t('create_success'), { description: submittedName });
                    setCreating(null);
                },
                onError: (error) => {
                    const description = getErrorCode(error) === 'group.name_conflict'
                        ? t('name_conflict', { name: submittedName })
                        : getErrorMessage(error);
                    toast.error(t('create_failed'), { description });
                },
            },
        );
    };

    const test = async (model: string) => {
        if (testingModels.has(model)) return;
        setTestingModels((current) => new Set(current).add(model));
        try {
            // mutateAsync 返回每次调用各自的 Promise，多个模型测活不会互相覆盖回调。
            const result = await health.mutateAsync({ channelId: channel.id, model });
            setResults((current) => ({ ...current, [model]: result }));
            if (result.success) {
                toast.success(t('health_available'), { description: `${result.latency_ms} ms` });
            } else {
                toast.error(t('health_unavailable'), { description: result.error });
            }
        } catch (error) {
            const message = getErrorMessage(error);
            setResults((current) => ({
                ...current,
                [model]: {
                    success: false,
                    latency_ms: 0,
                    request_id: '',
                    status_code: 0,
                    error: message,
                },
            }));
            toast.error(t('health_failed'), { description: message });
        } finally {
            setTestingModels((current) => {
                const next = new Set(current);
                next.delete(model);
                return next;
            });
        }
    };

    if (models.length === 0) {
        return <div className="rounded-2xl border p-4 text-sm text-muted-foreground">{t('empty')}</div>;
    }

    return (
        <div className="overflow-hidden rounded-2xl border bg-card">
            {models.map((model, modelIndex) => {
                const result = results[model];
                const isTesting = testingModels.has(model);
                const prefixSwitchId = `channel-${channel.id}-model-${modelIndex}-prefix`;

                return (
                    <div key={model} className="border-b px-3 py-3 last:border-0">
                        <div>
                            <div className="flex min-w-0 items-start gap-2">
                                <span
                                    aria-hidden="true"
                                    className={`mt-1.5 size-2 shrink-0 rounded-full ${
                                        isTesting
                                            ? 'animate-pulse bg-amber-500'
                                            : result?.success
                                                ? 'bg-emerald-500'
                                                : result
                                                    ? 'bg-destructive'
                                                    : 'bg-muted-foreground/30'
                                    }`}
                                />
                                <div className="min-w-0 flex-1">
                                    <code className="line-clamp-2 break-all text-sm leading-5" title={model}>{model}</code>
                                    {(isTesting || result) && (
                                        <div
                                            aria-live="polite"
                                            className={`mt-0.5 flex items-center gap-1 text-xs font-medium ${
                                                isTesting
                                                    ? 'text-amber-600'
                                                    : result?.success
                                                        ? 'text-emerald-600'
                                                        : 'text-destructive'
                                            }`}
                                        >
                                            {isTesting && <Loader2 className="size-3 animate-spin" />}
                                            <span>
                                                {isTesting
                                                    ? t('testing')
                                                    : result?.success
                                                        ? t('available_latency', { latency: result.latency_ms })
                                                        : t('unavailable')}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                <div className="flex shrink-0 items-center gap-0.5">
                                    <Tooltip side="top" sideOffset={6} align="center">
                                        <TooltipTrigger asChild>
                                            <Button
                                                className="size-10 rounded-xl px-0 md:size-9"
                                                size="icon"
                                                variant="default"
                                                onClick={() => beginCreate(model)}
                                                aria-label={t('create_group')}
                                            >
                                                <Plus className="size-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>{t('create_group')}</TooltipContent>
                                    </Tooltip>

                                    <Popover
                                        open={openMenu === model}
                                        onOpenChange={(open) => setOpenMenu(open ? model : null)}
                                    >
                                        <PopoverTrigger asChild>
                                            <Button
                                                className="size-10 rounded-xl px-0 text-muted-foreground md:size-9"
                                                size="icon"
                                                variant="ghost"
                                                aria-label={t('more_actions')}
                                            >
                                                <MoreHorizontal className="size-4" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent
                                            align="end"
                                            sideOffset={6}
                                            className="w-48 rounded-2xl border-border/60 bg-card p-2 shadow-xl"
                                        >
                                            <div role="menu" aria-label={t('more_actions')} className="grid gap-1">
                                                <button
                                                    type="button"
                                                    role="menuitem"
                                                    disabled={isTesting}
                                                    onClick={() => {
                                                        setOpenMenu(null);
                                                        void test(model);
                                                    }}
                                                    className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    {isTesting
                                                        ? <Loader2 className="size-4 animate-spin text-muted-foreground" />
                                                        : <Activity className="size-4 text-muted-foreground" />}
                                                    <span>{isTesting ? t('testing') : t('health_check')}</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    role="menuitem"
                                                    onClick={() => {
                                                        setOpenMenu(null);
                                                        onNavigate?.();
                                                        openPlayground({ type: 'channel_model', channelId: channel.id, model });
                                                    }}
                                                    className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60"
                                                >
                                                    <MessageSquareText className="size-4 text-muted-foreground" />
                                                    <span>{t('playground')}</span>
                                                </button>
                                            </div>
                                        </PopoverContent>
                                    </Popover>
                                </div>
                            </div>

                        {result && !result.success && (result.error || result.attempts?.length) && (
                            <details className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                                <summary className="cursor-pointer font-medium">{t('error_details')}</summary>
                                {result.error && <pre className="mt-2 whitespace-pre-wrap break-words font-sans">{result.error}</pre>}
                                {result.attempts?.map((attempt, index) => (
                                    <div key={`${attempt.attempt_num}-${attempt.channel_id}-${index}`} className="mt-2 break-words">
                                        #{index + 1} {attempt.channel_name || String(attempt.channel_id)} · {attempt.model_name} · {
                                            attempt.status === 'success'
                                                || attempt.status === 'failed'
                                                || attempt.status === 'circuit_break'
                                                || attempt.status === 'skipped'
                                                ? tAttemptStatus(attempt.status)
                                                : attempt.status
                                        }
                                        {attempt.msg ? `: ${attempt.msg}` : ''}
                                    </div>
                                ))}
                            </details>
                        )}

                        {creating === model && (
                            <div ref={createFormRef} className="mt-3 scroll-mb-24 space-y-3 rounded-xl bg-muted/40 p-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium">{t('create_group')}</div>
                                        <div className="mt-0.5 break-all text-xs leading-5 text-muted-foreground">{t('source', { channel: channel.name, model })}</div>
                                    </div>
                                    <Button className="size-10" variant="ghost" size="icon" aria-label={t('cancel')} onClick={() => setCreating(null)}>
                                        <X className="size-4" />
                                    </Button>
                                </div>
                                <div className="flex items-center justify-between">
                                    <label htmlFor={prefixSwitchId} className="text-sm">{t('add_prefix')}</label>
                                    <Switch
                                        id={prefixSwitchId}
                                        aria-label={t('add_prefix')}
                                        checked={prefixEnabled}
                                        onCheckedChange={togglePrefix}
                                    />
                                </div>
                                {prefixEnabled && (
                                    <label className="block space-y-1">
                                        <span className="text-xs text-muted-foreground">{t('prefix')}</span>
                                        <Input value={prefix} onChange={(event) => updatePrefix(event.target.value)} />
                                    </label>
                                )}
                                <label className="block space-y-1">
                                    <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                        {t('group_name')}
                                        {!groupNameDirty && <span>{t('automatic_name')}</span>}
                                    </span>
                                    <Input
                                        value={groupName}
                                        onChange={(event) => {
                                            setGroupName(event.target.value);
                                            setGroupNameDirty(true);
                                        }}
                                    />
                                </label>
                                <div className="flex flex-wrap justify-end gap-2">
                                    {groupNameDirty && (
                                        <Button className="min-h-10" variant="ghost" size="sm" onClick={restoreAutomaticName}>
                                            <RotateCcw className="size-3.5" />
                                            {t('restore_auto_name')}
                                        </Button>
                                    )}
                                    <Button className="min-h-10" variant="outline" size="sm" onClick={() => setCreating(null)}>{t('cancel')}</Button>
                                    <Button className="min-h-10" size="sm" onClick={submit} disabled={createGroup.isPending || !groupName.trim()}>
                                        {createGroup.isPending ? t('creating') : t('create')}
                                    </Button>
                                </div>
                            </div>
                        )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
