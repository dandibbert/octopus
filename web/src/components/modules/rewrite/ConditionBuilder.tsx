'use client';

import { Plus, X } from 'lucide-react';
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
import { LiteralEditor } from './LiteralEditor';
import { ContextPathInput } from './ContextPathInput';
import { conditionOperatorLabel, conditionSourceLabel } from './labels';
import {
    CONDITION_OPERATORS,
    conditionKind,
    emptyPredicate,
    type ConditionExpr,
} from './schema';

const CONDITION_SOURCES = ['body', 'header', 'context', 'item'] as const;
const STRING_OPERATORS = new Set(['prefix', 'suffix', 'contains', 'regex']);
const NUMBER_OPERATORS = new Set(['gt', 'gte', 'lt', 'lte']);
const ARRAY_OPERATORS = new Set(['in', 'not_in']);
const TYPE_VALUES = ['null', 'boolean', 'number', 'string', 'object', 'array'] as const;

function updateAt(list: ConditionExpr[], index: number, next: ConditionExpr): ConditionExpr[] {
    return list.map((item, i) => (i === index ? next : item));
}

export function ConditionBuilder({
    value,
    onChange,
    allowItem,
    depth = 0,
}: {
    value?: ConditionExpr;
    onChange: (next?: ConditionExpr) => void;
    allowItem?: boolean;
    depth?: number;
}) {
    const t = useTranslations('rewrite');
    const kind = conditionKind(value);
    const source = String(value?.source ?? 'body');
    const operators = CONDITION_OPERATORS.filter((operator) => operator !== 'none_eq' || source === 'body');

    const setKind = (next: 'all' | 'any' | 'not' | 'predicate') => {
        if (next === 'all') onChange({ all: [emptyPredicate()] });
        else if (next === 'any') onChange({ any: [emptyPredicate()] });
        else if (next === 'not') onChange({ not: emptyPredicate() });
        else onChange(emptyPredicate());
    };

    return (
        <div className="@container/condition min-w-0 space-y-2 rounded-lg border border-border/50 bg-muted/20 p-2">
            <div className="flex flex-wrap items-center gap-2">
                <Select value={kind === 'empty' ? 'predicate' : kind} onValueChange={(next) => setKind(next as 'all' | 'any' | 'not' | 'predicate')}>
                    <SelectTrigger className="h-8 w-auto min-w-36 rounded-md text-xs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="predicate">{t('condPredicate')}</SelectItem>
                        <SelectItem value="all">{t('condAll')}</SelectItem>
                        <SelectItem value="any">{t('condAny')}</SelectItem>
                        <SelectItem value="not">{t('condNot')}</SelectItem>
                    </SelectContent>
                </Select>
                {depth === 0 && value && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 rounded-md px-2 text-xs text-muted-foreground"
                        onClick={() => onChange(undefined)}
                    >
                        {t('condClear')}
                    </Button>
                )}
            </div>

            {kind === 'all' && (
                <GroupList
                    items={value?.all ?? []}
                    onChange={(items) => onChange({ all: items })}
                    allowItem={allowItem}
                    depth={depth}
                />
            )}
            {kind === 'any' && (
                <GroupList
                    items={value?.any ?? []}
                    onChange={(items) => onChange({ any: items })}
                    allowItem={allowItem}
                    depth={depth}
                />
            )}
            {kind === 'not' && (
                <ConditionBuilder value={value?.not} onChange={(next) => onChange({ not: next ?? emptyPredicate() })} allowItem={allowItem} depth={depth + 1} />
            )}
            {(kind === 'predicate' || kind === 'empty') && (
                <div className="@container/predicate grid min-w-0 grid-cols-1 gap-2">
                    <div className="grid min-w-0 grid-cols-1 gap-2 @2xl/predicate:grid-cols-[minmax(7rem,0.75fr)_minmax(10rem,1.25fr)_minmax(8rem,0.8fr)]">
                        <Select
                            value={String(value?.source ?? 'body')}
                            onValueChange={(next) => {
                                const current = value ?? emptyPredicate();
                                onChange({
                                    ...current,
                                    source: next,
                                    path: next === 'context' ? 'request.original_model' : value?.path,
                                    operator: current.operator === 'none_eq' && next !== 'body' ? 'eq' : current.operator,
                                });
                            }}
                        >
                            <SelectTrigger className="h-8 min-w-0 rounded-md text-xs" aria-label={t('condSource')}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {CONDITION_SOURCES.filter((source) => allowItem || source !== 'item').map((source) => (
                                    <SelectItem key={source} value={source}>{conditionSourceLabel(t, source)}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {value?.source === 'context' ? (
                            <ContextPathInput value={value.path || 'request.original_model'} onChange={(path) => onChange({ ...(value ?? emptyPredicate()), path })} />
                        ) : (
                            <Input
                                value={value?.path ?? ''}
                                onChange={(event) => onChange({ ...(value ?? emptyPredicate()), path: event.target.value })}
                                placeholder={value?.source === 'header' ? t('header') : t('path')}
                                aria-label={t('condPath')}
                                className="h-8 min-w-0 rounded-md font-mono text-xs"
                            />
                        )}
                        <Select
                            value={String(value?.operator ?? 'eq')}
                            onValueChange={(next) => {
                                const current = value ?? emptyPredicate();
                                let nextValue = current.value;
                                if (next === 'exists' || next === 'missing') nextValue = undefined;
                                else if (STRING_OPERATORS.has(next)) nextValue = typeof current.value === 'string' ? current.value : '';
                                else if (NUMBER_OPERATORS.has(next)) nextValue = typeof current.value === 'number' ? current.value : 0;
                                else if (ARRAY_OPERATORS.has(next)) nextValue = Array.isArray(current.value) ? current.value : [];
                                else if (next === 'type_is') nextValue = TYPE_VALUES.includes(current.value as typeof TYPE_VALUES[number]) ? current.value : 'string';
                                onChange({ ...current, operator: next, value: nextValue });
                            }}
                        >
                            <SelectTrigger className="h-8 min-w-0 rounded-md text-xs" aria-label={t('condOperator')}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {operators.map((op) => (
                                    <SelectItem key={op} value={op}>{conditionOperatorLabel(t, op)}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="min-w-0">
                        {STRING_OPERATORS.has(String(value?.operator ?? 'eq')) && (
                            <Input
                                value={typeof value?.value === 'string' ? value.value : ''}
                                onChange={(event) => onChange({ ...(value ?? emptyPredicate()), value: event.target.value })}
                                placeholder={t('condValue')}
                                className="h-8 min-w-0 rounded-md text-xs"
                            />
                        )}
                        {NUMBER_OPERATORS.has(String(value?.operator)) && (
                            <Input
                                type="number"
                                value={typeof value?.value === 'number' ? String(value.value) : '0'}
                                onChange={(event) => {
                                    const next = Number(event.target.value);
                                    if (Number.isFinite(next)) onChange({ ...(value ?? emptyPredicate()), value: next });
                                }}
                                placeholder={t('condValue')}
                                className="h-8 min-w-0 rounded-md text-xs"
                            />
                        )}
                        {ARRAY_OPERATORS.has(String(value?.operator)) && (
                            <LiteralEditor
                                value={Array.isArray(value?.value) ? value.value : []}
                                onChange={(next) => onChange({ ...(value ?? emptyPredicate()), value: next })}
                                allowedKinds={['json']}
                                arrayOnly
                                showKind={false}
                            />
                        )}
                        {String(value?.operator) === 'type_is' && (
                            <Select
                                value={typeof value?.value === 'string' ? value.value : 'string'}
                                onValueChange={(next) => onChange({ ...(value ?? emptyPredicate()), value: next })}
                            >
                                <SelectTrigger className="h-8 min-w-0 rounded-md text-xs">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {TYPE_VALUES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        )}
                        {['eq', 'neq', 'none_eq'].includes(String(value?.operator ?? 'eq')) && (
                            <LiteralEditor
                                value={value?.value ?? ''}
                                onChange={(next) => onChange({ ...(value ?? emptyPredicate()), value: next })}
                                placeholder={t('condValue')}
                            />
                        )}
                    </div>
                </div>
            )}
            {(kind === 'predicate' || kind === 'empty') && STRING_OPERATORS.has(String(value?.operator)) && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Switch
                        checked={value?.case_sensitive !== false}
                        onCheckedChange={(checked) => onChange({ ...(value ?? emptyPredicate()), case_sensitive: checked })}
                    />
                    {t('caseSensitive')}
                </label>
            )}
        </div>
    );
}

function GroupList({
    items,
    onChange,
    allowItem,
    depth,
}: {
    items: ConditionExpr[];
    onChange: (items: ConditionExpr[]) => void;
    allowItem?: boolean;
    depth: number;
}) {
    const t = useTranslations('rewrite');
    return (
        <div className="space-y-1.5">
            {items.map((item, index) => (
                <div key={`cond-${depth}-${index}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)_2rem] items-start gap-1.5">
                    <div className="min-w-0 flex-1">
                        <ConditionBuilder value={item} onChange={(next) => onChange(updateAt(items, index, next ?? emptyPredicate()))} allowItem={allowItem} depth={depth + 1} />
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="size-8 shrink-0 rounded-md p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => onChange(items.filter((_, i) => i !== index))}
                        aria-label={t('remove')}
                    >
                        <X className="size-3.5" />
                    </Button>
                </div>
            ))}
            <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 rounded-md px-2 text-xs text-muted-foreground"
                onClick={() => onChange([...items, emptyPredicate()])}
            >
                <Plus className="size-3" />
                {t('condAdd')}
            </Button>
        </div>
    );
}
