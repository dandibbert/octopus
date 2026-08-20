'use client';

import { useMemo, useState } from 'react';
import {
    DragDropContext,
    Draggable,
    Droppable,
    type DropResult,
} from '@hello-pangea/dnd';
import { ArrowDown, ArrowUp, ChevronLeft, Copy, GripVertical, Plus, Settings2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import JsonView from '@uiw/react-json-view';
import { githubDarkTheme } from '@uiw/react-json-view/githubDark';
import { githubLightTheme } from '@uiw/react-json-view/githubLight';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePreviewRewrite, useValidateRewrite, type RewriteScope } from '@/api/endpoints/rewrite';
import { OperationEditor } from './OperationEditor';
import {
    cloneOp,
    enabledOpCount,
    newOperation,
    parseRewriteInput,
    serializeConfig,
    type RewriteConfig,
    type RewriteOperation,
} from './schema';

type Tab = 'rules' | 'preview' | 'json';

export function RewriteEditor({
    value,
    onChange,
    scope,
    channelId,
    groupId,
    compact,
}: {
    value: string;
    onChange: (next: string) => void;
    scope: RewriteScope;
    channelId?: number;
    groupId?: number;
    compact?: boolean;
}) {
    const t = useTranslations('rewrite');
    const parsed = useMemo(() => parseRewriteInput(value), [value]);
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<Tab>('rules');
    const [draft, setDraft] = useState<RewriteConfig>(parsed.config);
    const [jsonDraft, setJsonDraft] = useState(value);
    const [selected, setSelected] = useState(0);
    const [localError, setLocalError] = useState('');
    const [previewBody, setPreviewBody] = useState('{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}');
    const [dirty, setDirty] = useState(false);
    const [discardOpen, setDiscardOpen] = useState(false);
    const isMobile = useIsMobile();
    const [mobileDetail, setMobileDetail] = useState(false);
    const validate = useValidateRewrite();
    const preview = usePreviewRewrite();
    const { resolvedTheme } = useTheme();

    const resetDraftFromValue = () => {
        const next = parseRewriteInput(value);
        setDraft(next.config);
        setJsonDraft(value);
        setDirty(false);
        setLocalError(next.error === 'json' || next.error === 'object' ? t('invalidJson') : '');
        setSelected(0);
        setTab('rules');
        setMobileDetail(false);
    };

    const openEditor = () => {
        resetDraftFromValue();
        setOpen(true);
    };

    const summary = parsed.kind === 'legacy'
        ? t('summaryLegacy', { count: parsed.legacyFieldCount ?? parsed.config.operations.length })
        : parsed.kind === 'empty'
            ? t('summaryEmpty')
            : t('summaryActive', { count: enabledOpCount(parsed.config) });

    const emitDraft = (next: RewriteConfig) => {
        setDraft(next);
        setDirty(true);
        if (selected >= next.operations.length) setSelected(Math.max(0, next.operations.length - 1));
    };

    const updateOp = (index: number, patch: Partial<RewriteOperation>) => {
        emitDraft({
            ...draft,
            operations: draft.operations.map((op, i) => (i === index ? { ...op, ...patch } : op)),
        });
    };

    const addOp = () => {
        const next = [...draft.operations, newOperation(draft.operations.length)];
        emitDraft({ ...draft, operations: next });
        setSelected(next.length - 1);
        setMobileDetail(true);
    };

    const duplicateOp = (index: number) => {
        const source = draft.operations[index];
        if (!source) return;
        const copy = cloneOp(source, `${source.id}-copy`);
        const operations = [...draft.operations];
        operations.splice(index + 1, 0, copy);
        emitDraft({ ...draft, operations });
        setSelected(index + 1);
    };

    const moveOp = (index: number, delta: number) => {
        const nextIndex = index + delta;
        if (nextIndex < 0 || nextIndex >= draft.operations.length) return;
        const operations = [...draft.operations];
        const [moved] = operations.splice(index, 1);
        operations.splice(nextIndex, 0, moved);
        emitDraft({ ...draft, operations });
        setSelected(nextIndex);
    };

    const removeOp = (index: number) => {
        const operations = draft.operations.filter((_, i) => i !== index);
        emitDraft({ ...draft, operations });
        setMobileDetail(false);
    };

    const onDragEnd = (result: DropResult) => {
        if (!result.destination) return;
        const operations = [...draft.operations];
        const [moved] = operations.splice(result.source.index, 1);
        operations.splice(result.destination.index, 0, moved);
        emitDraft({ ...draft, operations });
        setSelected(result.destination.index);
    };

    const applyJsonTab = () => {
        const next = parseRewriteInput(jsonDraft);
        if (next.kind === 'invalid') {
            setLocalError(t('invalidJson'));
            return false;
        }
        setLocalError('');
        emitDraft(next.config);
        setJsonDraft(next.kind === 'empty' ? '' : serializeConfig(next.config));
        return true;
    };

    const runValidate = () => {
        if (tab === 'json' && !applyJsonTab()) return;
        const payload = serializeConfig(draft);
        let parsedConfig: unknown = {};
        try {
            parsedConfig = payload.trim() ? JSON.parse(payload) : {};
        } catch {
            setLocalError(t('invalidJson'));
            return;
        }
        validate.mutate({ scope, config: parsedConfig }, {
            onError: (err) => setLocalError(err instanceof Error ? err.message : t('validateFailed')),
            onSuccess: () => setLocalError(''),
        });
    };

    const runPreview = () => {
        if (!channelId) return;
        if (tab === 'json' && !applyJsonTab()) return;
        let draftConfig: unknown = {};
        try {
            const raw = serializeConfig(draft);
            draftConfig = raw.trim() ? JSON.parse(raw) : {};
        } catch {
            setLocalError(t('invalidJson'));
            return;
        }
        let body: unknown = {};
        try {
            body = JSON.parse(previewBody);
        } catch {
            setLocalError(t('previewBodyInvalid'));
            return;
        }
        preview.mutate({
            channel_id: channelId,
            group_id: groupId,
            inbound_format: 'openai_chat',
            body,
            draft_scope: scope,
            draft_config: draftConfig,
        });
    };

    const save = () => {
        if (tab === 'json' && !applyJsonTab()) return;
        onChange(serializeConfig(draft));
        setDirty(false);
        setOpen(false);
        setMobileDetail(false);
    };

    const close = () => {
        setDiscardOpen(false);
        setOpen(false);
        setMobileDetail(false);
        setDirty(false);
        resetDraftFromValue();
    };

    const requestClose = () => {
        if (dirty) {
            setDiscardOpen(true);
            return;
        }
        close();
    };

    const current = draft.operations[selected];

    return (
        <div className="space-y-2">
            <div className={cn('flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/10 px-3 py-2', compact && 'py-1.5')}>
                <div className="min-w-0">
                    <div className="text-sm font-medium">{t('title')}</div>
                    <div className="truncate text-xs text-muted-foreground">{summary}</div>
                </div>
                <Button type="button" variant="outline" size="sm" className="h-10 shrink-0 rounded-xl md:h-9" onClick={openEditor}>
                    <Settings2 className="size-4" />
                    {parsed.kind === 'legacy' ? t('convert') : t('configure')}
                </Button>
            </div>
            {parsed.kind === 'legacy' && <p className="text-xs text-muted-foreground">{t('legacyHint')}</p>}
            {localError && !open && <p className="text-xs text-destructive">{localError}</p>}

            <Dialog open={open} onOpenChange={(next) => { if (!next) requestClose(); else openEditor(); }}>
                <DialogContent className="flex h-[min(100dvh,52rem)] max-h-[min(100dvh,52rem)] w-full max-w-[calc(100%-1rem)] flex-col overflow-hidden sm:max-w-5xl md:h-[min(90dvh,52rem)]">
                    <DialogHeader className="shrink-0 pr-8 text-left">
                        <DialogTitle>{t('dialogTitle')}</DialogTitle>
                        <DialogDescription>{t('stageHint')}</DialogDescription>
                    </DialogHeader>

                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                        <div className="flex rounded-xl border border-border/70 bg-muted/20 p-0.5">
                            {(['rules', 'preview', 'json'] as Tab[]).map((item) => (
                                <button
                                    key={item}
                                    type="button"
                                    onClick={() => setTab(item)}
                                    className={cn(
                                        'h-10 rounded-lg px-3 text-xs font-medium transition-colors md:h-9',
                                        tab === item ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                                    )}
                                >
                                    {t(item === 'rules' ? 'tabRules' : item === 'preview' ? 'tabPreview' : 'tabJson')}
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center gap-2">
                            {tab === 'rules' && draft.operations.length > 0 && (
                                <Button type="button" variant="outline" size="sm" className="h-10 rounded-xl md:h-9" onClick={addOp}>
                                    <Plus className="size-4" />
                                    {t('add')}
                                </Button>
                            )}
                            <Button type="button" variant="outline" size="sm" className="h-10 rounded-xl md:h-9" onClick={runValidate} disabled={validate.isPending}>
                                {validate.isPending ? t('validating') : t('validate')}
                            </Button>
                        </div>
                    </div>

                    {validate.data?.ok && !localError && <p className="text-xs text-success">{t('validateOk')}</p>}
                    {(localError || validate.error) && (
                        <p className="text-xs text-destructive">{localError || (validate.error instanceof Error ? validate.error.message : t('validateFailed'))}</p>
                    )}
                    {scope === 'group' && <p className="text-xs text-muted-foreground">{t('groupWarning')}</p>}
                    {draft.policy?.on_error === 'warn_and_continue' && <p className="text-xs text-muted-foreground">{t('warnContinueHint')}</p>}

                    <div className="min-h-0 flex-1 overflow-hidden">
                        {tab === 'rules' && (
                            <div className={cn(
                                'flex h-full min-h-0 flex-col gap-3',
                                draft.operations.length > 0 && 'md:grid md:grid-cols-[minmax(16rem,18rem)_minmax(0,1fr)]',
                            )}>
                                <div className={cn(
                                    'min-h-0 overflow-y-auto pr-1',
                                    isMobile && mobileDetail && 'hidden',
                                    !isMobile && 'block',
                                    draft.operations.length === 0 && 'flex flex-1 flex-col',
                                )}>
                                    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <Switch checked={draft.enabled !== false} onCheckedChange={(checked) => emitDraft({ ...draft, enabled: checked })} />
                                        {t('enabled')}
                                    </label>
                                    {scope === 'channel' && (
                                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <Switch
                                                checked={draft.allow_sensitive_headers === true}
                                                onCheckedChange={(checked) => emitDraft({ ...draft, allow_sensitive_headers: checked })}
                                            />
                                            {t('allowSensitive')}
                                        </label>
                                    )}
                                    </div>
                                    {draft.operations.length === 0 ? (
                                        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 px-4 py-8 text-center">
                                            <p className="text-sm text-muted-foreground">{t('empty')}</p>
                                            <Button type="button" variant="outline" size="sm" className="h-10 rounded-xl md:h-9" onClick={addOp}>
                                                <Plus className="size-4" />
                                                {t('add')}
                                            </Button>
                                        </div>
                                    ) : (
                                    <DragDropContext onDragEnd={onDragEnd}>
                                        <Droppable droppableId="rewrite-ops">
                                            {(provided) => (
                                                <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
                                                    {draft.operations.map((op, index) => (
                                                        <Draggable key={`${op.id}-${index}`} draggableId={`${op.id}-${index}`} index={index}>
                                                            {(drag) => (
                                                                <div
                                                                    ref={drag.innerRef}
                                                                    {...drag.draggableProps}
                                                                    className={cn(
                                                                        'rounded-xl border bg-muted/10 p-2',
                                                                        selected === index ? 'border-border' : 'border-border/50',
                                                                    )}
                                                                >
                                                                    <div className="flex items-start gap-2">
                                                                        <button type="button" className="mt-1.5 text-muted-foreground" {...drag.dragHandleProps} aria-label={t('reorder')}>
                                                                            <GripVertical className="size-4" />
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            className="min-w-0 flex-1 text-left"
                                                                            onClick={() => {
                                                                                setSelected(index);
                                                                                setMobileDetail(true);
                                                                            }}
                                                                        >
                                                                            <div className="truncate text-sm font-medium">{index + 1}. {op.name || op.id}</div>
                                                                            <div className="truncate text-[11px] text-muted-foreground">{op.op}</div>
                                                                        </button>
                                                                        <div className="flex shrink-0 items-center">
                                                                            <Button type="button" variant="ghost" size="sm" className="size-10 rounded-lg p-0 text-muted-foreground md:size-9" onClick={() => moveOp(index, -1)} aria-label={t('moveUp')}>
                                                                                <ArrowUp className="size-4" />
                                                                            </Button>
                                                                            <Button type="button" variant="ghost" size="sm" className="size-10 rounded-lg p-0 text-muted-foreground md:size-9" onClick={() => moveOp(index, 1)} aria-label={t('moveDown')}>
                                                                                <ArrowDown className="size-4" />
                                                                            </Button>
                                                                            <Button type="button" variant="ghost" size="sm" className="size-10 rounded-lg p-0 text-muted-foreground md:size-9" onClick={() => duplicateOp(index)} aria-label={t('duplicate')}>
                                                                                <Copy className="size-4" />
                                                                            </Button>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </Draggable>
                                                    ))}
                                                    {provided.placeholder}
                                                </div>
                                            )}
                                        </Droppable>
                                    </DragDropContext>
                                    )}
                                </div>
                                <div className={cn('min-h-0 overflow-y-auto rounded-xl border border-border/60 p-3', (isMobile && !mobileDetail) || (!isMobile && !current) ? 'hidden' : 'block')}>
                                    {isMobile && mobileDetail && (
                                        <Button type="button" variant="ghost" size="sm" className="mb-2 h-10 rounded-xl md:h-9" onClick={() => setMobileDetail(false)}>
                                            <ChevronLeft className="size-4" />
                                            {t('back')}
                                        </Button>
                                    )}
                                    {current ? (
                                        <div className="space-y-3">
                                            <OperationEditor
                                                op={current}
                                                scope={scope}
                                                allowSensitive={draft.allow_sensitive_headers}
                                                onChange={(patch) => updateOp(selected, patch)}
                                            />
                                            <ConfirmAction
                                                title={t('removeConfirmTitle')}
                                                description={t('removeConfirm')}
                                                onConfirm={() => removeOp(selected)}
                                            >
                                                <Button type="button" variant="outline" size="sm" className="h-10 rounded-xl text-destructive md:h-9">
                                                    {t('remove')}
                                                </Button>
                                            </ConfirmAction>
                                        </div>
                                    ) : (
                                        <div className="py-10 text-center text-xs text-muted-foreground">{t('selectOrAdd')}</div>
                                    )}
                                </div>
                            </div>
                        )}

                        {tab === 'preview' && (
                            <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
                                <textarea
                                    value={previewBody}
                                    onChange={(event) => setPreviewBody(event.target.value)}
                                    className="min-h-28 flex-1 w-full resize-none rounded-xl border border-border bg-background px-3 py-2 font-mono text-xs"
                                />
                                <Button type="button" className="h-10 rounded-xl md:h-9" onClick={runPreview} disabled={preview.isPending || !channelId}>
                                    {preview.isPending ? t('previewing') : t('runPreview')}
                                </Button>
                                {!channelId && <p className="text-xs text-muted-foreground">{t('previewNeedsChannel')}</p>}
                                {preview.error && (
                                    <p className="text-xs text-destructive">{preview.error instanceof Error ? preview.error.message : t('previewFailed')}</p>
                                )}
                                {preview.data && (
                                    <div className="space-y-3">
                                        <div className="text-xs text-muted-foreground">{t('targetFormat')}: {preview.data.target_format}</div>
                                        <PreviewJson title={t('finalBody')} value={preview.data.stages.final_body} theme={resolvedTheme} />
                                        <PreviewJson title={t('finalHeaders')} value={preview.data.stages.final_headers} theme={resolvedTheme} />
                                        {preview.data.trace && preview.data.trace.length > 0 && (
                                            <div className="rounded-xl border border-border/60 p-3">
                                                <div className="mb-2 text-xs font-medium">{t('trace')}</div>
                                                <div className="space-y-1">
                                                    {preview.data.trace.map((entry) => (
                                                        <div key={`${entry.operation_id}-${entry.index}`} className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                                                            <span className="font-mono text-foreground">{entry.operation_id}</span>
                                                            <span>{entry.operation}</span>
                                                            <span>{entry.status}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {tab === 'json' && (
                            <textarea
                                value={jsonDraft || serializeConfig(draft)}
                                onChange={(event) => {
                                    setJsonDraft(event.target.value);
                                    setDirty(true);
                                }}
                                placeholder={t('jsonPlaceholder')}
                                className="h-full min-h-48 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                        )}
                    </div>

                    <DialogFooter className="shrink-0 flex-row justify-end border-t border-border/40 pt-3">
                        {dirty && <p className="mr-auto text-xs text-muted-foreground">{t('unsaved')}</p>}
                        <Button type="button" variant="secondary" className="h-11 rounded-xl" onClick={requestClose}>{t('cancel')}</Button>
                        <Button type="button" className="h-11 rounded-xl" onClick={save}>{t('save')}</Button>
                    </DialogFooter>
                    <ConfirmAction
                        open={discardOpen}
                        onOpenChange={setDiscardOpen}
                        title={t('discardTitle')}
                        description={t('discardConfirm')}
                        confirmLabel={t('discard')}
                        onConfirm={close}
                    >
                        <button type="button" className="sr-only" tabIndex={-1} aria-hidden />
                    </ConfirmAction>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function PreviewJson({ title, value, theme }: { title: string; value: unknown; theme?: string }) {
    if (value === undefined) return null;
    const parsed = typeof value === 'string' ? safeParse(value) : value;
    return (
        <div className="rounded-xl border border-border/60 p-3">
            <div className="mb-2 text-xs font-medium">{title}</div>
            {parsed && typeof parsed === 'object' ? (
                <JsonView
                    value={parsed as object}
                    style={{
                        ...(theme === 'dark' ? githubDarkTheme : githubLightTheme),
                        fontSize: '12px',
                        backgroundColor: 'transparent',
                    }}
                    displayDataTypes={false}
                    displayObjectSize={false}
                    collapsed={1}
                />
            ) : (
                <pre className="overflow-x-auto text-[11px]">{String(value ?? '')}</pre>
            )}
        </div>
    );
}

function safeParse(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}
