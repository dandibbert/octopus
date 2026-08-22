'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
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
import { ConditionBuilder } from './ConditionBuilder';
import { ValueEditor } from './ValueEditor';
import { PolicyEditor } from './PolicyEditor';
import { operationLabel } from './labels';
import {
    ALL_OPS,
    changeOperationType,
    isSensitiveHeader,
    opNeedsFromTo,
    opNeedsHeader,
    opNeedsHeaderFromTo,
    opNeedsItemWhen,
    opNeedsPath,
    opNeedsPattern,
    opNeedsSearch,
    opNeedsValue,
    touchesModel,
    type RewriteOperation,
    type RewriteScopeLike,
} from './schema';

type Scope = RewriteScopeLike;

function EditorField({ label, children }: { label: ReactNode; children: ReactNode }) {
    return (
        <div className="space-y-1">
            <div className="px-0.5 text-2xs font-medium text-muted-foreground">{label}</div>
            {children}
        </div>
    );
}

export function OperationEditor({
    op,
    scope,
    allowSensitive,
    focusRequest,
    onChange,
}: {
    op: RewriteOperation;
    scope: Scope;
    allowSensitive?: boolean;
    focusRequest?: number;
    onChange: (patch: Partial<RewriteOperation>) => void;
}) {
    const t = useTranslations('rewrite');
    const [showCondition, setShowCondition] = useState(!!op.when);
    const [showPolicy, setShowPolicy] = useState(!!op.policy);
    const modelWarning = touchesModel(op);
    const sensitive = isSensitiveHeader(op.header) || isSensitiveHeader(op.from_header) || isSensitiveHeader(op.to_header);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!focusRequest) return;
        const timer = window.setTimeout(() => {
            rootRef.current?.querySelector<HTMLElement>('[data-rewrite-primary]')?.focus();
        }, 50);
        return () => window.clearTimeout(timer);
    }, [focusRequest]);

    return (
        <div ref={rootRef} className="space-y-3">
            {/* A. Basic info */}
            <div className="space-y-2">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <EditorField label={t('operation')}>
                        <Select value={String(op.op)} onValueChange={(next) => onChange(changeOperationType(op, next))}>
                            <SelectTrigger className="h-9 rounded-lg" aria-label={t('operation')}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {ALL_OPS.map((item) => (
                                    <SelectItem key={item} value={item}>{operationLabel(t, item)}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </EditorField>
                    <EditorField label={t('name')}>
                        <Input
                            value={op.name ?? ''}
                            onChange={(event) => onChange({ name: event.target.value || undefined })}
                            placeholder={t('name')}
                            aria-label={t('name')}
                            className="h-9 rounded-lg"
                        />
                    </EditorField>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <EditorField label={t('status')}>
                        <label className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
                            <Switch checked={op.enabled !== false} onCheckedChange={(checked) => onChange({ enabled: checked })} />
                            {t('opEnabled')}
                        </label>
                    </EditorField>
                    <details className="rounded-lg border border-border/40 px-2.5 py-2">
                        <summary className="cursor-pointer text-2xs font-medium text-muted-foreground">{t('advancedId')}</summary>
                        <Input
                            value={op.id}
                            onChange={(event) => onChange({ id: event.target.value })}
                            placeholder={t('id')}
                            aria-label={t('id')}
                            className="mt-2 h-9 rounded-lg font-mono text-xs"
                        />
                    </details>
                </div>
            </div>

            {/* B. Operation parameters */}
            <div className="space-y-2">
                {opNeedsPath(String(op.op)) && (
                    <EditorField label={t('path')}>
                        <Input
                            data-rewrite-primary
                            value={op.path ?? ''}
                            onChange={(event) => onChange({ path: event.target.value })}
                            placeholder={t('path')}
                            aria-label={t('path')}
                            className="h-9 rounded-lg font-mono text-xs"
                        />
                    </EditorField>
                )}
                {opNeedsFromTo(String(op.op)) && (
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <EditorField label={t('from')}>
                            <Input
                                data-rewrite-primary
                                value={op.from ?? ''}
                                onChange={(event) => onChange({ from: event.target.value })}
                                placeholder={t('from')}
                                aria-label={t('from')}
                                className="h-9 rounded-lg font-mono text-xs"
                            />
                        </EditorField>
                        <EditorField label={t('to')}>
                            <Input
                                value={op.to ?? ''}
                                onChange={(event) => onChange({ to: event.target.value })}
                                placeholder={t('to')}
                                aria-label={t('to')}
                                className="h-9 rounded-lg font-mono text-xs"
                            />
                        </EditorField>
                    </div>
                )}
                {opNeedsHeader(String(op.op)) && (
                    <EditorField label={t('header')}>
                        <Input
                            data-rewrite-primary
                            value={op.header ?? ''}
                            onChange={(event) => onChange({ header: event.target.value })}
                            placeholder={t('header')}
                            aria-label={t('header')}
                            className="h-9 rounded-lg font-mono text-xs"
                        />
                    </EditorField>
                )}
                {opNeedsHeaderFromTo(String(op.op)) && (
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <EditorField label={t('fromHeader')}>
                            <Input
                                data-rewrite-primary
                                value={op.from_header ?? ''}
                                onChange={(event) => onChange({ from_header: event.target.value })}
                                placeholder={t('fromHeader')}
                                aria-label={t('fromHeader')}
                                className="h-9 rounded-lg font-mono text-xs"
                            />
                        </EditorField>
                        <EditorField label={t('toHeader')}>
                            <Input
                                value={op.to_header ?? ''}
                                onChange={(event) => onChange({ to_header: event.target.value })}
                                placeholder={t('toHeader')}
                                aria-label={t('toHeader')}
                                className="h-9 rounded-lg font-mono text-xs"
                            />
                        </EditorField>
                    </div>
                )}
                {String(op.op) === 'array_insert' && (
                    <EditorField label={t('index')}>
                        <Input
                            type="number"
                            value={op.index ?? 0}
                            onChange={(event) => onChange({ index: Number(event.target.value) })}
                            placeholder={t('index')}
                            aria-label={t('index')}
                            className="h-9 rounded-lg"
                        />
                    </EditorField>
                )}
                {['array_append', 'array_prepend', 'array_insert'].includes(String(op.op)) && (
                    <label className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
                        <Switch checked={op.splat !== false} onCheckedChange={(checked) => onChange({ splat: checked })} />
                        {t('splat')}
                    </label>
                )}
                {opNeedsSearch(String(op.op)) && (
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <EditorField label={t('search')}>
                            <Input
                                value={op.search ?? ''}
                                onChange={(event) => onChange({ search: event.target.value })}
                                placeholder={t('search')}
                                aria-label={t('search')}
                                className="h-9 rounded-lg"
                            />
                        </EditorField>
                        <EditorField label={t('replacement')}>
                            <Input
                                value={op.replacement ?? ''}
                                onChange={(event) => onChange({ replacement: event.target.value })}
                                placeholder={t('replacement')}
                                aria-label={t('replacement')}
                                className="h-9 rounded-lg"
                            />
                        </EditorField>
                    </div>
                )}
                {opNeedsPattern(String(op.op)) && (
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <EditorField label={t('pattern')}>
                            <Input
                                value={op.pattern ?? ''}
                                onChange={(event) => onChange({ pattern: event.target.value })}
                                placeholder={t('pattern')}
                                aria-label={t('pattern')}
                                className="h-9 rounded-lg"
                            />
                        </EditorField>
                        {String(op.op) === 'regex_replace' && (
                            <EditorField label={t('replacement')}>
                                <Input
                                    value={op.replacement ?? ''}
                                    onChange={(event) => onChange({ replacement: event.target.value })}
                                    placeholder={t('replacement')}
                                    aria-label={t('replacement')}
                                    className="h-9 rounded-lg"
                                />
                            </EditorField>
                        )}
                    </div>
                )}
                {String(op.op) === 'prune_objects' && (
                    <label className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
                        <Switch checked={op.recursive !== false} onCheckedChange={(checked) => onChange({ recursive: checked })} />
                        {t('recursive')}
                    </label>
                )}
                {opNeedsValue(String(op.op)) && (
                    <EditorField label={t('valueConfig')}>
                        <ValueEditor op={op} onChange={onChange} />
                    </EditorField>
                )}
                {String(op.op) === 'return_error' && (
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <EditorField label={t('errorMessage')}>
                            <Input
                                data-rewrite-primary
                                value={op.error?.message ?? ''}
                                onChange={(event) => onChange({ error: { ...(op.error ?? { message: '' }), message: event.target.value } })}
                                placeholder={t('errorMessage')}
                                aria-label={t('errorMessage')}
                                className="h-9 rounded-lg"
                            />
                        </EditorField>
                        <EditorField label={t('errorStatus')}>
                            <Input
                                type="number"
                                value={op.error?.status ?? 400}
                                onChange={(event) => onChange({ error: { ...(op.error ?? { message: '' }), status: Number(event.target.value || 400) } })}
                                placeholder={t('errorStatus')}
                                aria-label={t('errorStatus')}
                                className="h-9 rounded-lg"
                            />
                        </EditorField>
                        <EditorField label={t('errorCode')}>
                            <Input
                                value={op.error?.code ?? ''}
                                onChange={(event) => onChange({ error: { ...(op.error ?? { message: '' }), code: event.target.value } })}
                                placeholder={t('errorCode')}
                                aria-label={t('errorCode')}
                                className="h-9 rounded-lg"
                            />
                        </EditorField>
                        <EditorField label={t('errorType')}>
                            <Input
                                value={op.error?.type ?? ''}
                                onChange={(event) => onChange({ error: { ...(op.error ?? { message: '' }), type: event.target.value } })}
                                placeholder={t('errorType')}
                                aria-label={t('errorType')}
                                className="h-9 rounded-lg"
                            />
                        </EditorField>
                        {scope === 'channel' && (
                            <EditorField label={t('retry')}>
                                <Select
                                    value={op.error?.retry ?? 'stop'}
                                    onValueChange={(next) => onChange({ error: { ...(op.error ?? { message: '' }), retry: next as 'stop' | 'next_channel' } })}
                                >
                                    <SelectTrigger className="h-9 rounded-lg" aria-label={t('retry')}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="stop">stop</SelectItem>
                                        <SelectItem value="next_channel">next_channel</SelectItem>
                                    </SelectContent>
                                </Select>
                            </EditorField>
                        )}
                    </div>
                )}
            </div>

            {/* Contextual warnings */}
            {modelWarning && (
                <p className="text-xs text-muted-foreground">{t('modelWarning')}</p>
            )}
            {sensitive && (
                <p className="text-xs text-destructive">
                    {scope === 'group' || !allowSensitive ? t('sensitiveBlocked') : t('sensitiveWarning')}
                </p>
            )}

            {/* C. Execution condition */}
            <div className="space-y-2">
                {!showCondition && !op.when ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowCondition(true)}
                        className="h-7 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
                    >
                        <Plus className="size-3" />
                        {t('addCondition')}
                    </Button>
                ) : (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">{t('when')}</span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    onChange({ when: undefined });
                                    setShowCondition(false);
                                }}
                                className="h-7 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
                            >
                                {t('condClear')}
                            </Button>
                        </div>
                        <ConditionBuilder value={op.when} onChange={(next) => onChange({ when: next })} />
                    </div>
                )}
            </div>

            {/* D. Item condition for array ops */}
            {opNeedsItemWhen(String(op.op)) && (
                <div className="space-y-2">
                    <span className="text-xs font-medium text-muted-foreground">{t('itemWhen')}</span>
                    <ConditionBuilder value={op.item_when} onChange={(next) => onChange({ item_when: next })} allowItem />
                </div>
            )}

            {/* E. Advanced policy */}
            <div className="space-y-2">
                {!showPolicy && !op.policy ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowPolicy(true)}
                        className="h-7 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
                    >
                        <Plus className="size-3" />
                        {t('addPolicy')}
                    </Button>
                ) : (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">{t('opPolicy')}</span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    onChange({ policy: undefined });
                                    setShowPolicy(false);
                                }}
                                className="h-7 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
                            >
                                {t('policyClear')}
                            </Button>
                        </div>
                        <PolicyEditor value={op.policy} onChange={(policy) => onChange({ policy })} inherit />
                    </div>
                )}
            </div>
        </div>
    );
}
