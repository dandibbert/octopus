'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Layers, GripVertical, Settings2, X, Trash2 } from 'lucide-react';
import {
    DragDropContext,
    Draggable,
    Droppable,
    type DraggableProvided,
    type DropResult,
} from '@hello-pangea/dnd';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { getModelIcon } from '@/lib/model-icons';
import type { LLMChannel } from '@/api/endpoints/model';
import type {
    BillingBasis as ChannelBillingBasis,
    UnknownPricePolicy as ChannelUnknownPricePolicy,
} from '@/api/endpoints/channel';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/animate-ui/components/animate/tooltip';
import { useTranslations } from 'next-intl';

type BillingBasis = ChannelBillingBasis | '';
type UnknownPricePolicy = ChannelUnknownPricePolicy | '';

export interface SelectedMember extends LLMChannel {
    id: string;
    item_id?: number;
    weight?: number;
    billing_basis?: BillingBasis;
    billing_class_id?: string;
    billing_unknown_policy?: UnknownPricePolicy;
}

export type MemberBillingPatch = {
    billing_basis?: BillingBasis;
    billing_class_id?: string;
    billing_unknown_policy?: UnknownPricePolicy;
};

function reorderList<T>(list: T[], startIndex: number, endIndex: number): T[] {
    const result = [...list];
    const [removed] = result.splice(startIndex, 1);
    result.splice(endIndex, 0, removed);
    return result;
}

type MemberItemDnd = {
    innerRef: DraggableProvided['innerRef'];
    draggableProps: DraggableProvided['draggableProps'];
    dragHandleProps: DraggableProvided['dragHandleProps'];
    isDragging: boolean;
};

function MemberItem({
    member,
    onRemove,
    onWeightChange,
    onBillingChange,
    isRemoving,
    index,
    showWeight = false,
    showBilling = false,
    showConfirmDelete = true,
    layoutScope,
    dnd,
}: {
    member: SelectedMember;
    onRemove: (id: string) => void;
    onWeightChange?: (id: string, weight: number) => void;
    onBillingChange?: (id: string, patch: MemberBillingPatch) => void;
    isRemoving?: boolean;
    index: number;
    showWeight?: boolean;
    showBilling?: boolean;
    showConfirmDelete?: boolean;
    layoutScope?: string;
    dnd: MemberItemDnd;
}) {
    const t = useTranslations('group');
    const { Avatar: ModelAvatar } = getModelIcon(member.name);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const hasBillingOverride = Boolean(
        member.billing_basis || member.billing_class_id || member.billing_unknown_policy,
    );
    const [billingExpanded, setBillingExpanded] = useState(hasBillingOverride);
    const isDisabled = member.enabled === false;
    const isSiteChannel = member.site_id != null;
    const sourceLabel = [member.channel_name, isSiteChannel ? null : member.endpoint_type?.trim()]
        .filter(Boolean)
        .join(' · ');
    const billingNeedsSKU = member.billing_basis === 'requested' || member.billing_basis === 'fixed_sku';
    const billingSKUInvalid = billingNeedsSKU && !member.billing_class_id?.trim();

    useEffect(() => {
        if (hasBillingOverride) setBillingExpanded(true);
    }, [hasBillingOverride]);

    return (
        <div
            // DnD libraries provide imperative refs/props; the hook lint rule (`react-hooks/refs`)
            // flags this pattern, but it's safe and required for correct drag behavior.
            // eslint-disable-next-line react-hooks/refs
            ref={dnd.innerRef}
            // eslint-disable-next-line react-hooks/refs
            {...dnd.draggableProps}
            className={cn('rounded-lg grid transition-[grid-template-rows] duration-200', isRemoving ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]')}
            // eslint-disable-next-line react-hooks/refs
            style={{
                /* eslint-disable-next-line react-hooks/refs */
                ...(dnd.draggableProps?.style ?? {}),
                /* eslint-disable-next-line react-hooks/refs */
                ...(dnd.isDragging ? { zIndex: 50, boxShadow: '0 8px 32px rgba(0,0,0,0.15)' } : null),
            }}
        >
            <div className={cn(
                'flex items-center gap-2 rounded-lg bg-background border border-border/50 px-2.5 py-2 select-none transition-opacity duration-200 relative overflow-hidden',
                isRemoving && 'opacity-0',
                isDisabled && 'opacity-60 grayscale'
            )}>
                <span className={cn(
                    'size-5 rounded-md text-xs font-bold grid place-items-center shrink-0',
                    isDisabled ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'
                )}>
                    {index + 1}
                </span>

                <div
                    className={cn(
                        'p-0.5 rounded touch-none transition-colors',
                        isDisabled
                            ? 'cursor-grab active:cursor-grabbing hover:bg-muted/60'
                            : 'cursor-grab active:cursor-grabbing hover:bg-muted'
                    )}
                    // eslint-disable-next-line react-hooks/refs
                    {...dnd.dragHandleProps}
                >
                    <GripVertical className="size-3.5 text-muted-foreground" />
                </div>

                <span className={cn(isDisabled && 'opacity-70')}>
                    <ModelAvatar size={18} />
                </span>

                <div className="flex flex-col min-w-0 flex-1">
                    <Tooltip side="top" sideOffset={10} align="start">
                        <TooltipTrigger className={cn(
                            'line-clamp-2 break-all text-sm font-medium leading-tight md:truncate md:whitespace-nowrap',
                            isDisabled && 'text-muted-foreground'
                        )}>
                            {member.name}
                        </TooltipTrigger>
                        <TooltipContent key={member.name}>{member.name}</TooltipContent>
                    </Tooltip>
                    <span className="line-clamp-2 break-words text-3xs leading-tight text-muted-foreground md:truncate md:whitespace-nowrap">{sourceLabel}</span>
                    {showBilling && (
                        <div className="mt-1.5">
                            <button
                                type="button"
                                onClick={() => setBillingExpanded((value) => !value)}
                                className={cn(
                                    'flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-3xs transition-colors',
                                    hasBillingOverride
                                        ? 'bg-primary/10 text-primary'
                                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                                )}
                            >
                                <Settings2 className="size-3" />
                                <span>{t('form.billingAdvanced')}</span>
                                <span className="ml-1 truncate opacity-80">
                                    {hasBillingOverride ? t('form.billingOverrideActive') : t('form.billingFollowChannel')}
                                </span>
                                <ChevronDown className={cn('ml-auto size-3 transition-transform', billingExpanded && 'rotate-180')} />
                            </button>

                            {billingExpanded && (
                                <div className="mt-1.5 grid gap-2 rounded-lg border border-border/60 bg-muted/20 p-2 text-3xs md:grid-cols-2">
                                    <label className="grid gap-1 text-muted-foreground">
                                        {t('form.billingBasisLabel')}
                                        <select
                                            value={member.billing_basis ?? ''}
                                            onChange={(event) => {
                                                const basis = event.target.value as BillingBasis;
                                                onBillingChange?.(member.id, {
                                                    billing_basis: basis,
                                                    ...(!['requested', 'fixed_sku'].includes(basis)
                                                        ? { billing_class_id: '' }
                                                        : {}),
                                                });
                                            }}
                                            className="h-10 w-full min-w-0 rounded-md border border-border bg-background px-2 text-base text-foreground md:h-7 md:text-2xs"
                                            aria-label={t('form.billingBasisLabel')}
                                        >
                                            <option value="">{t('form.billingInherit')}</option>
                                            <option value="actual">{t('form.billingActual')}</option>
                                            <option value="requested">{t('form.billingRequested')}</option>
                                            <option value="routed">{t('form.billingRouted')}</option>
                                            <option value="fixed_sku">{t('form.billingFixedSku')}</option>
                                        </select>
                                    </label>

                                    <label className="grid gap-1 text-muted-foreground">
                                        {t('form.billingUnknownLabel')}
                                        <select
                                            value={member.billing_unknown_policy ?? ''}
                                            onChange={(event) => onBillingChange?.(member.id, {
                                                billing_unknown_policy: event.target.value as UnknownPricePolicy,
                                            })}
                                            className="h-10 w-full min-w-0 rounded-md border border-border bg-background px-2 text-base text-foreground md:h-7 md:text-2xs"
                                            aria-label={t('form.billingUnknownLabel')}
                                        >
                                            <option value="">{t('form.billingPolicyInherit')}</option>
                                            <option value="reject">{t('form.unknownReject')}</option>
                                            <option value="mark_unknown">{t('form.unknownMark')}</option>
                                            <option value="use_routed">{t('form.unknownUseRouted')}</option>
                                            <option value="use_actual">{t('form.unknownUseActual')}</option>
                                        </select>
                                    </label>

                                    {(billingNeedsSKU || member.billing_class_id) && (
                                        <label className="grid gap-1 text-muted-foreground md:col-span-2">
                                            {t('form.billingClassLabel')}
                                            <input
                                                value={member.billing_class_id ?? ''}
                                                onChange={(event) => onBillingChange?.(member.id, { billing_class_id: event.target.value })}
                                                placeholder={t('form.billingClassPlaceholder')}
                                                className={cn(
                                                    'h-10 w-full min-w-0 rounded-md border bg-background px-2 text-base text-foreground placeholder:text-muted-foreground md:h-7 md:text-2xs',
                                                    billingSKUInvalid ? 'border-destructive' : 'border-border',
                                                )}
                                            />
                                            {billingSKUInvalid && (
                                                <span className="text-destructive">{t('form.billingClassRequired')}</span>
                                            )}
                                        </label>
                                    )}

                                    <p className="text-muted-foreground md:col-span-2">
                                        {t('form.billingAdvancedHint')}
                                    </p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {showWeight && (
                    <input
                        type="number"
                        min={1}
                        value={member.weight ?? 1}
                        onChange={(e) => onWeightChange?.(member.id, Math.max(1, parseInt(e.target.value) || 1))}
                        className={cn(
                            'h-10 w-14 shrink-0 rounded border border-border bg-muted/50 text-center text-base focus:outline-none focus:ring-1 focus:ring-primary md:h-6 md:w-12 md:text-xs',
                            isDisabled && 'text-muted-foreground'
                        )}
                    />
                )}

                {(!showConfirmDelete || !confirmDelete) && (
                    <motion.button
                        layoutId={`delete-btn-member-${layoutScope ?? 'default'}-${member.id}`}
                        type="button"
                        onClick={() => showConfirmDelete ? setConfirmDelete(true) : onRemove(member.id)}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded hover:bg-destructive/10 hover:text-destructive transition-colors md:h-auto md:w-auto md:p-1"
                        initial={false}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.15 }}
                        style={{ pointerEvents: 'auto' }}
                    >
                        <X className="size-4 md:size-3" />
                    </motion.button>
                )}

                <AnimatePresence>
                    {showConfirmDelete && confirmDelete && (
                        <motion.div
                            layoutId={`delete-btn-member-${layoutScope ?? 'default'}-${member.id}`}
                            className="absolute inset-0 flex items-center justify-center gap-2 bg-destructive p-1.5 rounded-lg"
                            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                        >
                            <button
                                type="button"
                                onClick={() => setConfirmDelete(false)}
                                className="flex h-9 w-9 items-center justify-center rounded-md bg-destructive-foreground/20 text-destructive-foreground transition-all hover:bg-destructive-foreground/30 active:scale-95 md:h-6 md:w-6"
                            >
                                <X className="size-4 md:size-3" />
                            </button>
                            <button
                                type="button"
                                onClick={() => onRemove(member.id)}
                                className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-destructive-foreground text-xs font-semibold text-destructive transition-all hover:bg-destructive-foreground/90 active:scale-[0.98] md:h-6"
                            >
                                <Trash2 className="size-4 md:size-3" />
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}

export interface MemberListProps {
    members: SelectedMember[];
    onReorder: (members: SelectedMember[]) => void;
    onRemove: (id: string) => void;
    onWeightChange?: (id: string, weight: number) => void;
    onBillingChange?: (id: string, patch: MemberBillingPatch) => void;
    /**
     * When true, auto-scroll the list to bottom when a *new visible* member appears
     * (i.e. a new member id is added). Useful in "editor" flows. Defaults to true.
     */
    autoScrollOnAdd?: boolean;
    onDragStart?: () => void;
    /**
     * Called only when a drop results in a different order (i.e. commit reorder).
     * Useful for persisting the new order.
     */
    onDrop?: (members: SelectedMember[]) => void;
    /**
     * Called whenever a drag ends (including cancel / same-index drop).
     * Useful for lifecycle cleanup (e.g. clearing "isDragging" flags).
     */
    onDragFinish?: () => void;
    removingIds?: Set<string>;
    showWeight?: boolean;
    showBilling?: boolean;
    /**
     * Constrain the list to its parent and make it the scroll owner. Card views
     * use this to keep a fixed member viewport usable on touch screens.
     */
    contained?: boolean;
    /**
     * When true, show a confirmation overlay before removing an item.
     * When false, clicking the delete button removes the item immediately.
     * Defaults to true.
     */
    showConfirmDelete?: boolean;
    layoutScope?: string;
}

export function MemberList({
    members,
    onReorder,
    onRemove,
    onWeightChange,
    onBillingChange,
    autoScrollOnAdd = true,
    onDragStart,
    onDrop,
    onDragFinish,
    removingIds = new Set(),
    showWeight = false,
    showBilling = false,
    contained = false,
    showConfirmDelete = true,
    layoutScope: externalLayoutScope,
}: MemberListProps) {
    const internalLayoutScope = useId();
    const layoutScope = externalLayoutScope ?? internalLayoutScope;

    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const prevMemberCountRef = useRef<number>(0);
    const hasMountedRef = useRef(false);

    const visibleCount = members.filter((m) => !removingIds.has(m.id)).length;
    const isEmpty = visibleCount === 0;
    const t = useTranslations('group');

    useEffect(() => {
        const list = scrollContainerRef.current;
        const page = list?.closest<HTMLElement>('[data-virtualized-scroll]');
        if (!contained || !list || !page) return;

        // Keep the original nested list. At its boundary, pass the remaining
        // wheel distance to the page in the same gesture, rather than dropping it.
        const handleWheel = (event: WheelEvent) => {
            if (event.ctrlKey || event.shiftKey || !event.cancelable || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
            const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
                : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? list.clientHeight : 1;
            const delta = event.deltaY * unit;
            const available = delta > 0 ? Math.max(0, list.scrollHeight - list.clientHeight - list.scrollTop) : Math.max(0, list.scrollTop);
            if (Math.abs(delta) <= available) return;
            const parentAvailable = delta > 0 ? page.scrollHeight - page.clientHeight - page.scrollTop : page.scrollTop;
            if (parentAvailable <= 0) return;
            event.preventDefault();
            const consumed = Math.sign(delta) * available;
            list.scrollTop += consumed;
            page.scrollTop += delta - consumed;
        };
        list.addEventListener('wheel', handleWheel, { passive: false });
        return () => list.removeEventListener('wheel', handleWheel);
    }, [contained]);

    useEffect(() => {
        // Skip the initial mount so we don't auto-scroll on first render / initial data load.
        if (!hasMountedRef.current) {
            hasMountedRef.current = true;
            prevMemberCountRef.current = members.length;
            return;
        }

        if (!autoScrollOnAdd) {
            prevMemberCountRef.current = members.length;
            return;
        }

        const hasNewMember = members.length > prevMemberCountRef.current;

        // Auto-scroll only when member count increases (i.e. added; not reorder / not "unhide").
        if (hasNewMember) {
            // Wait a tick for DOM/placeholder/layout to settle.
            requestAnimationFrame(() => {
                const el = scrollContainerRef.current;
                if (!el) return;
                el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
            });
        }

        prevMemberCountRef.current = members.length;
    }, [members.length, autoScrollOnAdd]);

    const handleDragEnd = (result: DropResult) => {
        try {
            const { destination, source } = result;
            if (!destination) return;
            if (destination.index === source.index) return;

            const next = reorderList(members, source.index, destination.index);
            onReorder(next);
            onDrop?.(next);
        } finally {
            // Ensure drag lifecycle always finishes, even when drop is canceled.
            onDragFinish?.();
        }
    };

    return (
        <div className={cn(
            'relative md:p-2',
            contained ? 'h-full min-h-0' : 'min-h-28 md:h-full md:min-h-0',
        )}>
            <div
                className={cn(
                    'absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground',
                    'transition-opacity duration-200 ease-out',
                    isEmpty ? 'opacity-100' : 'opacity-0 pointer-events-none'
                )}
            >
                <Layers className="size-10 opacity-40" />
                <span className="text-sm">{t('card.empty')}</span>
            </div>

            <div
                className={cn(
                    'touch-pan-y transition-opacity duration-200',
                    contained
                        ? 'h-full min-h-0 overflow-y-auto'
                        : 'min-h-28 overflow-visible md:h-full md:min-h-0 md:overflow-y-auto',
                    isEmpty ? 'opacity-0' : 'opacity-100'
                )}
                ref={scrollContainerRef}
            >
                <DragDropContext
                    onDragStart={() => onDragStart?.()}
                    onDragEnd={handleDragEnd}
                >
                    <Droppable droppableId={`members-${layoutScope}`}>
                        {(droppableProvided) => (
                            <div
                                ref={droppableProvided.innerRef}
                                {...droppableProvided.droppableProps}
                                className={cn(
                                    'flex flex-col space-y-1.5 p-2 md:p-0',
                                    contained && 'pb-14 md:pb-14',
                                )}
                            >
                                {members.map((member, index) => (
                                    <Draggable
                                        key={member.id}
                                        draggableId={member.id}
                                        index={index}
                                        isDragDisabled={removingIds.has(member.id)}
                                    >
                                        {(draggableProvided, snapshot) => (
                                            <MemberItem
                                                member={member}
                                                onRemove={onRemove}
                                                onWeightChange={onWeightChange}
                                                onBillingChange={onBillingChange}
                                                isRemoving={removingIds.has(member.id)}
                                                index={index}
                                                showWeight={showWeight}
                                                showBilling={showBilling}
                                                showConfirmDelete={showConfirmDelete}
                                                layoutScope={layoutScope}
                                                dnd={{
                                                    innerRef: draggableProvided.innerRef,
                                                    draggableProps: draggableProvided.draggableProps,
                                                    dragHandleProps: draggableProvided.dragHandleProps,
                                                    isDragging: snapshot.isDragging,
                                                }}
                                            />
                                        )}
                                    </Draggable>
                                ))}
                                {droppableProvided.placeholder}
                            </div>
                        )}
                    </Droppable>
                </DragDropContext>
            </div>
        </div>
    );
}
