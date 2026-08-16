'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { GitMerge, Pencil, Plus, Save, Search, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
    type LLMInfo,
    type ModelAlias,
    useCreateModelAlias,
    useDeleteModelAlias,
    useModelAliasList,
    useModelChannelList,
    useModelList,
    useUpdateModelAlias,
} from '@/api/endpoints/model';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/common/Toast';
import {
    MorphingDialogClose,
    MorphingDialogDescription,
    MorphingDialogTitle,
} from '@/components/ui/morphing-dialog';
import {
    effectivePriceMode,
    FreeformModelCombobox,
    getPricedModelOptions,
    PricedModelCombobox,
} from './ModelIdentityCombobox';

type AliasScope = 'global' | 'provider' | 'channel';

type AliasForm = {
    id?: number;
    alias: string;
    canonical_model_id: string;
    billing_class_id: string;
    scope: AliasScope;
    provider: string;
    channel_id: string;
    enabled: boolean;
};

const EMPTY_FORM: AliasForm = {
    alias: '',
    canonical_model_id: '',
    billing_class_id: '',
    scope: 'global',
    provider: '',
    channel_id: '',
    enabled: true,
};

function scopeOf(alias: ModelAlias): AliasScope {
    if (alias.channel_id) return 'channel';
    if (alias.provider) return 'provider';
    return 'global';
}

export function AliasManager({
    models,
    searchTerm,
    onSearchTermChange,
}: {
    models: LLMInfo[];
    searchTerm: string;
    onSearchTermChange: (value: string) => void;
}) {
    const t = useTranslations('model.alias');
    const tm = useTranslations('model');
    const { data: aliases = [] } = useModelAliasList();
    const { data: channelModels = [] } = useModelChannelList();
    const createAlias = useCreateModelAlias();
    const updateAlias = useUpdateModelAlias();
    const deleteAlias = useDeleteModelAlias();
    const [form, setForm] = useState<AliasForm>(EMPTY_FORM);
    const [showForm, setShowForm] = useState(false);

    const sourceOptions = useMemo(() => {
        const values = new Map<string, LLMInfo>();
        for (const item of models) {
            if (effectivePriceMode(item) !== 'unknown' && !item.needs_review) continue;
            values.set(`${item.provider ?? ''}\u0000${item.name}`, item);
        }
        return Array.from(values.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [models]);

    const canonicalOptions = useMemo(() => getPricedModelOptions(models), [models]);

    const selectedCanonicalKey = useMemo(() => canonicalOptions.find((option) => (
        option.canonicalModelID === form.canonical_model_id &&
        (option.billingClassID ?? '') === form.billing_class_id
    ))?.key ?? form.canonical_model_id, [canonicalOptions, form.billing_class_id, form.canonical_model_id]);

    const sourceName = (source: string) => ({
        remote: tm('card.sourceRemote'),
        builtin: tm('card.sourceBuiltin'),
        user: tm('card.sourceUser'),
        auto: tm('card.sourceAuto'),
    }[source] ?? source);

    const channels = useMemo(() => {
        const values = new Map<number, string>();
        for (const item of channelModels) values.set(item.channel_id, item.channel_name);
        return Array.from(values, ([id, name]) => ({ id, name })).sort((a, b) => a.id - b.id);
    }, [channelModels]);

    const visibleAliases = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();
        const sorted = [...aliases].sort((a, b) => a.alias.localeCompare(b.alias));
        if (!term) return sorted;
        return sorted.filter((alias) =>
            [alias.alias, alias.canonical_model_id, alias.billing_class_id, alias.provider]
                .filter(Boolean)
                .some((value) => value!.toLowerCase().includes(term)),
        );
    }, [aliases, searchTerm]);

    const reset = () => {
        setForm(EMPTY_FORM);
        setShowForm(false);
    };

    const edit = (alias: ModelAlias) => {
        setForm({
            id: alias.id,
            alias: alias.alias,
            canonical_model_id: alias.canonical_model_id,
            billing_class_id: alias.billing_class_id ?? '',
            scope: scopeOf(alias),
            provider: alias.provider ?? '',
            channel_id: alias.channel_id ? String(alias.channel_id) : '',
            enabled: alias.enabled,
        });
        setShowForm(true);
    };

    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const payload: ModelAlias = {
            id: form.id,
            alias: form.alias.trim(),
            canonical_model_id: form.canonical_model_id.trim(),
            billing_class_id: form.billing_class_id.trim() || undefined,
            provider: form.scope === 'provider' ? form.provider.trim() : undefined,
            channel_id: form.scope === 'channel' ? Number(form.channel_id) : null,
            enabled: form.enabled,
            priority: 0,
            source: 'user',
        };
        if (!payload.alias || !payload.canonical_model_id || (form.scope === 'provider' && !payload.provider) ||
            (form.scope === 'channel' && !payload.channel_id)) return;
        const mutation = form.id ? updateAlias : createAlias;
        mutation.mutate(payload, {
            onSuccess: () => {
                toast.success(form.id ? t('updated') : t('created'));
                reset();
            },
            onError: (error) => toast.error(t('saveFailed'), { description: error.message }),
        });
    };

    const pending = createAlias.isPending || updateAlias.isPending;

    return (
        <section className="flex min-h-0 flex-col">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={searchTerm}
                        onChange={(event) => onSearchTermChange(event.target.value)}
                        placeholder={t('searchPlaceholder')}
                        className="rounded-xl pl-9"
                    />
                </div>
                <Button
                    type="button"
                    size="sm"
                    className="h-10 shrink-0 rounded-xl px-4"
                    onClick={() => {
                        setForm(EMPTY_FORM);
                        setShowForm((current) => !current);
                    }}
                >
                    {showForm ? <X className="size-4" /> : <Plus className="size-4" />}
                    {showForm ? t('cancel') : t('create')}
                </Button>
            </div>

            {showForm && (
                <form onSubmit={submit} className="mt-4 grid gap-3 rounded-2xl border bg-muted/20 p-4 md:grid-cols-2">
                    <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
                        {t('alias')}
                        <FreeformModelCombobox
                            value={form.alias}
                            options={sourceOptions}
                            ariaLabel={t('alias')}
                            onValueChange={(alias) => setForm((current) => ({ ...current, alias }))}
                            onOptionSelect={(option) => setForm((current) => ({
                                ...current,
                                alias: option.name,
                                scope: option.provider ? 'provider' : current.scope,
                                provider: option.provider ?? current.provider,
                            }))}
                        />
                    </label>
                    <div className="grid min-w-0 gap-1 text-xs text-muted-foreground">
                        {t('canonical')}
                        <PricedModelCombobox
                            value={selectedCanonicalKey}
                            options={canonicalOptions}
                            onSelect={(option) => setForm((current) => ({
                                ...current,
                                canonical_model_id: option.canonicalModelID,
                                billing_class_id: option.billingClassID ?? '',
                            }))}
                            labels={{
                                ariaLabel: t('canonical'),
                                searchPlaceholder: t('targetSearchPlaceholder'),
                                empty: t('noPricedTargets'),
                                input: tm('card.input'),
                                output: tm('card.output'),
                                free: tm('mode.free'),
                                source: (source) => tm('card.source', { source: sourceName(source) }),
                            }}
                        />
                    </div>
                    <label className="grid gap-1 text-xs text-muted-foreground">
                        {t('billingClass')}
                        <Input
                            value={form.billing_class_id}
                            readOnly
                            aria-readonly="true"
                            className="rounded-xl bg-muted/25"
                            placeholder={t('inheritPlaceholder')}
                        />
                    </label>
                    <div className="grid gap-1 text-xs text-muted-foreground">
                        {t('scope')}
                        <Select
                            value={form.scope}
                            onValueChange={(scope: AliasScope) => setForm((current) => ({ ...current, scope }))}
                        >
                            <SelectTrigger aria-label={t('scope')} className="w-full rounded-xl">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="z-[120] rounded-xl">
                                <SelectItem value="global">{t('scopeGlobal')}</SelectItem>
                                <SelectItem value="provider">{t('scopeProvider')}</SelectItem>
                                <SelectItem value="channel">{t('scopeChannel')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {form.scope === 'provider' && (
                        <label className="grid gap-1 text-xs text-muted-foreground">
                            {t('provider')}
                            <Input value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })} className="rounded-xl" />
                        </label>
                    )}
                    {form.scope === 'channel' && (
                        <div className="grid gap-1 text-xs text-muted-foreground">
                            {t('channel')}
                            <Select
                                value={form.channel_id}
                                onValueChange={(channel_id) => setForm((current) => ({ ...current, channel_id }))}
                            >
                                <SelectTrigger aria-label={t('channel')} className="w-full rounded-xl">
                                    <SelectValue placeholder={t('selectChannel')} />
                                </SelectTrigger>
                                <SelectContent className="z-[120] rounded-xl">
                                    {channels.map((channel) => (
                                        <SelectItem key={channel.id} value={String(channel.id)}>
                                            {channel.name} (#{channel.id})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    <label className="flex items-center justify-between gap-3 rounded-xl border bg-background px-3 py-2 text-xs text-muted-foreground">
                        {t('enabled')}
                        <Switch checked={form.enabled} onCheckedChange={(enabled) => setForm({ ...form, enabled })} />
                    </label>
                    <div className="flex items-end gap-2 md:col-span-2">
                        <Button type="submit" disabled={pending} className="rounded-xl">
                            <Save className="size-4" />
                            {pending ? t('saving') : t('save')}
                        </Button>
                        {form.id && <Button type="button" variant="outline" className="rounded-xl" onClick={reset}>{t('cancel')}</Button>}
                    </div>
                </form>
            )}

            {visibleAliases.length > 0 ? (
                <div className="mt-4 max-h-[52vh] overflow-hidden rounded-2xl border bg-background p-2">
                <div className="max-h-[calc(52vh-1rem)] overflow-y-auto">
                    {visibleAliases.map((alias) => {
                        const scope = alias.channel_id
                            ? t('channelScope', { id: alias.channel_id })
                            : alias.provider
                                ? t('providerScope', { provider: alias.provider })
                                : t('scopeGlobal');
                        return (
                            <article
                                key={alias.id ?? `${scope}:${alias.alias}`}
                                className="border-b border-border/70 px-4 py-3 last:border-b-0"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <span className="break-all text-sm font-medium">{alias.alias}</span>
                                            <Badge variant="secondary">{scope}</Badge>
                                            {!alias.enabled && <Badge variant="outline">{t('disabled')}</Badge>}
                                            {alias.source === 'auto' && <Badge variant="outline">{t('automatic')}</Badge>}
                                        </div>
                                        <p className="mt-1 break-all text-xs text-muted-foreground">→ {alias.canonical_model_id}</p>
                                        {alias.billing_class_id && (
                                            <div className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
                                                <span>{t('billingClass')}</span>
                                                <span className="break-all font-medium text-card-foreground/75">{alias.billing_class_id}</span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex shrink-0 gap-1">
                                        <button type="button" onClick={() => edit(alias)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label={t('edit')}>
                                            <Pencil className="size-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            disabled={!alias.id || deleteAlias.isPending}
                                            onClick={() => alias.id && deleteAlias.mutate(alias.id, {
                                                onSuccess: () => toast.success(t('deleted')),
                                                onError: (error) => toast.error(t('deleteFailed'), { description: error.message }),
                                            })}
                                            className="rounded-lg p-2 text-destructive hover:bg-destructive/10 disabled:opacity-50"
                                            aria-label={t('delete')}
                                        >
                                            <Trash2 className="size-3.5" />
                                        </button>
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </div>
                </div>
            ) : (
                <div className="mt-4 flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/10 px-6 py-10 text-center">
                    <GitMerge className="size-10 text-muted-foreground/50" />
                    <p className="mt-3 font-medium text-card-foreground">
                        {searchTerm.trim() ? t('noMatchTitle') : t('emptyTitle')}
                    </p>
                    <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                        {searchTerm.trim() ? t('noMatchDescription') : t('emptyDescription')}
                    </p>
                </div>
            )}
        </section>
    );
}

export function AliasDialogContent() {
    const t = useTranslations('model.alias');
    const { data: models = [] } = useModelList();
    const [searchTerm, setSearchTerm] = useState('');

    return (
        <div className="flex w-screen max-w-4xl flex-col overflow-hidden">
            <MorphingDialogTitle className="shrink-0">
                <header className="mb-4 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-2xl font-bold text-card-foreground">{t('title')}</h2>
                            <Badge variant="outline">{t('advanced')}</Badge>
                        </div>
                        <p className="mt-1 text-sm font-normal text-muted-foreground">{t('description')}</p>
                        <p className="mt-1 text-sm font-medium text-amber-700 dark:text-amber-400">{t('doesNotCreatePrice')}</p>
                    </div>
                    <MorphingDialogClose
                        className="relative right-0 top-0 shrink-0"
                        variants={{
                            initial: { opacity: 0, scale: 0.8 },
                            animate: { opacity: 1, scale: 1 },
                            exit: { opacity: 0, scale: 0.8 },
                        }}
                    />
                </header>
            </MorphingDialogTitle>
            <MorphingDialogDescription className="min-h-0 overflow-hidden">
                <AliasManager
                    models={models}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                />
            </MorphingDialogDescription>
        </div>
    );
}
