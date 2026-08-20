'use client';

import { useMemo } from 'react';
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
import { CONTEXT_PATHS, VALUE_SOURCES, type RewriteOperation, type ValueSource } from './schema';

type LiteralKind = 'string' | 'number' | 'boolean' | 'null' | 'json';
type ValueMode = 'literal' | 'from' | 'template';

function detectLiteralKind(value: unknown): LiteralKind {
    if (value === null) return 'null';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'string') return 'string';
    return 'json';
}

function modeOf(op: RewriteOperation): ValueMode {
    if (op.value_template != null && op.value_template !== '') return 'template';
    if (op.value_from) return 'from';
    return 'literal';
}

export function ValueEditor({
    op,
    onChange,
}: {
    op: RewriteOperation;
    onChange: (patch: Partial<RewriteOperation>) => void;
}) {
    const t = useTranslations('rewrite');
    const mode = modeOf(op);
    const literalKind = useMemo(() => detectLiteralKind(op.value), [op.value]);

    const setMode = (next: ValueMode) => {
        if (next === 'literal') {
            onChange({ value: op.value ?? '', value_from: undefined, value_template: undefined });
            return;
        }
        if (next === 'from') {
            onChange({
                value: undefined,
                value_template: undefined,
                value_from: op.value_from ?? { source: 'body', path: '/model' },
            });
            return;
        }
        onChange({
            value: undefined,
            value_from: undefined,
            value_template: op.value_template ?? 'model-${context:request.original_model}',
        });
    };

    const setLiteralKind = (kind: LiteralKind) => {
        if (kind === 'string') onChange({ value: typeof op.value === 'string' ? op.value : '' });
        else if (kind === 'number') onChange({ value: typeof op.value === 'number' ? op.value : 0 });
        else if (kind === 'boolean') onChange({ value: typeof op.value === 'boolean' ? op.value : false });
        else if (kind === 'null') onChange({ value: null });
        else onChange({ value: typeof op.value === 'object' && op.value !== null ? op.value : {} });
    };

    const updateFrom = (patch: Partial<ValueSource>) => {
        onChange({ value_from: { source: 'body', path: '', ...(op.value_from ?? {}), ...patch } });
    };

    return (
        <div className="space-y-2">
            <Select value={mode} onValueChange={(next) => setMode(next as ValueMode)}>
                <SelectTrigger className="h-10 rounded-xl md:h-9">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="literal">{t('valueLiteral')}</SelectItem>
                    <SelectItem value="from">{t('valueFrom')}</SelectItem>
                    <SelectItem value="template">{t('valueTemplate')}</SelectItem>
                </SelectContent>
            </Select>

            {mode === 'literal' && (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-[8rem_minmax(0,1fr)]">
                    <Select value={literalKind} onValueChange={(next) => setLiteralKind(next as LiteralKind)}>
                        <SelectTrigger className="h-10 rounded-xl md:h-9">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="string">{t('literalString')}</SelectItem>
                            <SelectItem value="number">{t('literalNumber')}</SelectItem>
                            <SelectItem value="boolean">{t('literalBoolean')}</SelectItem>
                            <SelectItem value="null">{t('literalNull')}</SelectItem>
                            <SelectItem value="json">{t('literalJson')}</SelectItem>
                        </SelectContent>
                    </Select>
                    {literalKind === 'string' && (
                        <Input
                            value={typeof op.value === 'string' ? op.value : ''}
                            onChange={(event) => onChange({ value: event.target.value })}
                            placeholder={t('value')}
                            className="h-10 rounded-xl md:h-9"
                        />
                    )}
                    {literalKind === 'number' && (
                        <Input
                            type="number"
                            value={typeof op.value === 'number' ? String(op.value) : '0'}
                            onChange={(event) => onChange({ value: Number(event.target.value) })}
                            className="h-10 rounded-xl md:h-9"
                        />
                    )}
                    {literalKind === 'boolean' && (
                        <label className="flex h-10 items-center gap-2 text-xs text-muted-foreground md:h-9">
                            <Switch checked={op.value === true} onCheckedChange={(checked) => onChange({ value: checked })} />
                            {op.value === true ? t('literalTrue') : t('literalFalse')}
                        </label>
                    )}
                    {literalKind === 'null' && (
                        <div className="flex h-10 items-center text-xs text-muted-foreground md:h-9">{t('literalNullHint')}</div>
                    )}
                    {literalKind === 'json' && (
                        <textarea
                            value={typeof op.value === 'string' ? op.value : JSON.stringify(op.value ?? {}, null, 2)}
                            onChange={(event) => {
                                try {
                                    onChange({ value: JSON.parse(event.target.value) });
                                } catch {
                                    // keep typing; last valid JSON stays until parse succeeds
                                }
                            }}
                            className="min-h-20 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-xs"
                        />
                    )}
                </div>
            )}

            {mode === 'from' && (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                    <Select
                        value={String(op.value_from?.source ?? 'body')}
                        onValueChange={(next) => updateFrom({ source: next })}
                    >
                        <SelectTrigger className="h-10 rounded-xl md:h-9">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {VALUE_SOURCES.map((source) => (
                                <SelectItem key={source} value={source}>{source}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {op.value_from?.source === 'context' ? (
                        <Select
                            value={op.value_from.path || CONTEXT_PATHS[0]}
                            onValueChange={(next) => updateFrom({ path: next })}
                        >
                            <SelectTrigger className="h-10 rounded-xl md:h-9">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {CONTEXT_PATHS.map((path) => (
                                    <SelectItem key={path} value={path}>{path}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    ) : (
                        <Input
                            value={op.value_from?.path ?? ''}
                            onChange={(event) => updateFrom({ path: event.target.value })}
                            placeholder={op.value_from?.source === 'header' ? t('header') : t('path')}
                            className="h-10 rounded-xl md:h-9"
                        />
                    )}
                    <Input
                        value={op.value_from?.default === undefined ? '' : String(op.value_from.default)}
                        onChange={(event) => updateFrom({ default: event.target.value || undefined })}
                        placeholder={t('valueDefault')}
                        className="h-10 rounded-xl md:h-9"
                    />
                </div>
            )}

            {mode === 'template' && (
                <Input
                    value={op.value_template ?? ''}
                    onChange={(event) => onChange({ value_template: event.target.value })}
                    placeholder={t('valueTemplateHint')}
                    className="h-10 rounded-xl font-mono md:h-9"
                />
            )}
        </div>
    );
}
