'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, FilePlus2, Library, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { ListSkeleton, ListState } from '@/components/common/ListState';
import { toast } from '@/components/common/Toast';
import { cn } from '@/lib/utils';
import {
    useCreateRewriteTemplate,
    useDeleteRewriteTemplate,
    useRewriteTemplates,
    useUpdateRewriteTemplate,
    type RewriteScope,
    type RewriteTemplate,
} from '@/api/endpoints/rewrite';
import {
    cloneOp,
    isSensitiveHeader,
    parseRewriteInput,
    serializeConfig,
    type RewriteConfig,
    type RewriteOperation,
} from './schema';
import {
    builtinTemplatesForScope,
    type BuiltinRewriteTemplate,
    type BuiltinTemplateCategory,
    type BuiltinTemplateRisk,
    type BuiltinTargetFormat,
} from './builtinTemplates';

const TARGET_FORMAT_LABELS: Record<BuiltinTargetFormat, string> = {
    openai_chat: 'OpenAI Chat',
    openai_responses: 'OpenAI Responses',
    anthropic_messages: 'Anthropic Messages',
    gemini: 'Gemini',
};

function targetFormatSummary(formats: BuiltinTargetFormat[]) {
    return formats.map((format) => TARGET_FORMAT_LABELS[format].replace(/^OpenAI /, '')).join(' / ');
}

function categoryLabelKey(category: BuiltinTemplateCategory) {
    switch (category) {
        case 'policy': return 'templateCategoryPolicy' as const;
        case 'compatibility': return 'templateCategoryCompatibility' as const;
        case 'provider': return 'templateCategoryProvider' as const;
        case 'advanced': return 'templateCategoryAdvanced' as const;
    }
}

function riskLabelKey(risk: BuiltinTemplateRisk) {
    switch (risk) {
        case 'low': return 'templateRiskLow' as const;
        case 'medium': return 'templateRiskMedium' as const;
        case 'high': return 'templateRiskHigh' as const;
    }
}

function configHasSensitiveHeaders(config: RewriteConfig): boolean {
    return config.allow_sensitive_headers === true || config.operations.some((op) =>
        isSensitiveHeader(op.header) || isSensitiveHeader(op.from_header) || isSensitiveHeader(op.to_header),
    );
}

function uniqueID(base: string, used: Set<string>): string {
    const stem = base.trim() || 'op';
    if (!used.has(stem)) {
        used.add(stem);
        return stem;
    }
    let suffix = 2;
    while (used.has(`${stem}-${suffix}`)) suffix++;
    const next = `${stem}-${suffix}`;
    used.add(next);
    return next;
}

function appendTemplate(current: RewriteConfig, incoming: RewriteConfig): RewriteConfig {
    const used = new Set(current.operations.map((op) => op.id));
    const appended: RewriteOperation[] = incoming.operations.map((op) => cloneOp(op, uniqueID(op.id, used)));
    return { ...current, operations: [...current.operations, ...appended] };
}

function parseTemplateConfig(template: RewriteTemplate): RewriteConfig | null {
    const parsed = parseRewriteInput(template.config);
    return parsed.kind === 'v2' ? parsed.config : null;
}

export function RewriteTemplateActions({
    scope,
    draft,
    onApply,
}: {
    scope: RewriteScope;
    draft: RewriteConfig;
    onApply: (next: RewriteConfig) => void;
}) {
    const t = useTranslations('rewrite');
    const [browseOpen, setBrowseOpen] = useState(false);
    const [saveOpen, setSaveOpen] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const templates = useRewriteTemplates(scope, browseOpen);
    const createTemplate = useCreateRewriteTemplate();
    const updateTemplate = useUpdateRewriteTemplate();
    const deleteTemplate = useDeleteRewriteTemplate();
    const serializedDraft = useMemo(() => serializeConfig(draft), [draft]);
    const templateSafe = draft.operations.length > 0 && !configHasSensitiveHeaders(draft);
    const replaceNeedsConfirm = draft.operations.length > 0;
    const builtinTemplates = useMemo(() => builtinTemplatesForScope(scope), [scope]);

    const applyTemplate = (template: RewriteTemplate, mode: 'append' | 'replace') => {
        const config = parseTemplateConfig(template);
        if (!config) {
            toast.error(t('templateInvalid'));
            return;
        }
        onApply(mode === 'append' ? appendTemplate(draft, config) : structuredClone(config));
        setBrowseOpen(false);
        toast.success(t(mode === 'append' ? 'templateAppended' : 'templateReplaced'));
    };

    const applyBuiltinTemplate = (template: BuiltinRewriteTemplate, mode: 'append' | 'replace') => {
        const config = structuredClone(template.config);
        onApply(mode === 'append' ? appendTemplate(draft, config) : config);
        setBrowseOpen(false);
        if (template.requiresEdit) {
            toast.warning(t('templateRequiresEditToast'));
        } else {
            toast.success(t(mode === 'append' ? 'templateAppended' : 'templateReplaced'));
        }
    };

    const saveTemplate = () => {
        if (!templateSafe) {
            toast.error(t(draft.operations.length === 0 ? 'templateEmpty' : 'templateSensitiveBlocked'));
            return;
        }
        createTemplate.mutate({
            name: name.trim(),
            description: description.trim() || undefined,
            scope,
            config: serializedDraft,
        }, {
            onSuccess: () => {
                setName('');
                setDescription('');
                setSaveOpen(false);
                toast.success(t('templateSaved'));
            },
            onError: (error) => toast.error(t('templateSaveFailed'), { description: error.message }),
        });
    };

    const overwriteTemplate = (template: RewriteTemplate) => {
        if (!templateSafe) {
            toast.error(t('templateSensitiveBlocked'));
            return;
        }
        updateTemplate.mutate({ ...template, config: serializedDraft }, {
            onSuccess: () => toast.success(t('templateUpdated')),
            onError: (error) => toast.error(t('templateUpdateFailed'), { description: error.message }),
        });
    };

    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <div className="hidden items-center gap-1.5 md:flex">
                <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg text-xs" onClick={() => setBrowseOpen(true)}>
                    <Library className="size-3.5" />
                    {t('templateApply')}
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg text-xs" onClick={() => setSaveOpen(true)} disabled={!templateSafe}>
                    <FilePlus2 className="size-3.5" />
                    {t('templateSave')}
                </Button>
            </div>

            <Popover open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <PopoverTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg text-xs md:hidden">
                        <Library className="size-3.5" />
                        {t('templates')}
                        <ChevronDown className="size-3.5 opacity-60" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="start" collisionPadding={12} className="w-44 rounded-xl p-1 md:hidden">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-9 w-full justify-start rounded-lg px-2 text-xs font-normal"
                        onClick={() => {
                            setMobileMenuOpen(false);
                            setBrowseOpen(true);
                        }}
                    >
                        <Library className="size-3.5" />
                        {t('templateApply')}
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-9 w-full justify-start rounded-lg px-2 text-xs font-normal"
                        onClick={() => {
                            setMobileMenuOpen(false);
                            setSaveOpen(true);
                        }}
                        disabled={!templateSafe}
                    >
                        <FilePlus2 className="size-3.5" />
                        {t('templateSave')}
                    </Button>
                </PopoverContent>
            </Popover>

            <Dialog open={browseOpen} onOpenChange={setBrowseOpen}>
                <DialogContent className="flex max-h-[min(90dvh,42rem)] max-w-[calc(100%-1rem)] flex-col overflow-hidden sm:max-w-2xl">
                    <DialogHeader className="text-left">
                        <DialogTitle>{t('templateLibrary')}</DialogTitle>
                        <DialogDescription>{t('templateLibraryHint')}</DialogDescription>
                    </DialogHeader>
                    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-3 pr-1">
                        <section>
                            <div className="mb-2 flex items-center gap-2">
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('templateBuiltinSection')}</h3>
                                <span className="rounded-full bg-muted px-1.5 py-0.5 text-3xs text-muted-foreground">{builtinTemplates.length}</span>
                            </div>
                            <div className="space-y-2">
                                {builtinTemplates.map((template) => (
                                    <div key={template.key} className="rounded-2xl border border-border/70 bg-muted/10 p-3 transition-colors hover:bg-muted/20">
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                            <div className="min-w-0">
                                                <div className="text-sm font-medium">{t(template.nameKey)}</div>
                                                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t(template.descriptionKey)}</p>
                                                <div className="mt-2 flex flex-wrap gap-1.5">
                                                    <span className="hidden rounded-full border border-border/60 bg-background px-2 py-0.5 text-3xs text-muted-foreground sm:inline-flex">
                                                        {t(categoryLabelKey(template.category))}
                                                    </span>
                                                    <span className={cn(
                                                        'rounded-full border px-2 py-0.5 text-3xs',
                                                        template.risk === 'high'
                                                            ? 'border-destructive/30 bg-destructive/10 text-destructive'
                                                            : template.risk === 'medium'
                                                                ? 'border-warning/30 bg-warning/10 text-warning'
                                                                : 'border-border/60 bg-background text-muted-foreground',
                                                    )}>
                                                        {t(riskLabelKey(template.risk))}
                                                    </span>
                                                    {template.providerHint && (
                                                        <span className="rounded-full border border-border/60 bg-background px-2 py-0.5 text-3xs text-muted-foreground">
                                                            {template.providerHint}
                                                        </span>
                                                    )}
                                                    <span className="rounded-full border border-border/60 bg-background px-2 py-0.5 text-3xs text-muted-foreground sm:hidden">
                                                        {targetFormatSummary(template.targetFormats)}
                                                    </span>
                                                    {template.targetFormats.map((format) => (
                                                        <span key={format} className="hidden rounded-full border border-border/60 bg-background px-2 py-0.5 text-3xs text-muted-foreground sm:inline-flex">
                                                            {TARGET_FORMAT_LABELS[format]}
                                                        </span>
                                                    ))}
                                                    {template.requiresEdit && (
                                                        <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-3xs text-warning">
                                                            {t('templateRequiresEditBadge')}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                                                <Button type="button" variant="outline" size="sm" className="h-11 rounded-xl sm:h-9" onClick={() => applyBuiltinTemplate(template, 'append')}>
                                                    {t('templateAppend')}
                                                </Button>
                                                {replaceNeedsConfirm ? (
                                                    <ConfirmAction
                                                        title={t('templateReplaceTitle')}
                                                        description={t('templateReplaceHint')}
                                                        onConfirm={() => applyBuiltinTemplate(template, 'replace')}
                                                    >
                                                        <Button type="button" variant="ghost" size="sm" className="h-11 w-full rounded-xl text-muted-foreground sm:h-9 sm:w-auto">
                                                            {t('templateReplace')}
                                                        </Button>
                                                    </ConfirmAction>
                                                ) : (
                                                    <Button type="button" variant="ghost" size="sm" className="h-11 w-full rounded-xl text-muted-foreground sm:h-9 sm:w-auto" onClick={() => applyBuiltinTemplate(template, 'replace')}>
                                                        {t('templateReplace')}
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className="border-t border-border/60 pt-4">
                            <div className="mb-2 flex items-center gap-2">
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('templateSavedSection')}</h3>
                                {!templates.isPending && !templates.isError && <span className="rounded-full bg-muted px-1.5 py-0.5 text-3xs text-muted-foreground">{templates.data?.length ?? 0}</span>}
                            </div>
                            {templates.isPending ? (
                                <ListSkeleton count={2} layout="list" itemHeight={96} />
                            ) : templates.isError ? (
                                <ListState tone="error" title={t('templateLoadFailed')} description={templates.error.message} className="mx-auto" />
                            ) : (templates.data?.length ?? 0) === 0 ? (
                                <ListState title={t('templateNone')} description={t('templateNoneHint')} className="mx-auto" />
                            ) : (
                                <div className="space-y-2">
                                {templates.data?.map((template) => (
                                    <div key={template.id} className="rounded-2xl border border-border/70 bg-muted/10 p-3">
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-medium">{template.name}</div>
                                                {template.description && <p className="mt-1 text-xs text-muted-foreground">{template.description}</p>}
                                            </div>
                                            <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 max-sm:grid-cols-2 sm:flex sm:flex-wrap">
                                                <Button type="button" variant="outline" size="sm" className="h-11 rounded-xl sm:h-9" onClick={() => applyTemplate(template, 'append')}>
                                                    {t('templateAppend')}
                                                </Button>
                                                {replaceNeedsConfirm ? (
                                                    <ConfirmAction
                                                        title={t('templateReplaceTitle')}
                                                        description={t('templateReplaceHint')}
                                                        onConfirm={() => applyTemplate(template, 'replace')}
                                                    >
                                                        <Button type="button" variant="ghost" size="sm" className="h-11 w-full rounded-xl text-muted-foreground sm:h-9 sm:w-auto">
                                                            {t('templateReplace')}
                                                        </Button>
                                                    </ConfirmAction>
                                                ) : (
                                                    <Button type="button" variant="ghost" size="sm" className="h-11 w-full rounded-xl text-muted-foreground sm:h-9 sm:w-auto" onClick={() => applyTemplate(template, 'replace')}>
                                                        {t('templateReplace')}
                                                    </Button>
                                                )}
                                                <ConfirmAction
                                                    title={t('templateOverwriteTitle')}
                                                    description={t('templateOverwriteHint')}
                                                    onConfirm={() => overwriteTemplate(template)}
                                                >
                                                    <Button type="button" variant="ghost" size="sm" className="size-11 rounded-xl p-0 sm:size-9" aria-label={t('templateOverwrite')} disabled={!templateSafe || updateTemplate.isPending}>
                                                        <RefreshCw className="size-4" />
                                                    </Button>
                                                </ConfirmAction>
                                                <ConfirmAction
                                                    title={t('templateDeleteTitle')}
                                                    description={t('templateDeleteHint')}
                                                    onConfirm={() => deleteTemplate.mutate({ id: template.id, scope }, {
                                                        onSuccess: () => toast.success(t('templateDeleted')),
                                                        onError: (error) => toast.error(t('templateDeleteFailed'), { description: error.message }),
                                                    })}
                                                >
                                                    <Button type="button" variant="ghost" size="sm" className="size-11 rounded-xl p-0 text-destructive sm:size-9" aria-label={t('templateDelete')} disabled={deleteTemplate.isPending}>
                                                        <Trash2 className="size-4" />
                                                    </Button>
                                                </ConfirmAction>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                </div>
                            )}
                        </section>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
                <DialogContent className="max-w-[calc(100%-1rem)] sm:max-w-md">
                    <DialogHeader className="text-left">
                        <DialogTitle>{t('templateSaveTitle')}</DialogTitle>
                        <DialogDescription>{t('templateSaveHint')}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('templateName')} className="h-10 rounded-xl" />
                        <textarea
                            value={description}
                            onChange={(event) => setDescription(event.target.value)}
                            maxLength={512}
                            placeholder={t('templateDescription')}
                            className="min-h-24 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="secondary" className="h-10 rounded-xl" onClick={() => setSaveOpen(false)}>{t('cancel')}</Button>
                        <Button type="button" className="h-10 rounded-xl" onClick={saveTemplate} disabled={!name.trim() || createTemplate.isPending}>
                            {createTemplate.isPending ? t('templateSaving') : t('templateSave')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
