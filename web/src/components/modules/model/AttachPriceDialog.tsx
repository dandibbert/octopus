'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, GitMerge } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
    type LLMInfo,
    type ModelAliasAttachResponse,
    useAttachModelAlias,
    useModelAliasList,
} from '@/api/endpoints/model';
import { toast } from '@/components/common/Toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
    formatModelPrice,
    getPricedModelOptions,
    PricedModelCombobox,
    type PricedModelOption,
} from './ModelIdentityCombobox';

export function AttachPriceDialog({
    source,
    models,
    open,
    onOpenChange,
}: {
    source: LLMInfo;
    models: LLMInfo[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const t = useTranslations('model.alias');
    const tm = useTranslations('model');
    const attachAlias = useAttachModelAlias();
    const {
        data: aliases = [],
        isPending: aliasesPending,
        isError: aliasesFailed,
    } = useModelAliasList();
    const options = useMemo(() => getPricedModelOptions(models), [models]);
    const [selected, setSelected] = useState<PricedModelOption | null>(null);
    const [attached, setAttached] = useState<{
        target: PricedModelOption;
        result: ModelAliasAttachResponse;
    } | null>(null);

    const { sameScopeAlias, displayedAlias } = useMemo(() => {
        const sourceAlias = source.name.trim().toLocaleLowerCase();
        const sourceProvider = source.provider?.trim().toLocaleLowerCase() ?? '';
        const candidates = aliases.filter((alias) => (
            !alias.channel_id && alias.alias.trim().toLocaleLowerCase() === sourceAlias
        ));
        const globalAlias = candidates.find((alias) => !alias.provider);
        const providerAlias = sourceProvider
            ? candidates.find((alias) => alias.provider?.trim().toLocaleLowerCase() === sourceProvider)
            : undefined;
        const sameScope = sourceProvider ? providerAlias : globalAlias;
        const effective = sourceProvider
            ? (providerAlias?.enabled ? providerAlias : globalAlias?.enabled ? globalAlias : undefined)
            : globalAlias?.enabled ? globalAlias : undefined;
        return {
            sameScopeAlias: sameScope,
            effectiveAlias: effective,
            displayedAlias: effective ?? sameScope,
        };
    }, [aliases, source.name, source.provider]);

    const sourceName = (value: string) => ({
        remote: tm('card.sourceRemote'),
        builtin: tm('card.sourceBuiltin'),
        user: tm('card.sourceUser'),
        auto: tm('card.sourceAuto'),
    }[value] ?? value);

    const handleOpenChange = (next: boolean) => {
        if (next) {
            setSelected(null);
            setAttached(null);
            attachAlias.reset();
        }
        onOpenChange(next);
    };

    const handleAttach = () => {
        if (!selected) return;
        attachAlias.mutate({
            alias: source.name,
            canonical_model_id: selected.canonicalModelID,
            billing_class_id: selected.billingClassID,
            provider: source.provider?.trim() || undefined,
            conflict_policy: sameScopeAlias ? 'replace' : undefined,
        }, {
            onSuccess: (result) => {
                setAttached({ target: selected, result });
                toast.success(t('updated'));
            },
            // apiClient translates the stable attach error_code before it
            // reaches this component, so the user sees the actionable reason.
            onError: (error) => toast.error(t('saveFailed'), { description: error.message }),
        });
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-2xl rounded-3xl p-5 sm:p-6">
                <DialogHeader className="pr-8 text-left">
                    <DialogTitle className="flex items-center gap-2">
                        <GitMerge className="size-5 text-primary" />
                        {t('attachTitle')}
                    </DialogTitle>
                    <DialogDescription>{t('attachDescription')}</DialogDescription>
                </DialogHeader>

                {attached ? (
                    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-card-foreground">
                            <CheckCircle2 className="size-5 shrink-0 text-primary" />
                            {t('attachedFinal')}
                            <Badge variant="secondary">{tm(`mode.${attached.result.price_resolution.price_mode}`)}</Badge>
                        </div>
                        <p className="mt-3 break-all text-sm text-muted-foreground">
                            <span className="font-medium text-card-foreground">{source.name}</span>
                            {' → '}
                            <span className="font-medium text-card-foreground">
                                {attached.result.model_resolution.canonical_model_id}
                            </span>
                        </p>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">
                            <span>
                                {tm('card.input')}{' '}
                                {formatModelPrice(
                                    attached.result.price_resolution.price?.input ?? attached.target.input,
                                    attached.result.price_resolution.price_mode,
                                    tm('mode.free'),
                                )}
                            </span>
                            <span>
                                {tm('card.output')}{' '}
                                {formatModelPrice(
                                    attached.result.price_resolution.price?.output ?? attached.target.output,
                                    attached.result.price_resolution.price_mode,
                                    tm('mode.free'),
                                )}
                            </span>
                            {attached.result.price_resolution.billing_class_id && (
                                <span className="grid gap-0.5">
                                    <span>{t('billingClass')}</span>
                                    <span className="break-all font-medium text-card-foreground/75">
                                        {attached.result.price_resolution.billing_class_id}
                                    </span>
                                </span>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="grid gap-4">
                        <div className="grid gap-1.5">
                            <span className="text-xs text-muted-foreground">{t('alias')}</span>
                            <Input value={source.name} readOnly aria-label={t('alias')} className="rounded-xl bg-muted/25" />
                            <div className="flex flex-wrap gap-1.5">
                                <Badge variant="outline">
                                    {source.provider ? t('providerScope', { provider: source.provider }) : t('scopeGlobal')}
                                </Badge>
                                {source.needs_review && <Badge variant="outline">{tm('card.needsReview')}</Badge>}
                            </div>
                        </div>

                        {aliasesFailed && (
                            <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
                                {t('saveFailed')}
                            </p>
                        )}

                        <div className="grid min-w-0 gap-1.5">
                            <span className="text-xs text-muted-foreground">{t('canonical')}</span>
                            <PricedModelCombobox
                                value={selected?.key ?? ''}
                                options={options}
                                onSelect={setSelected}
                                labels={{
                                    ariaLabel: t('canonical'),
                                    searchPlaceholder: t('targetSearchPlaceholder'),
                                    empty: t('noPricedTargets'),
                                    input: tm('card.input'),
                                    output: tm('card.output'),
                                    free: tm('mode.free'),
                                    source: (value) => tm('card.source', { source: sourceName(value) }),
                                }}
                            />
                        </div>

                        {selected && (
                            <div className="rounded-2xl bg-muted/30 p-3 text-xs text-muted-foreground">
                                <p className="break-all font-medium text-card-foreground">{selected.canonicalModelID}</p>
                                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                                    <span>{tm('card.input')} {formatModelPrice(selected.input, selected.priceMode, tm('mode.free'))}</span>
                                    <span>{tm('card.output')} {formatModelPrice(selected.output, selected.priceMode, tm('mode.free'))}</span>
                                    {selected.billingClassID && (
                                        <span className="grid gap-0.5">
                                            <span>{t('billingClass')}</span>
                                            <span className="break-all font-medium text-card-foreground/75">{selected.billingClassID}</span>
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}

                        {selected && displayedAlias && (
                            <div className="grid gap-2 rounded-2xl border border-warning/30 bg-warning/5 p-3 text-xs sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                                <div className="min-w-0">
                                    <span className="text-muted-foreground">{t('currentTarget')}</span>
                                    <p className="mt-1 break-all font-medium text-card-foreground">
                                        {displayedAlias.canonical_model_id}
                                    </p>
                                    <Badge variant="outline" className="mt-1">
                                        {displayedAlias.provider
                                            ? t('providerScope', { provider: displayedAlias.provider })
                                            : t('scopeGlobal')}
                                    </Badge>
                                    {!displayedAlias.enabled && (
                                        <Badge variant="outline" className="ml-1 mt-1">{t('disabled')}</Badge>
                                    )}
                                    {displayedAlias.billing_class_id && (
                                        <p className="mt-1 break-all text-muted-foreground">{displayedAlias.billing_class_id}</p>
                                    )}
                                </div>
                                <span className="hidden text-muted-foreground sm:inline" aria-hidden="true">→</span>
                                <div className="min-w-0">
                                    <span className="text-muted-foreground">{t('newTarget')}</span>
                                    <p className="mt-1 break-all font-medium text-card-foreground">
                                        {selected.canonicalModelID}
                                    </p>
                                    <Badge variant="outline" className="mt-1">
                                        {source.provider
                                            ? t('providerScope', { provider: source.provider })
                                            : t('scopeGlobal')}
                                    </Badge>
                                    {selected.billingClassID && (
                                        <p className="mt-0.5 break-all text-muted-foreground">{selected.billingClassID}</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter>
                    <Button type="button" variant="outline" className="min-h-11 rounded-xl" onClick={() => handleOpenChange(false)}>
                        {t('cancel')}
                    </Button>
                    {!attached && (
                        <Button
                            type="button"
                            className="min-h-11 rounded-xl"
                            disabled={!selected || aliasesPending || aliasesFailed || attachAlias.isPending}
                            onClick={handleAttach}
                        >
                            <GitMerge className="size-4" />
                            {attachAlias.isPending
                                ? t('saving')
                                : sameScopeAlias
                                    ? t('replaceAttachment')
                                    : t('save')}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
