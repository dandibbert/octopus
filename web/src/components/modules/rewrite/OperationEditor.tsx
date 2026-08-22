'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
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
                    <Input
                        value={op.id}
                        onChange={(event) => onChange({ id: event.target.value })}
                        placeholder={t('id')}
                        className="h-9 rounded-lg font-mono text-xs"
                    />
                    <Input
                        value={op.name ?? ''}
                        onChange={(event) => onChange({ name: event.target.value || undefined })}
                        placeholder={t('name')}
                        className="h-9 rounded-lg"
                    />
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <Select value={String(op.op)} onValueChange={(next) => onChange(changeOperationType(op, next))}>
                        <SelectTrigger className="h-9 rounded-lg">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {ALL_OPS.map((item) => (
                                <SelectItem key={item} value={item}>{item}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <label className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
                        <Switch checked={op.enabled !== false} onCheckedChange={(checked) => onChange({ enabled: checked })} />
                        {t('opEnabled')}
                    </label>
                </div>
            </div>

            {/* B. Operation parameters */}
            <div className="space-y-2">
                {opNeedsPath(String(op.op)) && (
                    <Input
                        data-rewrite-primary
                        value={op.path ?? ''}
                        onChange={(event) => onChange({ path: event.target.value })}
                        placeholder={t('path')}
                        className="h-9 rounded-lg font-mono text-xs"
                    />
                )}
                {opNeedsFromTo(String(op.op)) && (
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <Input
                            data-rewrite-primary
                            value={op.from ?? ''}
                            onChange={(event) => onChange({ from: event.target.value })}
                            placeholder={t('from')}
                            className="h-9 rounded-lg font-mono text-xs"
                        />
                        <Input
                            value={op.to ?? ''}
                            onChange={(event) => onChange({ to: event.target.value })}
                            placeholder={t('to')}
                            className="h-9 rounded-lg font-mono text-xs"
                        />
                    </div>
                )}
                {opNeedsHeader(String(op.op)) && (
                    <Input
                        data-rewrite-primary
                        value={op.header ?? ''}
                        onChange={(event) => onChange({ header: event.target.value })}
                        placeholder={t('header')}
                        className="h-9 rounded-lg font-mono text-xs"
                    />
                )}
                {opNeedsHeaderFromTo(String(op.op)) && (
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <Input
                            data-rewrite-primary
                            value={op.from_header ?? ''}
                            onChange={(event) => onChange({ from_header: event.target.value })}
                            placeholder={t('fromHeader')}
                            className="h-9 rounded-lg font-mono text-xs"
                        />
                        <Input
                            value={op.to_header ?? ''}
                            onChange={(event) => onChange({ to_header: event.target.value })}
                            placeholder={t('toHeader')}
                            className="h-9 rounded-lg font-mono text-xs"
                        />
                    </div>
                )}
                {String(op.op) === 'array_insert' && (
                    <Input
                        type="number"
                        value={op.index ?? 0}
                        onChange={(event) => onChange({ index: Number(event.target.value) })}
                        placeholder={t('index')}
                        className="h-9 rounded-lg"
                    />
                )}
                {['array_append', 'array_prepend', 'array_insert'].includes(String(op.op)) && (
                    <label className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
                        <Switch checked={op.splat !== false} onCheckedChange={(checked) => onChange({ splat: checked })} />
                        {t('splat')}
                    </label>
                )}
                {opNeedsSearch(String(op.op)) && (
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <Input
                            value={op.search ?? ''}
                            onChange={(event) => onChange({ search: event.target.value })}
                            placeholder={t('search')}
                            className="h-9 rounded-lg"
                        />
                        <Input
                            value={op.replacement ?? ''}
                            onChange={(event) => onChange({ replacement: event.target.value })}
                            placeholder={t('replacement')}
                            className="h-9 rounded-lg"
                        />
                    </div>
                )}
                {opNeedsPattern(String(op.op)) && (
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <Input
                            value={op.pattern ?? ''}
                            onChange={(event) => onChange({ pattern: event.target.value })}
                            placeholder={t('pattern')}
                            className="h-9 rounded-lg"
                        />
                        {String(op.op) === 'regex_replace' && (
                            <Input
                                value={op.replacement ?? ''}
                                onChange={(event) => onChange({ replacement: event.target.value })}
                                placeholder={t('replacement')}
                                className="h-9 rounded-lg"
                            />
                        )}
                    </div>
                )}
                {String(op.op) === 'prune_objects' && (
                    <label className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
                        <Switch checked={op.recursive !== false} onCheckedChange={(checked) => onChange({ recursive: checked })} />
                        {t('recursive')}
                    </label>
                )}
                {opNeedsValue(String(op.op)) && <ValueEditor op={op} onChange={onChange} />}
                {String(op.op) === 'return_error' && (
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <Input
                            data-rewrite-primary
                            value={op.error?.message ?? ''}
                            onChange={(event) => onChange({ error: { ...(op.error ?? { message: '' }), message: event.target.value } })}
                            placeholder={t('errorMessage')}
                            className="h-9 rounded-lg"
                        />
                        <Input
                            type="number"
                            value={op.error?.status ?? 400}
                            onChange={(event) => onChange({ error: { ...(op.error ?? { message: '' }), status: Number(event.target.value || 400) } })}
                            placeholder={t('errorStatus')}
                            className="h-9 rounded-lg"
                        />
                        <Input
                            value={op.error?.code ?? ''}
                            onChange={(event) => onChange({ error: { ...(op.error ?? { message: '' }), code: event.target.value } })}
                            placeholder={t('errorCode')}
                            className="h-9 rounded-lg"
                        />
                        <Input
                            value={op.error?.type ?? ''}
                            onChange={(event) => onChange({ error: { ...(op.error ?? { message: '' }), type: event.target.value } })}
                            placeholder={t('errorType')}
                            className="h-9 rounded-lg"
                        />
                        {scope === 'channel' && (
                            <Select
                                value={op.error?.retry ?? 'stop'}
                                onValueChange={(next) => onChange({ error: { ...(op.error ?? { message: '' }), retry: next as 'stop' | 'next_channel' } })}
                            >
                                <SelectTrigger className="h-9 rounded-lg">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="stop">stop</SelectItem>
                                    <SelectItem value="next_channel">next_channel</SelectItem>
                                </SelectContent>
                            </Select>
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
                    <button
                        type="button"
                        onClick={() => setShowCondition(true)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                        <Plus className="size-3" />
                        {t('addCondition')}
                    </button>
                ) : (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">{t('when')}</span>
                            <button
                                type="button"
                                onClick={() => {
                                    onChange({ when: undefined });
                                    setShowCondition(false);
                                }}
                                className="text-xs text-muted-foreground hover:text-foreground"
                            >
                                {t('condClear')}
                            </button>
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
                    <button
                        type="button"
                        onClick={() => setShowPolicy(true)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                        <Plus className="size-3" />
                        {t('addPolicy')}
                    </button>
                ) : (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">{t('opPolicy')}</span>
                            <button
                                type="button"
                                onClick={() => {
                                    onChange({ policy: undefined });
                                    setShowPolicy(false);
                                }}
                                className="text-xs text-muted-foreground hover:text-foreground"
                            >
                                {t('policyClear')}
                            </button>
                        </div>
                        <PolicyEditor value={op.policy} onChange={(policy) => onChange({ policy })} inherit />
                    </div>
                )}
            </div>
        </div>
    );
}
