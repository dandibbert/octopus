'use client';

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pencil, Trash2, ArrowDownToLine, ArrowUpFromLine, GitMerge } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useCreateModel, useUpdateModel, useDeleteModel, type LLMInfo, type PriceMode } from '@/api/endpoints/model';
import { getModelIcon } from '@/lib/model-icons';
import { toast } from '@/components/common/Toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/animate-ui/components/animate/tooltip';
import { ModelDeleteOverlay, ModelEditOverlay } from './ItemOverlays';
import { cn } from '@/lib/utils';
import { createPortal } from 'react-dom';
import { Badge } from '@/components/ui/badge';
import { AttachPriceDialog } from './AttachPriceDialog';
import { effectivePriceMode, formatModelPrice } from './ModelIdentityCombobox';

interface ModelItemProps {
    model: LLMInfo;
    models: LLMInfo[];
    layout?: 'grid' | 'list';
}

function canonicalBareModel(value?: string) {
    if (!value) return '';
    const separator = value.indexOf(':');
    const modelID = separator >= 0 ? value.slice(separator + 1) : value;
    return modelID.endsWith('/default') ? modelID.slice(0, -'/default'.length) : modelID;
}

function PriceMetric({
    label,
    value,
    priceMode,
    freeLabel,
    icon,
}: {
    label: string;
    value: number;
    priceMode: PriceMode;
    freeLabel: string;
    icon: ReactNode;
}) {
    return (
        <div className="min-w-0 rounded-xl bg-muted/35 px-3 py-2">
            <div className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
                {icon}
                <span>{label}</span>
            </div>
            <div className="mt-1 whitespace-nowrap text-sm font-semibold tabular-nums text-card-foreground">
                {formatModelPrice(value, priceMode, freeLabel)}
            </div>
        </div>
    );
}

export const ModelItem = memo(function ModelItem({ model, models, layout = 'grid' }: ModelItemProps) {
    const t = useTranslations('model');
    const copyT = useTranslations('common.copy');
    const isListLayout = layout === 'list';
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isAttachOpen, setIsAttachOpen] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [overlayRect, setOverlayRect] = useState<{ top: number; left: number; width: number } | null>(null);
    const instanceId = useId();
    const editLayoutId = `edit-btn-${model.name}-${instanceId}`;
    const deleteLayoutId = `delete-btn-${model.name}-${instanceId}`;
    const cardRef = useRef<HTMLElement | null>(null);
    const editButtonRef = useRef<HTMLButtonElement | null>(null);
    const editOverlayRef = useRef<HTMLDivElement | null>(null);
    const [editValues, setEditValues] = useState(() => ({
        input: model.input.toString(),
        output: model.output.toString(),
        cache_read: model.cache_read.toString(),
        cache_write: model.cache_write.toString(),
        price_mode: effectivePriceMode(model),
    }));

    const createModel = useCreateModel();
    const updateModel = useUpdateModel();
    const deleteModel = useDeleteModel();

    const { Avatar: ModelAvatar, color: brandColor } = useMemo(() => getModelIcon(model.name), [model.name]);

    const updateOverlayRect = useCallback(() => {
        const card = cardRef.current;
        if (!card) return;
        const rect = card.getBoundingClientRect();
        setOverlayRect((prev) => {
            if (prev && prev.top === rect.top && prev.left === rect.left && prev.width === rect.width) {
                return prev;
            }
            return { top: rect.top, left: rect.left, width: rect.width };
        });
    }, []);

    const closeEdit = useCallback(() => {
        setIsEditOpen(false);
    }, []);

    const handleEditClick = () => {
        setConfirmDelete(false);
        setEditValues({
            input: model.input.toString(),
            output: model.output.toString(),
            cache_read: model.cache_read.toString(),
            cache_write: model.cache_write.toString(),
            price_mode: effectivePriceMode(model),
        });
        // Ensure first open already has anchor geometry so layout animation can run.
        updateOverlayRect();
        setIsEditOpen(true);
    };

    const handleCancelEdit = () => {
        closeEdit();
    };

    const handleSaveEdit = () => {
        const input = parseFloat(editValues.input) || 0;
        const output = parseFloat(editValues.output) || 0;
        const cacheRead = parseFloat(editValues.cache_read) || 0;
        const cacheWrite = parseFloat(editValues.cache_write) || 0;
        const allZero = input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0;
        const priceMode: PriceMode = editValues.price_mode === 'free' ? 'free' : allZero ? 'unknown' : 'explicit';
        const payload: LLMInfo = {
            name: model.name,
            provider: model.provider,
            canonical_model_id: model.canonical_model_id,
            billing_class_id: model.billing_class_id,
            input,
            output,
            cache_read: cacheRead,
            cache_write: cacheWrite,
            price_mode: priceMode,
        };
        const mutation = model.catalog_only ? createModel : updateModel;
        mutation.mutate(payload, {
            onSuccess: () => {
                closeEdit();
                toast.success(t('toast.updated'));
            },
            onError: (error) => {
                toast.error(t('toast.updateFailed'), { description: error.message });
            }
        });
    };

    const handleDeleteClick = () => {
        closeEdit();
        setConfirmDelete(true);
    };

    const handleCopyName = async () => {
        try {
            await navigator.clipboard.writeText(model.name);
            toast.success(copyT('success'));
        } catch (error) {
            toast.error(copyT('failed'), {
                description: error instanceof Error ? error.message : String(error),
            });
        }
    };
    const handleCancelDelete = () => setConfirmDelete(false);
    const handleConfirmDelete = () => {
        deleteModel.mutate(model.name, {
            onSuccess: () => {
                setConfirmDelete(false);
                toast.success(t('toast.deleted'));
            },
            onError: (error) => {
                setConfirmDelete(false);
                toast.error(t('toast.deleteFailed'), { description: error.message });
            }
        });
    };

    useEffect(() => {
        if (!isEditOpen) return;

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node | null;
            if (!target) return;
            if (editOverlayRef.current?.contains(target)) return;
            if (editButtonRef.current?.contains(target)) return;
            closeEdit();
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closeEdit();
        };

        updateOverlayRect();
        window.addEventListener('resize', updateOverlayRect);
        window.addEventListener('scroll', updateOverlayRect, true);
        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('resize', updateOverlayRect);
            window.removeEventListener('scroll', updateOverlayRect, true);
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isEditOpen, updateOverlayRect, closeEdit]);

    const shouldRenderEditPortal = isEditOpen || overlayRect !== null;
    const priceMode = effectivePriceMode(model);
    const modeLabel = model.catalog_only
        ? t('mode.catalog')
        : {
            unknown: t('mode.unknown'),
            explicit: t('mode.explicit'),
            free: t('mode.free'),
            inherited: t('mode.inherited'),
        }[priceMode];
    const canonicalBare = canonicalBareModel(model.canonical_model_id);
    const isAlias = canonicalBare !== '' && canonicalBare !== model.name.toLowerCase();
    const sourceLabel = {
        remote: t('card.sourceRemote'),
        builtin: t('card.sourceBuiltin'),
        user: t('card.sourceUser'),
        auto: t('card.sourceAuto'),
    }[model.price_source ?? ''] ?? model.price_source;

    return (
        <article
            ref={cardRef}
            className={cn(
                'group relative flex min-w-0 flex-col gap-3 rounded-3xl border border-border bg-card p-4 transition-all duration-300',
                (isEditOpen || confirmDelete) && 'z-50'
            )}
        >
            <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
                <div className="shrink-0 rounded-2xl border bg-background p-1.5">
                    <ModelAvatar size={42} />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                        <Tooltip side="top" sideOffset={10} align="start">
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    onClick={handleCopyName}
                                    className="line-clamp-2 min-w-0 flex-1 break-words text-left text-base font-semibold leading-5 text-card-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:line-clamp-1 md:break-normal"
                                >
                                    {model.name}
                                </button>
                            </TooltipTrigger>
                            <TooltipContent key={model.name}>{model.name} · {t('card.copyName')}</TooltipContent>
                        </Tooltip>

                        <div className={cn(
                            'flex shrink-0 items-center gap-1 pt-0.5',
                            (isEditOpen || confirmDelete) && 'invisible pointer-events-none'
                        )}>
                            <motion.button
                                ref={editButtonRef}
                                layoutId={editLayoutId}
                                type="button"
                                onClick={handleEditClick}
                                disabled={isEditOpen || confirmDelete}
                                className="flex size-10 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50 md:size-8"
                                title={model.catalog_only ? t('card.overrideCatalog') : t('card.edit')}
                            >
                                <Pencil className="size-4" />
                            </motion.button>

                            {!model.catalog_only && (
                                <motion.button
                                    layoutId={deleteLayoutId}
                                    type="button"
                                    onClick={handleDeleteClick}
                                    disabled={isEditOpen || confirmDelete}
                                    className="flex size-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50 md:size-8"
                                    title={t('card.delete')}
                                >
                                    <Trash2 className="size-4" />
                                </motion.button>
                            )}
                        </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge variant={priceMode === 'unknown' ? 'destructive' : 'secondary'}>{modeLabel}</Badge>
                        <Badge variant="outline">{isAlias ? t('card.aliasType') : t('card.standardType')}</Badge>
                        {sourceLabel && <Badge variant="outline">{sourceLabel}</Badge>}
                        {model.needs_review && <Badge variant="outline">{t('card.needsReview')}</Badge>}
                    </div>
                </div>
            </div>

            {model.canonical_model_id && (
                <Tooltip side="top" sideOffset={8} align="start">
                    <TooltipTrigger className="block w-full rounded-xl bg-muted/25 px-3 py-2 text-left text-xs text-muted-foreground">
                        <span className="block font-medium text-card-foreground/75">{t('card.canonical')}</span>
                        <span className="mt-0.5 block whitespace-normal break-all leading-5 md:truncate md:whitespace-nowrap">{model.canonical_model_id}</span>
                    </TooltipTrigger>
                    <TooltipContent>{model.canonical_model_id}</TooltipContent>
                </Tooltip>
            )}

            {priceMode === 'unknown' ? (
                <div className="flex min-w-0 items-center justify-between gap-2 rounded-xl bg-destructive/10 px-3 py-2.5">
                    <p className="min-w-0 truncate text-sm font-medium text-destructive">{t('card.unknownPrice')}</p>
                    <button
                        type="button"
                        onClick={() => setIsAttachOpen(true)}
                        className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 md:min-h-8 md:px-2"
                    >
                        <GitMerge className="size-3.5" />
                        {t('card.attachPrice')}
                    </button>
                </div>
            ) : (
                <div className={cn('grid gap-2', isListLayout ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2')}>
                    <PriceMetric
                        label={t('card.input')}
                        value={model.input}
                        priceMode={priceMode}
                        freeLabel={t('mode.free')}
                        icon={<ArrowDownToLine className="size-3.5 shrink-0" style={{ color: brandColor }} />}
                    />
                    <PriceMetric
                        label={t('card.cacheRead')}
                        value={model.cache_read}
                        priceMode={priceMode}
                        freeLabel={t('mode.free')}
                        icon={<ArrowDownToLine className="size-3.5 shrink-0 opacity-60" style={{ color: brandColor }} />}
                    />
                    <PriceMetric
                        label={t('card.output')}
                        value={model.output}
                        priceMode={priceMode}
                        freeLabel={t('mode.free')}
                        icon={<ArrowUpFromLine className="size-3.5 shrink-0" style={{ color: brandColor }} />}
                    />
                    <PriceMetric
                        label={t('card.cacheWrite')}
                        value={model.cache_write}
                        priceMode={priceMode}
                        freeLabel={t('mode.free')}
                        icon={<ArrowUpFromLine className="size-3.5 shrink-0 opacity-60" style={{ color: brandColor }} />}
                    />
                </div>
            )}

            <AnimatePresence>
                {!model.catalog_only && confirmDelete && (
                    <ModelDeleteOverlay
                        layoutId={deleteLayoutId}
                        isPending={deleteModel.isPending}
                        onCancel={handleCancelDelete}
                        onConfirm={handleConfirmDelete}
                    />
                )}
            </AnimatePresence>

            {shouldRenderEditPortal && typeof document !== 'undefined'
                ? createPortal(
                    <AnimatePresence onExitComplete={() => setOverlayRect(null)}>
                        {isEditOpen && overlayRect && (
                            <div
                                ref={editOverlayRef}
                                className="fixed z-[90]"
                                style={{
                                    top: `${overlayRect.top}px`,
                                    left: `${overlayRect.left}px`,
                                    width: `${overlayRect.width}px`,
                                }}
                            >
                                <div className="relative">
                                    <ModelEditOverlay
                                        layoutId={editLayoutId}
                                        modelName={model.name}
                                        brandColor={brandColor}
                                        editValues={editValues}
                                        isPending={updateModel.isPending || createModel.isPending}
                                        onChange={setEditValues}
                                        onCancel={handleCancelEdit}
                                        onSave={handleSaveEdit}
                                    />
                                </div>
                            </div>
                        )}
                    </AnimatePresence>,
                    document.body
                )
                : null}

            {isAttachOpen && (
                <AttachPriceDialog
                    source={model}
                    models={models}
                    open
                    onOpenChange={setIsAttachOpen}
                />
            )}
        </article>
    );
});
