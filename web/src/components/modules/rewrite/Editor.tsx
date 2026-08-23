'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    DragDropContext,
    Draggable,
    Droppable,
    type DropResult,
} from '@hello-pangea/dnd';
import { ChevronLeft, Copy, GripVertical, Settings2, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import JsonView from '@uiw/react-json-view';
import { githubDarkTheme } from '@uiw/react-json-view/githubDark';
import { githubLightTheme } from '@uiw/react-json-view/githubLight';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { ListState } from '@/components/common/ListState';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePreviewRewrite, useValidateRewrite, type RewriteScope } from '@/api/endpoints/rewrite';
import { OperationEditor } from './OperationEditor';
import { RewriteTemplateActions } from './TemplateActions';
import { findUneditedBuiltinPlaceholder } from './builtinTemplates';
import { parseRewritePayload } from './payload';
import { AddOperationMenu } from './AddOperationMenu';
import { operationLabel } from './labels';
import {
    cloneOp,
    enabledOpCount,
    parseRewriteInput,
    serializeConfig,
    type RewriteConfig,
    type RewriteOperation,
} from './schema';

type Tab = 'rules' | 'preview' | 'json';

function mutationErrorMessage(error: unknown, fallback: string): string {
    if (error && typeof error === 'object') {
        if ('rawMessage' in error && typeof error.rawMessage === 'string') return error.rawMessage;
        if ('message' in error && typeof error.message === 'string') return error.message;
    }
    return fallback;
}

export function RewriteEditor({
    value,
    onChange,
    scope,
    channelId,
    groupId,
    previewModel,
    compact,
}: {
    value: string;
    onChange: (next: string) => void;
    scope: RewriteScope;
    channelId?: number;
    groupId?: number;
    previewModel?: string;
    compact?: boolean;
}) {
    const t = useTranslations('rewrite');
    const parsed = useMemo(() => parseRewriteInput(value), [value]);
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<Tab>('rules');
    const [draft, setDraft] = useState<RewriteConfig>(parsed.config);
    const [jsonDraft, setJsonDraft] = useState(value);
    const [selected, setSelected] = useState(0);
    const [checkedOperations, setCheckedOperations] = useState<Set<number>>(new Set());
    const [focusRequest, setFocusRequest] = useState(0);
    const [localError, setLocalError] = useState('');
    const [previewBody, setPreviewBody] = useState('{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}');
    const [previewHeaders, setPreviewHeaders] = useState('{}');
    const [previewFormat, setPreviewFormat] = useState('openai_chat');
    const [previewTargetModel, setPreviewTargetModel] = useState(previewModel ?? '');
    const [dirty, setDirty] = useState(false);
    const [discardOpen, setDiscardOpen] = useState(false);
    const dialogRef = useRef<HTMLDivElement>(null);
    const rowKeys = useRef(new WeakMap<RewriteOperation, string>());
    const rowKeySequence = useRef(0);
    const isMobile = useIsMobile();
    const [mobileDetail, setMobileDetail] = useState(false);
    const validate = useValidateRewrite();
    const preview = usePreviewRewrite();
    const { resolvedTheme } = useTheme();

    const getRowKey = (operation: RewriteOperation) => {
        const existing = rowKeys.current.get(operation);
        if (existing) return existing;
        const next = `rewrite-row-${rowKeySequence.current++}`;
        rowKeys.current.set(operation, next);
        return next;
    };

    useEffect(() => {
        setPreviewTargetModel(previewModel ?? '');
    }, [previewModel]);

    useEffect(() => {
        if (!open) return;
        let settleTimer: number | undefined;
        const scrollFocusedFieldIntoView = () => {
            const active = document.activeElement;
            if (!(active instanceof HTMLElement) || !dialogRef.current?.contains(active)) return;
            active.scrollIntoView({ block: 'center', inline: 'nearest' });
        };
        const keepFocusedFieldVisible = () => {
            window.requestAnimationFrame(scrollFocusedFieldIntoView);
            window.clearTimeout(settleTimer);
            settleTimer = window.setTimeout(scrollFocusedFieldIntoView, 120);
        };
        window.addEventListener('resize', keepFocusedFieldVisible);
        window.visualViewport?.addEventListener('resize', keepFocusedFieldVisible);
        return () => {
            window.clearTimeout(settleTimer);
            window.removeEventListener('resize', keepFocusedFieldVisible);
            window.visualViewport?.removeEventListener('resize', keepFocusedFieldVisible);
        };
    }, [open]);

    const parseErrorMessage = (error?: string) => error === 'schema' ? t('invalidSchema') : t('invalidJson');

    const resetDraftFromValue = () => {
        const next = parseRewriteInput(value);
        setDraft(next.config);
        setJsonDraft(value);
        setDirty(false);
        setLocalError(next.kind === 'invalid' ? parseErrorMessage(next.error) : '');
        setSelected(0);
        setCheckedOperations(new Set());
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
        setJsonDraft(serializeConfig(next));
        setDirty(true);
        if (selected >= next.operations.length) setSelected(Math.max(0, next.operations.length - 1));
    };

    const updateOp = (index: number, patch: Partial<RewriteOperation>) => {
        emitDraft({
            ...draft,
            operations: draft.operations.map((op, i) => (i === index ? { ...op, ...patch } : op)),
        });
    };

    const duplicateOp = (index: number) => {
        const source = draft.operations[index];
        if (!source) return;
        const used = new Set(draft.operations.map((op) => op.id));
        const base = `${source.id}-copy`;
        let copyID = base;
        let suffix = 2;
        while (used.has(copyID)) copyID = `${base}-${suffix++}`;
        const copy = cloneOp(source, copyID);
        const operations = [...draft.operations];
        operations.splice(index + 1, 0, copy);
        emitDraft({ ...draft, operations });
        setSelected(index + 1);
    };

    const removeOp = (index: number) => {
        const operations = draft.operations.filter((_, i) => i !== index);
        emitDraft({ ...draft, operations });
        setCheckedOperations((current) => new Set(
            [...current]
                .filter((item) => item !== index)
                .map((item) => item > index ? item - 1 : item),
        ));
        setMobileDetail(false);
    };

    const removeCheckedOperations = () => {
        if (!checkedOperations.size) return;
        const operations = draft.operations.filter((_, index) => !checkedOperations.has(index));
        emitDraft({ ...draft, operations });
        setCheckedOperations(new Set());
        setSelected(Math.min(selected, Math.max(0, operations.length - 1)));
        if (!operations.length) setMobileDetail(false);
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
            setLocalError(parseErrorMessage(next.error));
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
        let parsedConfig: unknown;
        try {
            parsedConfig = parseRewritePayload(payload);
        } catch {
            setLocalError(t('invalidJson'));
            return;
        }
        validate.mutate({ scope, config: parsedConfig }, {
            onError: (err) => setLocalError(mutationErrorMessage(err, t('validateFailed'))),
            onSuccess: () => setLocalError(''),
        });
    };

    const runPreview = () => {
        if (!channelId) return;
        if (tab === 'json' && !applyJsonTab()) return;
        let draftConfig: unknown;
        try {
            const raw = serializeConfig(draft);
            draftConfig = parseRewritePayload(raw);
        } catch {
            setLocalError(t('invalidJson'));
            return;
        }
        let body: unknown = {};
        let headers: Record<string, string> = {};
        try {
            body = JSON.parse(previewBody);
        } catch {
            setLocalError(t('previewBodyInvalid'));
            return;
        }
        try {
            const parsedHeaders = JSON.parse(previewHeaders) as unknown;
            if (!parsedHeaders || typeof parsedHeaders !== 'object' || Array.isArray(parsedHeaders)) throw new Error('headers must be an object');
            headers = Object.fromEntries(Object.entries(parsedHeaders as Record<string, unknown>).map(([key, val]) => [key, String(val)]));
        } catch {
            setLocalError(t('previewHeadersInvalid'));
            return;
        }
        preview.mutate({
            channel_id: channelId,
            group_id: groupId,
            target_model: previewTargetModel.trim() || previewModel,
            inbound_format: previewFormat,
            body,
            headers,
            draft_scope: scope,
            draft_config: draftConfig,
        }, { onSuccess: () => setLocalError('') });
    };

    const focusValidationError = (message: string, operations: RewriteOperation[] = draft.operations) => {
        const operationMatch = message.match(/operation (\d+)/i);
        const duplicateMatch = message.match(/duplicate operation id ["']([^"']+)["']/i);
        let index = operationMatch ? Number(operationMatch[1]) : -1;
        if (index < 0 && duplicateMatch) index = operations.findIndex((op) => op.id === duplicateMatch[1]);
        if (index >= 0 && index < operations.length) setSelected(index);
        setTab('rules');
        setMobileDetail(true);
        window.setTimeout(() => {
            const root = dialogRef.current;
            if (!root) return;
            const placeholder = /missing id|duplicate operation id/i.test(message)
                ? '操作 ID'
                : /header/i.test(message)
                    ? 'Header 名'
                    : /index/i.test(message)
                        ? '插入下标'
                        : /path|pointer/i.test(message)
                            ? 'JSON 路径，例如 /temperature'
                            : '';
            const field = placeholder
                ? root.querySelector<HTMLElement>(`[placeholder="${placeholder}"]`)
                : root.querySelector<HTMLElement>('[data-rewrite-primary], [aria-invalid="true"]');
            field?.focus();
        }, 50);
    };

    const save = (keepEditing = false) => {
        const invalidLiteral = dialogRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
        if (invalidLiteral) {
            setTab('rules');
            setLocalError(t('validateFailed'));
            invalidLiteral.focus();
            return;
        }
        let nextDraft = draft;
        if (tab === 'json') {
            const next = parseRewriteInput(jsonDraft);
            if (next.kind === 'invalid') {
                setLocalError(parseErrorMessage(next.error));
                return;
            }
            nextDraft = next.config;
            setDraft(next.config);
            setJsonDraft(next.kind === 'empty' ? '' : serializeConfig(next.config));
        }
        const placeholder = findUneditedBuiltinPlaceholder(nextDraft);
        if (placeholder) {
            const index = nextDraft.operations.findIndex((operation) => operation.id === placeholder.operationId);
            setLocalError(t('templatePlaceholderError', { header: placeholder.header }));
            setTab('rules');
            if (index >= 0) setSelected(index);
            setMobileDetail(true);
            return;
        }
        let config: unknown;
        try {
            config = parseRewritePayload(serializeConfig(nextDraft));
        } catch {
            setLocalError(t('invalidJson'));
            return;
        }
        validate.mutate({ scope, config }, {
            onSuccess: () => {
                onChange(serializeConfig(nextDraft));
                setLocalError('');
                setDirty(false);
                if (!keepEditing) {
                    setOpen(false);
                    setMobileDetail(false);
                }
            },
            onError: (error) => {
                const message = mutationErrorMessage(error, t('validateFailed'));
                setLocalError(message);
                focusValidationError(message, nextDraft.operations);
            },
        });
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
        <div className="space-y-1.5">
            <div className={cn(
                'flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background px-3',
                compact ? 'py-1.5' : 'py-2.5'
            )}>
                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium text-foreground">{t('title')}</span>
                        <span className="truncate text-xs text-muted-foreground">{summary}</span>
                    </div>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 shrink-0 rounded-lg px-3 text-xs"
                    onClick={openEditor}
                >
                    <Settings2 className="size-3.5" />
                    {parsed.kind === 'legacy' ? t('convert') : parsed.kind === 'empty' ? t('add') : t('configure')}
                </Button>
            </div>
            {parsed.kind === 'legacy' && (
                <p className="px-1 text-xs text-muted-foreground">{t('legacyHint')}</p>
            )}
            {localError && !open && (
                <p className="px-1 text-xs text-destructive">{localError}</p>
            )}

            <Dialog open={open} onOpenChange={(next) => { if (!next) requestClose(); else openEditor(); }}>
                <DialogContent ref={dialogRef} className="flex h-[min(100dvh,52rem)] max-h-[min(100dvh,52rem)] w-full max-w-[calc(100%-1rem)] flex-col overflow-hidden sm:max-w-5xl md:h-[min(90dvh,52rem)]">
                    <DialogHeader className="shrink-0 space-y-1 pr-8 text-left">
                        <DialogTitle>{t('dialogTitle')}</DialogTitle>
                        <DialogDescription className="text-xs">
                            {scope === 'group' ? t('scopeGroup') : t('scopeChannel')}
                            {' · '}
                            {t('stageHint')}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2">
                        <div className="flex rounded-lg border border-border/60 bg-muted/30 p-0.5" role="tablist" aria-label={t('dialogTitle')}>
                            {(['rules', 'preview', 'json'] as Tab[]).map((item) => (
                                <Button
                                    key={item}
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setTab(item)}
                                    onKeyDown={(event) => {
                                        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                                        event.preventDefault();
                                        const tabs = ['rules', 'preview', 'json'] as Tab[];
                                        const offset = event.key === 'ArrowRight' ? 1 : -1;
                                        const next = tabs[(tabs.indexOf(item) + offset + tabs.length) % tabs.length];
                                        setTab(next);
                                        event.currentTarget.parentElement
                                            ?.querySelector<HTMLButtonElement>(`[data-rewrite-tab="${next}"]`)
                                            ?.focus();
                                    }}
                                    id={`rewrite-tab-${item}`}
                                    role="tab"
                                    aria-selected={tab === item}
                                    aria-controls={`rewrite-panel-${item}`}
                                    data-rewrite-tab={item}
                                    tabIndex={tab === item ? 0 : -1}
                                    className={cn(
                                        'h-8 rounded-md px-3 text-xs font-medium transition-colors hover:bg-transparent motion-reduce:transition-none',
                                        tab === item
                                            ? 'bg-background text-foreground shadow-sm'
                                            : 'text-muted-foreground hover:text-foreground',
                                    )}
                                >
                                    {t(item === 'rules' ? 'tabRules' : item === 'preview' ? 'tabPreview' : 'tabJson')}
                                </Button>
                            ))}
                        </div>
                        <div className="flex items-center gap-1.5">
                            <RewriteTemplateActions scope={scope} draft={draft} onApply={emitDraft} />
                            {tab === 'rules' && draft.operations.length > 0 && (
                                <AddOperationMenu onAdd={(op) => {
                                    const next = [...draft.operations, op];
                                    emitDraft({ ...draft, operations: next });
                                    setSelected(next.length - 1);
                                    setMobileDetail(true);
                                    setFocusRequest((current) => current + 1);
                                }} />
                            )}
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 rounded-lg text-xs text-muted-foreground"
                                onClick={runValidate}
                                disabled={validate.isPending}
                            >
                                {validate.isPending ? t('validating') : t('validate')}
                            </Button>
                        </div>
                    </div>

                    {(validate.data?.ok && !localError) && (
                        <p className="shrink-0 text-xs text-success">{t('validateOk')}</p>
                    )}
                    {(localError || validate.error) && (
                        <p className="shrink-0 text-xs text-destructive">
                            {localError || (validate.error instanceof Error ? validate.error.message : t('validateFailed'))}
                        </p>
                    )}

                    <div
                        id={`rewrite-panel-${tab}`}
                        role="tabpanel"
                        aria-labelledby={`rewrite-tab-${tab}`}
                        className="min-h-0 flex-1 overflow-hidden"
                    >
                        {tab === 'rules' && (
                            <div className={cn(
                                'flex h-full min-h-0 flex-col gap-3',
                                draft.operations.length > 0 && 'md:grid md:grid-cols-[minmax(16rem,18rem)_minmax(0,1fr)]',
                            )}>
                                <div className={cn(
                                    'min-h-0 overflow-y-auto overscroll-contain touch-pan-y [-webkit-overflow-scrolling:touch]',
                                    isMobile && mobileDetail && 'hidden',
                                    !isMobile && 'block',
                                    draft.operations.length === 0 && 'flex flex-1 flex-col',
                                )}>
                                    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
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
                                        <ListState
                                            icon={Settings2}
                                            title={t('emptyTitle')}
                                            description={t('emptyDescription')}
                                            className="mx-auto w-full max-w-md flex-1 justify-center"
                                            action={(
                                                <AddOperationMenu onAdd={(op) => {
                                                    const next = [op];
                                                    emitDraft({ ...draft, operations: next });
                                                    setSelected(0);
                                                    setMobileDetail(true);
                                                    setFocusRequest((current) => current + 1);
                                                }} />
                                            )}
                                        />
                                    ) : (
                                        <div className="space-y-2">
                                            <div className="flex min-h-8 items-center justify-between gap-2 px-1">
                                                <span className="text-xs text-muted-foreground">{t('ruleCount', { count: draft.operations.length })}</span>
                                                {checkedOperations.size > 0 && (
                                                    <ConfirmAction
                                                        title={t('removeSelectedTitle', { count: checkedOperations.size })}
                                                        description={t('removeSelectedConfirm')}
                                                        onConfirm={removeCheckedOperations}
                                                    >
                                                        <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg text-xs text-destructive hover:bg-destructive/10 hover:text-destructive">
                                                            <Trash2 className="size-3.5" />
                                                            {t('removeSelected', { count: checkedOperations.size })}
                                                        </Button>
                                                    </ConfirmAction>
                                                )}
                                            </div>
                                            <DragDropContext onDragEnd={onDragEnd}>
                                                <Droppable droppableId="rewrite-ops">
                                                    {(provided) => (
                                                        <div ref={provided.innerRef} {...provided.droppableProps} className="divide-y divide-border/40 rounded-lg border border-border/40">
                                                            {draft.operations.map((op, index) => {
                                                                const rowKey = getRowKey(op);
                                                                return (
                                                                <Draggable key={rowKey} draggableId={rowKey} index={index}>
                                                                    {(drag, snapshot) => (
                                                                        <div
                                                                            ref={drag.innerRef}
                                                                            {...drag.draggableProps}
                                                                            className={cn(
                                                                                'group grid min-w-0 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-1 px-1.5 py-1.5 transition-colors',
                                                                                selected === index ? 'bg-muted/50' : 'hover:bg-muted/30',
                                                                                snapshot.isDragging && 'bg-muted shadow-lg',
                                                                                op.enabled === false && 'opacity-60',
                                                                            )}
                                                                        >
                                                                            <div className="flex flex-col items-center gap-0.5">
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={checkedOperations.has(index)}
                                                                                    onChange={(event) => setCheckedOperations((current) => {
                                                                                        const next = new Set(current);
                                                                                        if (event.target.checked) next.add(index); else next.delete(index);
                                                                                        return next;
                                                                                    })}
                                                                                    aria-label={t('selectRule', { index: index + 1 })}
                                                                                    className="size-4 rounded border-border accent-primary"
                                                                                />
                                                                                <div
                                                                                    role="button"
                                                                                    tabIndex={0}
                                                                                    className="grid size-10 touch-none select-none cursor-grab place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground data-[dragging=true]:cursor-grabbing md:size-8"
                                                                                    {...drag.dragHandleProps}
                                                                                    aria-label={t('reorder')}
                                                                                    data-dragging={snapshot.isDragging}
                                                                                >
                                                                                    <GripVertical className="size-4" />
                                                                                </div>
                                                                            </div>
                                                                            <Button
                                                                                type="button"
                                                                                variant="ghost"
                                                                                size="sm"
                                                                                className="h-auto min-w-0 justify-start rounded-md px-1.5 py-1 text-left hover:bg-transparent hover:text-foreground"
                                                                                onClick={() => {
                                                                                    setSelected(index);
                                                                                    setMobileDetail(true);
                                                                                }}
                                                                            >
                                                                                <div className="min-w-0">
                                                                                    <div className="flex min-w-0 items-center gap-1.5">
                                                                                        <span className="shrink-0 text-xs text-muted-foreground">{index + 1}.</span>
                                                                                        <span className="truncate text-sm font-medium text-foreground">{operationLabel(t, String(op.op))}</span>
                                                                                        {op.when && <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-3xs text-muted-foreground">{t('hasCondition')}</span>}
                                                                                    </div>
                                                                                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                                                                                        {op.path || op.header || op.name || t('noTarget')}
                                                                                    </div>
                                                                                </div>
                                                                            </Button>
                                                                            <div className="flex shrink-0 items-center gap-0.5">
                                                                                <Button type="button" variant="ghost" size="icon-sm" className="size-10 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:size-8" onClick={() => duplicateOp(index)} aria-label={t('duplicate')} title={op.id}>
                                                                                    <Copy className="size-3.5" />
                                                                                </Button>
                                                                                <ConfirmAction title={t('removeConfirmTitle')} description={t('removeConfirm')} onConfirm={() => removeOp(index)}>
                                                                                    <Button type="button" variant="ghost" size="icon-sm" className="size-10 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive md:size-8" aria-label={t('remove')}>
                                                                                        <Trash2 className="size-3.5" />
                                                                                    </Button>
                                                                                </ConfirmAction>
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </Draggable>
                                                                );
                                                            })}
                                                            {provided.placeholder}
                                                        </div>
                                                    )}
                                                </Droppable>
                                            </DragDropContext>
                                        </div>
                                    )}
                                </div>
                                <div className={cn(
                                    'min-h-0 overflow-y-auto overscroll-contain touch-pan-y rounded-lg border border-border/40 bg-background [-webkit-overflow-scrolling:touch]',
                                    (isMobile && !mobileDetail) || (!isMobile && !current) ? 'hidden' : 'block',
                                )}>
                                    {isMobile && mobileDetail && (
                                        <div className="sticky top-0 z-10 flex min-w-0 items-center gap-2 border-b border-border/40 bg-background px-3 py-2">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-8 rounded-lg px-2 text-xs"
                                                onClick={() => setMobileDetail(false)}
                                            >
                                                <ChevronLeft className="size-3.5" />
                                                {t('backToOperations')}
                                            </Button>
                                            <span className="min-w-0 truncate text-sm font-medium text-foreground">
                                                {current ? operationLabel(t, String(current.op)) : t('ruleDetail')}
                                            </span>
                                        </div>
                                    )}
                                    {current ? (
                                        <div className="p-3">
                                            <OperationEditor
                                                op={current}
                                                scope={scope}
                                                allowSensitive={draft.allow_sensitive_headers}
                                                focusRequest={focusRequest}
                                                onChange={(patch) => updateOp(selected, patch)}
                                            />
                                            <div className="mt-4 border-t border-border/40 pt-3">
                                                <ConfirmAction
                                                    title={t('removeConfirmTitle')}
                                                    description={t('removeConfirm')}
                                                    onConfirm={() => removeOp(selected)}
                                                >
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-8 rounded-lg text-xs text-destructive hover:bg-destructive/10"
                                                    >
                                                        {t('remove')}
                                                    </Button>
                                                </ConfirmAction>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex min-h-32 items-center justify-center p-4 text-xs text-muted-foreground">
                                            {t('selectOrAdd')}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {tab === 'preview' && (
                            <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
                                <div className="grid shrink-0 grid-cols-1 gap-2 md:grid-cols-2">
                                    <label className="grid gap-1 text-xs text-muted-foreground">
                                        <span>{t('previewInboundFormat')}</span>
                                        <Select value={previewFormat} onValueChange={setPreviewFormat}>
                                            <SelectTrigger className="h-9 rounded-lg"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="openai_chat">OpenAI Chat Completions</SelectItem>
                                                <SelectItem value="openai_responses">OpenAI Responses</SelectItem>
                                                <SelectItem value="anthropic_messages">Anthropic Messages</SelectItem>
                                                <SelectItem value="openai_embedding">OpenAI Embeddings</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </label>
                                    <label className="grid gap-1 text-xs text-muted-foreground">
                                        <span>{t('previewTargetModel')}</span>
                                        <Input
                                            value={previewTargetModel}
                                            onChange={(event) => setPreviewTargetModel(event.target.value)}
                                            placeholder={previewModel || t('previewTargetModelPlaceholder')}
                                            className="h-9 rounded-lg"
                                        />
                                    </label>
                                </div>
                                <div className="grid shrink-0 grid-cols-1 gap-2 md:grid-cols-2">
                                    <div className="space-y-1">
                                        <span className="text-xs text-muted-foreground">{t('previewBody')}</span>
                                        <textarea
                                            value={previewBody}
                                            onChange={(event) => setPreviewBody(event.target.value)}
                                            aria-label={t('previewBody')}
                                            className="min-h-24 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-xs text-muted-foreground">{t('previewHeaders')}</span>
                                        <textarea
                                            value={previewHeaders}
                                            onChange={(event) => setPreviewHeaders(event.target.value)}
                                            aria-label={t('previewHeaders')}
                                            placeholder={t('previewHeadersPlaceholder')}
                                            className="min-h-24 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs"
                                        />
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    <Button
                                        type="button"
                                        className="h-9 rounded-lg"
                                        onClick={runPreview}
                                        disabled={preview.isPending || !channelId}
                                    >
                                        {preview.isPending ? t('previewing') : t('runPreview')}
                                    </Button>
                                    {!channelId && (
                                        <p className="text-xs text-muted-foreground">{t('previewNeedsChannel')}</p>
                                    )}
                                </div>
                                {preview.error && (
                                    <p className="shrink-0 text-xs text-destructive">
                                        {preview.error instanceof Error ? preview.error.message : t('previewFailed')}
                                    </p>
                                )}
                                {preview.data && (
                                    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain touch-pan-y [-webkit-overflow-scrolling:touch]">
                                        <PreviewStageView data={preview.data} scope={scope} theme={resolvedTheme} t={t} />
                                    </div>
                                )}
                            </div>
                        )}

                        {tab === 'json' && (
                            <div className="flex h-full min-h-0 flex-col gap-2">
                                <textarea
                                    value={jsonDraft || serializeConfig(draft)}
                                    onChange={(event) => {
                                        setJsonDraft(event.target.value);
                                        setDirty(true);
                                    }}
                                    placeholder={t('jsonPlaceholder')}
                                    className="min-h-0 flex-1 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                />
                                <p className="shrink-0 text-xs text-muted-foreground">{t('jsonHint')}</p>
                            </div>
                        )}
                    </div>

                    <DialogFooter className="shrink-0 border-t border-border/40 pt-3 max-md:grid max-md:grid-cols-2 max-md:gap-2 md:flex-row md:items-center md:justify-between">
                        <div className="flex min-h-5 items-center gap-2 max-md:col-span-2">
                            {dirty && (
                                <span className="text-xs text-muted-foreground">{t('unsaved')}</span>
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-2 max-md:col-span-2 md:flex md:justify-end">
                            <Button type="button" variant="secondary" className="h-10 rounded-lg md:h-9" onClick={requestClose}>
                                {t('cancel')}
                            </Button>
                            <Button type="button" variant="outline" className="h-10 rounded-lg md:h-9" onClick={() => save(true)} disabled={validate.isPending}>
                                {t('saveContinue')}
                            </Button>
                            <Button type="button" className="col-span-2 h-10 rounded-lg md:col-span-1 md:h-9" onClick={() => save(false)} disabled={validate.isPending}>
                                {t('saveClose')}
                            </Button>
                        </div>
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

function safeParse(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

type PreviewStage = 'before' | 'group' | 'final';

function PreviewStageView({
    data,
    scope,
    theme,
    t,
}: {
    data: {
        target_format: string;
        stages: {
            outbound_before_rewrite?: unknown;
            after_group?: unknown;
            final_body?: unknown;
            final_headers?: Record<string, string>;
        };
        trace?: Array<{
            index: number;
            scope: string;
            operation_id: string;
            operation: string;
            status: string;
            matched: boolean;
            changed: boolean;
            paths?: string[];
            warning?: string;
            error_kind?: string;
            duration_us: number;
        }>;
        warnings?: string[];
        summary?: {
            applied?: number;
            skipped?: number;
            errors?: number;
            transport_model?: string;
        };
    };
    scope: string;
    theme?: string;
    t: (key: string) => string;
}) {
    const [stage, setStage] = useState<PreviewStage>('final');
    const hasGroup = scope === 'group' && data.stages.after_group !== undefined;

    const currentValue = stage === 'before'
        ? data.stages.outbound_before_rewrite
        : stage === 'group'
            ? data.stages.after_group
            : data.stages.final_body;

    const currentHeaders = stage === 'final' ? data.stages.final_headers : undefined;

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">{t('targetFormat')}:</span>
                <span className="text-xs font-medium">{data.target_format}</span>
                {data.summary && (
                    <span className="text-xs text-muted-foreground">
                        · {data.summary.applied ?? 0} {t('traceApplied')}
                        {data.summary.skipped ? ` · ${data.summary.skipped} ${t('traceSkipped')}` : ''}
                        {data.summary.errors ? ` · ${data.summary.errors} ${t('traceErrors')}` : ''}
                    </span>
                )}
            </div>

            <div className="flex rounded-lg border border-border/60 bg-muted/30 p-0.5">
                {(['before', 'group', 'final'] as PreviewStage[]).map((s) => {
                    if (s === 'group' && !hasGroup) return null;
                    return (
                        <Button
                            key={s}
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setStage(s)}
                            className={cn(
                                'h-7 rounded-md px-2.5 text-xs font-medium transition-colors hover:bg-transparent',
                                stage === s
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            {s === 'before' ? t('outboundBeforeRewrite') : s === 'group' ? t('afterGroup') : t('finalRequest')}
                        </Button>
                    );
                })}
            </div>

            <div className="rounded-lg border border-border/40 bg-background p-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                    {stage === 'before' ? t('outboundBeforeRewrite') : stage === 'group' ? t('afterGroup') : t('finalBody')}
                </div>
                <PreviewJsonValue value={currentValue} theme={theme} />
                {currentHeaders && Object.keys(currentHeaders).length > 0 && (
                    <div className="mt-3">
                        <div className="mb-2 text-xs font-medium text-muted-foreground">{t('finalHeaders')}</div>
                        <div className="space-y-1">
                            {Object.entries(currentHeaders).map(([key, value]) => (
                                <div key={key} className="flex items-baseline gap-2 text-xs">
                                    <span className="font-mono text-muted-foreground">{key}:</span>
                                    <span className="font-mono">{value}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {data.trace && data.trace.length > 0 && (
                <div className="rounded-lg border border-border/40 bg-background p-3">
                    <div className="mb-2 text-xs font-medium text-muted-foreground">{t('trace')}</div>
                    <div className="space-y-1.5">
                        {data.trace.map((entry) => (
                            <div
                                key={`${entry.operation_id}-${entry.index}`}
                                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs"
                            >
                                <span className="shrink-0 font-mono text-muted-foreground">
                                    #{entry.index + 1}
                                </span>
                                <span className="font-medium text-foreground">{operationLabel(t, entry.operation)}</span>
                                <span className="max-w-48 truncate font-mono text-3xs text-muted-foreground" title={entry.operation_id}>{entry.operation_id}</span>
                                <span className={cn(
                                    'rounded px-1 py-0.5 text-3xs font-medium',
                                    entry.status === 'applied' && 'bg-success/10 text-success',
                                    entry.status === 'skipped' && 'bg-muted text-muted-foreground',
                                    entry.status === 'blocked' && 'bg-warning/10 text-warning',
                                    entry.status === 'error' && 'bg-destructive/10 text-destructive',
                                )}>
                                    {entry.status}
                                </span>
                                {entry.changed && entry.paths && entry.paths.length > 0 && (
                                    <span className="text-muted-foreground">
                                        {entry.paths.join(', ')}
                                    </span>
                                )}
                                {entry.warning && (
                                    <span className="text-warning">{entry.warning}</span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {data.warnings && data.warnings.length > 0 && (
                <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
                    <div className="mb-1 text-xs font-medium text-warning">{t('warnings')}</div>
                    <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                        {data.warnings.map((w, i) => (
                            <li key={i}>{w}</li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

function PreviewJsonValue({ value, theme }: { value: unknown; theme?: string }) {
    if (value === undefined) return <p className="text-xs text-muted-foreground">—</p>;
    const parsed = typeof value === 'string' ? safeParse(value) : value;
    if (parsed && typeof parsed === 'object') {
        return (
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
        );
    }
    return <pre className="overflow-x-auto text-xs">{String(value ?? '')}</pre>;
}
