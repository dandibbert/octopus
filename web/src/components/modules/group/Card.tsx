'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Trash2, X, Pencil, Pin, PinOff, Activity, MessageSquareText } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { type Group, useDeleteGroup, useUpdateGroup, useToggleGroupPin, useGroupRouteHealth } from '@/api/endpoints/group';
import type { ExecutionHealthResult } from '@/api/endpoints/channel';
import { useModelChannelList } from '@/api/endpoints/model';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { toast } from '@/components/common/Toast';
import { CopyIconButton } from '@/components/common/CopyButton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/animate-ui/components/animate/tooltip';
import type { SelectedMember } from './ItemList';
import { MemberList } from './ItemList';
import { GroupEditor, type GroupEditorValues } from './Editor';
import { modelChannelKey, MODE_LABELS } from './utils';
import { GroupMode, type GroupUpdateRequest } from '@/api/endpoints/group';
import { PresetPopover } from './PresetPopover';
import { openPlayground } from '@/stores/playground';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import {
    MorphingDialog,
    MorphingDialogClose,
    MorphingDialogContainer,
    MorphingDialogContent,
    MorphingDialogDescription,
    MorphingDialogTitle,
    MorphingDialogTrigger,
    useMorphingDialog,
} from '@/components/ui/morphing-dialog';

interface EditDialogContentProps {
    group: Group;
    displayMembers: SelectedMember[];
    isSubmitting: boolean;
    onSubmit: (values: GroupEditorValues, onDone?: () => void) => void;
}

function EditDialogContent({ group, displayMembers, isSubmitting, onSubmit }: EditDialogContentProps) {
    const { setIsOpen } = useMorphingDialog();
    const t = useTranslations('group');
    return (
        <>
            <MorphingDialogTitle className="shrink-0">
                <header className="mb-3 flex items-center justify-between">
                    <h2 className="text-2xl font-bold text-card-foreground">
                        {t('detail.actions.edit')}
                    </h2>
                    <MorphingDialogClose className="relative right-0 top-0" />
                </header>
            </MorphingDialogTitle>
            <MorphingDialogDescription className="flex-1 min-h-0 overflow-hidden">
                <GroupEditor
                    key={`edit-group-${group.id}`}
                    initial={{
                        name: group.name,
                        match_regex: group.match_regex ?? '',
                        mode: group.mode,
                        first_token_time_out: group.first_token_time_out ?? 0,
                        session_keep_time: group.session_keep_time ?? 0,
                        retry_enabled: group.retry_enabled ?? false,
                        max_retries: group.max_retries ?? 3,
                        members: displayMembers,
                    }}
                    submitText={t('detail.actions.save')}
                    submittingText={t('create.submitting')}
                    isSubmitting={isSubmitting}
                    onCancel={() => setIsOpen(false)}
                    onSubmit={(v) => onSubmit(v, () => setIsOpen(false))}
                />
            </MorphingDialogDescription>
        </>
    );
}

export function GroupCard({ group }: { group: Group }) {
    const t = useTranslations('group');
    const updateGroup = useUpdateGroup();
    const deleteGroup = useDeleteGroup();
    const routeHealth = useGroupRouteHealth();
    const togglePin = useToggleGroupPin();
    const { data: modelChannels = [] } = useModelChannelList();

    const [confirmDelete, setConfirmDelete] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [members, setMembers] = useState<SelectedMember[]>([]);
    const [weightOverrides, setWeightOverrides] = useState<Record<string, number>>({});
    const [routeHealthResult, setRouteHealthResult] = useState<ExecutionHealthResult | null>(null);
    const [routeHealthOpen, setRouteHealthOpen] = useState(false);
    const weightTimerRef = useRef<NodeJS.Timeout | null>(null);
    const membersRef = useRef<SelectedMember[]>([]);

    const modelChannelByKey = useMemo(() => {
        const map = new Map<string, typeof modelChannels[number]>();
        modelChannels.forEach((mc) => {
            map.set(modelChannelKey(mc.channel_id, mc.name), mc);
        });
        return map;
    }, [modelChannels]);

    const displayMembers = useMemo((): SelectedMember[] =>
        [...(group.items || [])]
            .sort((a, b) => a.priority - b.priority)
            .map((item) => {
                const key = modelChannelKey(item.channel_id, item.model_name);
                const modelChannel = modelChannelByKey.get(key);
                return {
                    ...modelChannel,
                    id: key,
                    name: item.model_name,
                    enabled: modelChannel?.enabled ?? true,
                    channel_id: item.channel_id,
                    channel_name: modelChannel?.channel_name ?? `Channel ${item.channel_id}`,
                    item_id: item.id,
                    weight: item.weight,
                    billing_basis: item.billing_basis,
                    billing_class_id: item.billing_class_id,
                    billing_unknown_policy: item.billing_unknown_policy,
                };
            }),
        [group.items, modelChannelByKey]
    );

    const effectiveDisplayMembers = useMemo(
        () => displayMembers.map((member) => {
            const nextWeight = weightOverrides[member.id];
            return nextWeight === undefined ? member : { ...member, weight: nextWeight };
        }),
        [displayMembers, weightOverrides]
    );

    const renderedMembers = useMemo(
        () => isDragging || updateGroup.isPending ? members : effectiveDisplayMembers,
        [effectiveDisplayMembers, isDragging, updateGroup.isPending, members]
    );

    useEffect(() => {
        membersRef.current = renderedMembers;
    }, [renderedMembers]);

    useEffect(() => {
        return () => { if (weightTimerRef.current) clearTimeout(weightTimerRef.current); };
    }, []);

    const onSuccess = useCallback(() => toast.success(t('toast.updated')), [t]);
    const onError = useCallback((error: Error) => toast.error(t('toast.updateFailed'), { description: error.message }), [t]);

    // Avoid UI flicker: drag-reorder also uses the same mutation, so only "mode switch" should lock mode buttons.
    const isUpdatingMode = (() => {
        if (!updateGroup.isPending) return false;
        const v = updateGroup.variables;
        if (typeof v !== 'object' || v === null) return false;
        return 'mode' in v && typeof (v as { mode?: unknown }).mode === 'number';
    })();

    const priorityByItemId = useMemo(() => {
        const map = new Map<number, number>();
        (group.items || []).forEach((item) => {
            if (item.id !== undefined) map.set(item.id, item.priority);
        });
        return map;
    }, [group.items]);

    const clearWeightOverride = useCallback((id: string) => {
        setWeightOverrides((prev) => {
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
        });
    }, []);

    const handleDragStart = useCallback(() => {
        setMembers([...effectiveDisplayMembers]);
        setIsDragging(true);
    }, [effectiveDisplayMembers]);

    const handleDragFinish = useCallback(() => {
        setIsDragging(false);
    }, []);

    const handleDropReorder = useCallback((nextMembers: SelectedMember[]) => {
        const itemsToUpdate = nextMembers
            .map((m, i) => ({ member: m, newPriority: i + 1 }))
            .filter(({ member, newPriority }) => {
                if (!member.item_id) return false;
                const origPriority = priorityByItemId.get(member.item_id);
                return origPriority !== undefined && origPriority !== newPriority;
            })
            .map(({ member, newPriority }) => ({ id: member.item_id!, priority: newPriority, weight: member.weight ?? 1 }));
        if (itemsToUpdate.length > 0) updateGroup.mutate({ id: group.id!, items_to_update: itemsToUpdate }, { onSuccess, onError });
    }, [group.id, priorityByItemId, updateGroup, onSuccess, onError]);

    const handleRemoveMember = useCallback((id: string) => {
        const member = membersRef.current.find((m) => m.id === id);
        clearWeightOverride(id);
        if (member?.item_id !== undefined) updateGroup.mutate({ id: group.id!, items_to_delete: [member.item_id] }, { onSuccess, onError });
    }, [clearWeightOverride, group.id, updateGroup, onSuccess, onError]);

    const handleWeightChange = useCallback((id: string, weight: number) => {
        setWeightOverrides((prev) => ({ ...prev, [id]: weight }));
        if (isDragging) {
            setMembers((prev) => prev.map((m) => m.id === id ? { ...m, weight } : m));
        }
        if (weightTimerRef.current) clearTimeout(weightTimerRef.current);
        weightTimerRef.current = setTimeout(() => {
            const member = membersRef.current.find((m) => m.id === id);
            if (!member?.item_id) return;
            const priority = priorityByItemId.get(member.item_id);
            if (!priority) return;
            updateGroup.mutate(
                { id: group.id!, items_to_update: [{ id: member.item_id, priority, weight }] },
                {
                    onSuccess: () => {
                        clearWeightOverride(id);
                        onSuccess();
                    },
                    onError,
                }
            );
        }, 500);
    }, [clearWeightOverride, group.id, isDragging, priorityByItemId, updateGroup, onSuccess, onError]);

    const handleRouteHealth = useCallback(() => {
        if (!group.id || routeHealth.isPending) return;
        setRouteHealthOpen(false);
        routeHealth.mutate(group.id, {
            onSuccess: (result) => {
                setRouteHealthResult(result);
                setRouteHealthOpen(true);
            },
            onError: (error) => {
                const result: ExecutionHealthResult = {
                    success: false,
                    latency_ms: 0,
                    request_id: '',
                    status_code: 0,
                    error: error instanceof Error ? error.message : String(error),
                };
                setRouteHealthResult(result);
                setRouteHealthOpen(true);
            },
        });
    }, [group.id, routeHealth]);

    const handleSubmitEdit = useCallback((values: GroupEditorValues, onDone?: () => void) => {
        if (!group.id) return;

        const originalItems = [...(group.items || [])].sort((a, b) => a.priority - b.priority);
        const originalById = new Map<number, {
            priority: number;
            weight: number;
            billing_basis?: SelectedMember['billing_basis'];
            billing_class_id?: string;
            billing_unknown_policy?: SelectedMember['billing_unknown_policy'];
        }>();
        const originalIds = new Set<number>();
        originalItems.forEach((it) => {
            if (typeof it.id === 'number') {
                originalIds.add(it.id);
                originalById.set(it.id, {
                    priority: it.priority,
                    weight: it.weight,
                    billing_basis: it.billing_basis,
                    billing_class_id: it.billing_class_id,
                    billing_unknown_policy: it.billing_unknown_policy,
                });
            }
        });

        const newIds = new Set<number>();
        values.members.forEach((m) => { if (typeof m.item_id === 'number') newIds.add(m.item_id); });

        const items_to_delete = Array.from(originalIds).filter((id) => !newIds.has(id));

        const items_to_add = values.members
            .map((m, idx) => ({ m, priority: idx + 1 }))
            .filter(({ m }) => typeof m.item_id !== 'number')
            .map(({ m, priority }) => ({
                channel_id: m.channel_id,
                model_name: m.name,
                priority,
                weight: m.weight ?? 1,
                billing_basis: m.billing_basis,
                billing_class_id: m.billing_class_id,
                billing_unknown_policy: m.billing_unknown_policy,
            }));

        const items_to_update = values.members
            .map((m, idx) => ({ m, priority: idx + 1 }))
            .filter(({ m }) => typeof m.item_id === 'number')
            .map(({ m, priority }) => {
                const id = m.item_id!;
                const orig = originalById.get(id);
                const weight = m.weight ?? 1;
                if (!orig) return null;
                const billingClassID = m.billing_class_id ?? '';
                const originalBillingClassID = orig.billing_class_id ?? '';
                if (
                    orig.priority === priority &&
                    orig.weight === weight &&
                    orig.billing_basis === m.billing_basis &&
                    originalBillingClassID === billingClassID &&
                    orig.billing_unknown_policy === m.billing_unknown_policy
                ) return null;
                return {
                    id,
                    priority,
                    weight,
                    billing_basis: m.billing_basis,
                    billing_class_id: billingClassID,
                    billing_unknown_policy: m.billing_unknown_policy,
                };
            })
            .filter((x) => x !== null);

        const payload: GroupUpdateRequest = { id: group.id };
        const nextName = values.name.trim();
        const nextRegex = (values.match_regex ?? '').trim();
        const nextFirstTokenTimeOut = values.first_token_time_out ?? 0;
        const nextSessionKeepTime = values.session_keep_time ?? 0;

        if (nextName && nextName !== group.name) payload.name = nextName;
        if (values.mode !== group.mode) payload.mode = values.mode;
        if (nextRegex !== (group.match_regex ?? '')) payload.match_regex = nextRegex;
        if (nextFirstTokenTimeOut !== (group.first_token_time_out ?? 0)) payload.first_token_time_out = nextFirstTokenTimeOut;
        if (nextSessionKeepTime !== (group.session_keep_time ?? 0)) payload.session_keep_time = nextSessionKeepTime;
        if (values.retry_enabled !== (group.retry_enabled ?? false)) payload.retry_enabled = values.retry_enabled;
        if (values.max_retries !== (group.max_retries ?? 3)) payload.max_retries = values.max_retries;
        if (items_to_add.length) payload.items_to_add = items_to_add;
        if (items_to_update.length) payload.items_to_update = items_to_update;
        if (items_to_delete.length) payload.items_to_delete = items_to_delete;

        if (Object.keys(payload).length === 1) {
            onDone?.();
            return;
        }

        updateGroup.mutate(payload, {
            onSuccess: () => {
                onSuccess();
                onDone?.();
            },
            onError,
        });
    }, [group.first_token_time_out, group.session_keep_time, group.retry_enabled, group.max_retries, group.id, group.items, group.match_regex, group.mode, group.name, onSuccess, onError, updateGroup]);

    return (
        <article className="group/card relative flex flex-col rounded-3xl border border-border bg-card p-4 text-card-foreground custom-shadow">
            <header className="relative -mx-1 -my-1 mb-3 flex items-start justify-between overflow-visible rounded-xl px-1 py-1">
                <div className="group/title relative mr-2 min-w-0 flex-1">
                    <Tooltip side="top" sideOffset={10} align="center">
                        <TooltipTrigger asChild>
                            <h3 className="truncate text-lg font-bold">{group.name}</h3>
                        </TooltipTrigger>
                        <TooltipContent key={group.name}>{group.name}</TooltipContent>
                    </Tooltip>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                    <Tooltip side="top" sideOffset={10} align="center">
                        <TooltipTrigger asChild>
                            <CopyIconButton
                                text={group.name}
                                className="flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                copyIconClassName="size-4"
                                checkIconClassName="size-4 text-primary"
                            />
                        </TooltipTrigger>
                        <TooltipContent>{t('detail.actions.copyName')}</TooltipContent>
                    </Tooltip>

                    <PresetPopover group={group} />

                    <MorphingDialog>
                        <MorphingDialogTrigger
                            aria-label={t('detail.actions.edit')}
                            className="flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                            <Tooltip side="top" sideOffset={10} align="center">
                                <TooltipTrigger asChild>
                                    <Pencil className="size-4" />
                                </TooltipTrigger>
                                <TooltipContent>{t('detail.actions.edit')}</TooltipContent>
                            </Tooltip>
                        </MorphingDialogTrigger>

                        <MorphingDialogContainer>
                            <MorphingDialogContent className="relative flex h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-4xl flex-col overflow-hidden rounded-2xl bg-card px-4 py-4 text-card-foreground sm:rounded-3xl sm:px-6 md:h-[calc(100dvh-2rem)]">
                                <EditDialogContent
                                    group={group}
                                    displayMembers={displayMembers}
                                    isSubmitting={updateGroup.isPending}
                                    onSubmit={handleSubmitEdit}
                                />
                            </MorphingDialogContent>
                        </MorphingDialogContainer>
                    </MorphingDialog>
                </div>
            </header>

            <div className="mb-3 flex gap-1">
                {([GroupMode.RoundRobin, GroupMode.Random, GroupMode.Failover, GroupMode.Weighted] as const).map((m) => (
                    <button
                        key={m}
                        type="button"
                        aria-disabled={isUpdatingMode || !group.id}
                        onClick={() => {
                            if (isUpdatingMode || !group.id || m === group.mode) return;
                            updateGroup.mutate({ id: group.id, mode: m }, { onSuccess, onError });
                        }}
                        className={cn(
                            'min-h-10 min-w-0 flex-1 rounded-lg px-1 py-2 text-xs transition-colors',
                            group.mode === m ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80',
                            !group.id && 'cursor-not-allowed opacity-50',
                        )}
                    >
                        {t(`mode.${MODE_LABELS[m]}`)}
                    </button>
                ))}
            </div>

            <section className="relative h-101 overflow-hidden rounded-xl border border-border/50 bg-muted/30">
                <MemberList
                    members={renderedMembers}
                    onReorder={setMembers}
                    onRemove={handleRemoveMember}
                    onWeightChange={handleWeightChange}
                    onDragStart={handleDragStart}
                    onDrop={handleDropReorder}
                    onDragFinish={handleDragFinish}
                    autoScrollOnAdd={false}
                    contained
                    showWeight={group.mode === GroupMode.Weighted}
                    layoutScope={`card-${group.id ?? 'unknown'}`}
                />
            </section>

            {!confirmDelete && (
                <div
                    className={cn(
                        'absolute bottom-3 left-3 z-10 flex items-center gap-0.5 rounded-xl border border-border/40 bg-card/95 p-0.5 shadow-sm backdrop-blur-sm transition-opacity duration-200',
                        'pointer-events-auto opacity-100 md:pointer-events-none md:opacity-0 md:group-hover/card:pointer-events-auto md:group-hover/card:opacity-100 md:group-focus-within/card:pointer-events-auto md:group-focus-within/card:opacity-100',
                        routeHealthOpen && 'md:pointer-events-auto md:opacity-100',
                    )}
                >
                    <Popover open={routeHealthOpen} onOpenChange={setRouteHealthOpen}>
                        <PopoverAnchor asChild>
                            <span className="inline-flex">
                                <Tooltip side="top" sideOffset={6} align="center">
                                    <TooltipTrigger asChild>
                                        <button
                                            type="button"
                                            aria-label={routeHealth.isPending ? t('routeHealth.testing') : t('routeHealth.action')}
                                            aria-haspopup="dialog"
                                            aria-expanded={routeHealthOpen}
                                            aria-controls={`group-route-health-result-${group.id}`}
                                            disabled={!group.id || routeHealth.isPending}
                                            onClick={handleRouteHealth}
                                            className="relative flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                                        >
                                            <Activity className={cn('size-4', routeHealth.isPending && 'animate-pulse')} />
                                            {(routeHealth.isPending || routeHealthResult) && (
                                                <span className={cn(
                                                    'absolute right-1.5 top-1.5 size-1.5 rounded-full ring-2 ring-card',
                                                    routeHealth.isPending
                                                        ? 'animate-pulse bg-info'
                                                        : routeHealthResult?.success ? 'bg-success' : 'bg-destructive',
                                                )} />
                                            )}
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent>{routeHealth.isPending ? t('routeHealth.testing') : t('routeHealth.action')}</TooltipContent>
                                </Tooltip>
                            </span>
                        </PopoverAnchor>

                        {routeHealthResult && (
                            <PopoverContent
                                side="top"
                                align="start"
                                sideOffset={8}
                                collisionPadding={12}
                                id={`group-route-health-result-${group.id}`}
                                className={cn(
                                    'w-[min(calc(100vw-1.5rem),20rem)] rounded-xl bg-card p-3 text-xs shadow-lg',
                                    routeHealthResult.success ? 'border-success/30' : 'border-destructive/30',
                                )}
                            >
                                <div className="flex items-start gap-2">
                                    <span className={cn('mt-1 size-2 shrink-0 rounded-full', routeHealthResult.success ? 'bg-success' : 'bg-destructive')} />
                                    <div className="min-w-0 flex-1">
                                        <div className="font-medium" aria-live="polite">
                                            {routeHealthResult.success
                                                ? t('routeHealth.availableLatency', { latency: routeHealthResult.latency_ms })
                                                : t('routeHealth.unavailable')}
                                        </div>
                                        {((routeHealthResult.selected_channel || routeHealthResult.channel_name)
                                            || (routeHealthResult.actual_model || routeHealthResult.remote_model)) && (
                                            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-muted-foreground">
                                                {(routeHealthResult.selected_channel || routeHealthResult.channel_name) && (
                                                    <>
                                                        <dt>{t('routeHealth.actualChannel')}</dt>
                                                        <dd className="break-words text-foreground">{routeHealthResult.selected_channel || routeHealthResult.channel_name}</dd>
                                                    </>
                                                )}
                                                {(routeHealthResult.actual_model || routeHealthResult.remote_model) && (
                                                    <>
                                                        <dt>{t('routeHealth.actualModel')}</dt>
                                                        <dd className="break-all text-foreground">{routeHealthResult.actual_model || routeHealthResult.remote_model}</dd>
                                                    </>
                                                )}
                                            </dl>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        aria-label={t('detail.actions.cancel')}
                                        onClick={() => setRouteHealthOpen(false)}
                                        className="-mr-1 -mt-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                    >
                                        <X className="size-3.5" />
                                    </button>
                                </div>

                                {!routeHealthResult.success && (routeHealthResult.error || routeHealthResult.attempts?.length) && (
                                    <details className="mt-2 border-t border-border/60 pt-2">
                                        <summary className="cursor-pointer font-medium">{t('routeHealth.errorDetails')}</summary>
                                        <div className="mt-2 max-h-32 overflow-y-auto break-words text-muted-foreground">
                                            {routeHealthResult.error && <div className="whitespace-pre-wrap">{routeHealthResult.error}</div>}
                                            {routeHealthResult.attempts?.map((attempt, index) => {
                                                const translatedStatus = attempt.status === 'success'
                                                    || attempt.status === 'failed'
                                                    || attempt.status === 'circuit_break'
                                                    || attempt.status === 'skipped'
                                                    ? t(`health.attemptStatus.${attempt.status}`)
                                                    : attempt.status;
                                                return (
                                                    <div key={`${attempt.attempt_num}-${attempt.channel_id}-${index}`} className="mt-1.5">
                                                        #{index + 1} {attempt.channel_name || String(attempt.channel_id)} · {attempt.model_name} · {translatedStatus}{attempt.msg ? `: ${attempt.msg}` : ''}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </details>
                                )}
                            </PopoverContent>
                        )}
                    </Popover>

                    <Tooltip side="top" sideOffset={6} align="center">
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                aria-label={t('routeHealth.playground')}
                                disabled={!group.id}
                                onClick={() => group.id && openPlayground({ type: 'group', groupId: group.id, group: group.name })}
                                className="flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                            >
                                <MessageSquareText className="size-4" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent>{t('routeHealth.playground')}</TooltipContent>
                    </Tooltip>

                    <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />

                    <Tooltip side="top" sideOffset={6} align="center">
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                aria-label={group.pinned ? t('pin.unpin') : t('pin.pin')}
                                disabled={togglePin.isPending || !group.id}
                                onClick={() => {
                                    if (!group.id || togglePin.isPending) return;
                                    togglePin.mutate(
                                        { groupID: group.id, pinned: !group.pinned },
                                        {
                                            onSuccess: () => toast.success(group.pinned ? t('toast.unpinned') : t('toast.pinned')),
                                            onError: (error) => toast.error(t('toast.pinFailed'), { description: error.message }),
                                        },
                                    );
                                }}
                                className={cn(
                                    'flex size-10 items-center justify-center rounded-lg transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50',
                                    group.pinned ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                                )}
                            >
                                {group.pinned ? <Pin className="size-4 fill-current" /> : <PinOff className="size-4" />}
                            </button>
                        </TooltipTrigger>
                        <TooltipContent>{group.pinned ? t('pin.unpin') : t('pin.pin')}</TooltipContent>
                    </Tooltip>

                    <Tooltip side="top" sideOffset={6} align="center">
                        <TooltipTrigger asChild>
                            <motion.button
                                layoutId={`delete-btn-group-${group.id}`}
                                type="button"
                                aria-label={t('detail.actions.delete')}
                                onClick={() => {
                                    setRouteHealthOpen(false);
                                    setConfirmDelete(true);
                                }}
                                className="flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            >
                                <Trash2 className="size-4" />
                            </motion.button>
                        </TooltipTrigger>
                        <TooltipContent>{t('detail.actions.delete')}</TooltipContent>
                    </Tooltip>
                </div>
            )}

            <AnimatePresence>
                {confirmDelete && (
                    <motion.div
                        layoutId={`delete-btn-group-${group.id}`}
                        className="absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-xl bg-destructive p-2 shadow-md"
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    >
                        <button
                            type="button"
                            aria-label={t('detail.actions.cancel')}
                            onClick={() => setConfirmDelete(false)}
                            className="flex size-10 items-center justify-center rounded-lg bg-destructive-foreground/20 text-destructive-foreground transition-all hover:bg-destructive-foreground/30 active:scale-95"
                        >
                            <X className="size-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => group.id && deleteGroup.mutate(group.id, {
                                onSuccess: () => toast.success(t('toast.deleted')),
                                onError: (error) => toast.error(t('toast.deleteFailed'), { description: error.message }),
                            })}
                            disabled={deleteGroup.isPending}
                            className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-destructive-foreground px-3 text-sm font-semibold text-destructive transition-all hover:bg-destructive-foreground/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Trash2 className="size-3.5" />
                            {t('detail.actions.confirmDelete')}
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </article>
    );
}
