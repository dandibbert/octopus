'use client';

import { useMemo, useState } from 'react';
import { FilePlus2, Library, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { ListSkeleton, ListState } from '@/components/common/ListState';
import { toast } from '@/components/common/Toast';
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
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const templates = useRewriteTemplates(scope, browseOpen);
    const createTemplate = useCreateRewriteTemplate();
    const updateTemplate = useUpdateRewriteTemplate();
    const deleteTemplate = useDeleteRewriteTemplate();
    const serializedDraft = useMemo(() => serializeConfig(draft), [draft]);
    const templateSafe = draft.operations.length > 0 && !configHasSensitiveHeaders(draft);

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
            <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg text-xs" onClick={() => setBrowseOpen(true)}>
                <Library className="size-3.5" />
                {t('templateApply')}
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg text-xs" onClick={() => setSaveOpen(true)} disabled={!templateSafe}>
                <FilePlus2 className="size-3.5" />
                {t('templateSave')}
            </Button>

            <Dialog open={browseOpen} onOpenChange={setBrowseOpen}>
                <DialogContent className="flex max-h-[min(90dvh,42rem)] max-w-[calc(100%-1rem)] flex-col overflow-hidden sm:max-w-2xl">
                    <DialogHeader className="text-left">
                        <DialogTitle>{t('templateLibrary')}</DialogTitle>
                        <DialogDescription>{t('templateLibraryHint')}</DialogDescription>
                    </DialogHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                        {templates.isPending ? (
                            <ListSkeleton count={3} layout="list" itemHeight={96} />
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
                                            <div className="flex flex-wrap gap-2">
                                                <Button type="button" size="sm" className="h-9 rounded-xl" onClick={() => applyTemplate(template, 'append')}>
                                                    {t('templateAppend')}
                                                </Button>
                                                <Button type="button" variant="outline" size="sm" className="h-9 rounded-xl" onClick={() => applyTemplate(template, 'replace')}>
                                                    {t('templateReplace')}
                                                </Button>
                                                <ConfirmAction
                                                    title={t('templateOverwriteTitle')}
                                                    description={t('templateOverwriteHint')}
                                                    onConfirm={() => overwriteTemplate(template)}
                                                >
                                                    <Button type="button" variant="ghost" size="sm" className="size-9 rounded-xl p-0" aria-label={t('templateOverwrite')} disabled={!templateSafe || updateTemplate.isPending}>
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
                                                    <Button type="button" variant="ghost" size="sm" className="size-9 rounded-xl p-0 text-destructive" aria-label={t('templateDelete')} disabled={deleteTemplate.isPending}>
                                                        <Trash2 className="size-4" />
                                                    </Button>
                                                </ConfirmAction>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
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
