'use client';

import { Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    CONDITION_OPERATORS,
    CONTEXT_PATHS,
    conditionKind,
    emptyPredicate,
    type ConditionExpr,
} from './schema';

const CONDITION_SOURCES = ['body', 'header', 'context', 'item'] as const;

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

    const setKind = (next: 'all' | 'any' | 'not' | 'predicate') => {
        if (next === 'all') onChange({ all: [emptyPredicate()] });
        else if (next === 'any') onChange({ any: [emptyPredicate()] });
        else if (next === 'not') onChange({ not: emptyPredicate() });
        else onChange(emptyPredicate());
    };

    return (
        <div className="space-y-2 rounded-xl border border-border/60 bg-background/40 p-2">
            <div className="flex flex-wrap items-center gap-2">
                <Select value={kind === 'empty' ? 'predicate' : kind} onValueChange={(next) => setKind(next as 'all' | 'any' | 'not' | 'predicate')}>
                    <SelectTrigger className="h-10 w-32 rounded-xl md:h-9">
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
                    <Button type="button" variant="ghost" size="sm" className="h-10 rounded-lg text-muted-foreground md:h-9" onClick={() => onChange(undefined)}>
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
                <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                    <Select
                        value={String(value?.source ?? 'body')}
                        onValueChange={(next) => onChange({ ...(value ?? emptyPredicate()), source: next, path: next === 'context' ? CONTEXT_PATHS[0] : value?.path })}
                    >
                        <SelectTrigger className="h-10 rounded-xl md:h-9">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {CONDITION_SOURCES.filter((source) => allowItem || source !== 'item').map((source) => (
                                <SelectItem key={source} value={source}>{source}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {value?.source === 'context' ? (
                        <Select
                            value={value.path || CONTEXT_PATHS[0]}
                            onValueChange={(next) => onChange({ ...(value ?? emptyPredicate()), path: next })}
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
                            value={value?.path ?? ''}
                            onChange={(event) => onChange({ ...(value ?? emptyPredicate()), path: event.target.value })}
                            placeholder={value?.source === 'header' ? t('header') : t('path')}
                            className="h-10 rounded-xl md:h-9"
                        />
                    )}
                    <Select
                        value={String(value?.operator ?? 'eq')}
                        onValueChange={(next) => onChange({ ...(value ?? emptyPredicate()), operator: next })}
                    >
                        <SelectTrigger className="h-10 rounded-xl md:h-9">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {CONDITION_OPERATORS.map((op) => (
                                <SelectItem key={op} value={op}>{op}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {value?.operator !== 'exists' && value?.operator !== 'missing' && (
                        <Input
                            value={typeof value?.value === 'string' || typeof value?.value === 'number' || typeof value?.value === 'boolean' ? String(value.value) : value?.value == null ? '' : JSON.stringify(value.value)}
                            onChange={(event) => {
                                const raw = event.target.value;
                                try {
                                    onChange({ ...(value ?? emptyPredicate()), value: JSON.parse(raw) });
                                } catch {
                                    onChange({ ...(value ?? emptyPredicate()), value: raw });
                                }
                            }}
                            placeholder={t('condValue')}
                            className="h-10 rounded-xl md:h-9"
                        />
                    )}
                </div>
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
        <div className="space-y-2">
            {items.map((item, index) => (
                <div key={`cond-${depth}-${index}`} className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                        <ConditionBuilder value={item} onChange={(next) => onChange(updateAt(items, index, next ?? emptyPredicate()))} allowItem={allowItem} depth={depth + 1} />
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="size-10 rounded-lg p-0 text-muted-foreground md:size-9"
                        onClick={() => onChange(items.filter((_, i) => i !== index))}
                        aria-label={t('remove')}
                    >
                        <X className="size-4" />
                    </Button>
                </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => onChange([...items, emptyPredicate()])}>
                <Plus className="size-4" />
                {t('condAdd')}
            </Button>
        </div>
    );
}
