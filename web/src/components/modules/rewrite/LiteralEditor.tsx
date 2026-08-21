'use client';

import { useMemo, useState } from 'react';
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
import { cn } from '@/lib/utils';

export type LiteralKind = 'string' | 'number' | 'boolean' | 'null' | 'json';

function detectKind(value: unknown): LiteralKind {
    if (value === null) return 'null';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'string') return 'string';
    return 'json';
}

function fallbackFor(kind: LiteralKind, arrayOnly: boolean): unknown {
    switch (kind) {
    case 'string': return '';
    case 'number': return 0;
    case 'boolean': return false;
    case 'null': return null;
    default: return arrayOnly ? [] : {};
    }
}

export function LiteralEditor({
    value,
    onChange,
    allowedKinds = ['string', 'number', 'boolean', 'null', 'json'],
    arrayOnly = false,
    showKind = true,
    placeholder,
}: {
    value: unknown;
    onChange: (next: unknown) => void;
    allowedKinds?: LiteralKind[];
    arrayOnly?: boolean;
    showKind?: boolean;
    placeholder?: string;
}) {
    const t = useTranslations('rewrite');
    const detected = detectKind(value);
    const kind = allowedKinds.includes(detected) ? detected : allowedKinds[0];

    const serialized = useMemo(() => {
        if (kind !== 'json') return '';
        try {
            return JSON.stringify(value ?? fallbackFor('json', arrayOnly), null, 2);
        } catch {
            return arrayOnly ? '[]' : '{}';
        }
    }, [arrayOnly, kind, value]);

    const setKind = (next: LiteralKind) => {
        if (!allowedKinds.includes(next)) return;
        if (next === detected) return;
        onChange(fallbackFor(next, arrayOnly));
    };

    return (
        <div className={cn('grid grid-cols-1 gap-2', showKind && 'md:grid-cols-[7rem_minmax(0,1fr)]')}>
            {showKind && (
                <Select value={kind} onValueChange={(next) => setKind(next as LiteralKind)}>
                    <SelectTrigger className="h-9 rounded-lg text-xs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {allowedKinds.includes('string') && <SelectItem value="string">{t('literalString')}</SelectItem>}
                        {allowedKinds.includes('number') && <SelectItem value="number">{t('literalNumber')}</SelectItem>}
                        {allowedKinds.includes('boolean') && <SelectItem value="boolean">{t('literalBoolean')}</SelectItem>}
                        {allowedKinds.includes('null') && <SelectItem value="null">{t('literalNull')}</SelectItem>}
                        {allowedKinds.includes('json') && <SelectItem value="json">{arrayOnly ? t('literalArray') : t('literalJson')}</SelectItem>}
                    </SelectContent>
                </Select>
            )}

            {kind === 'string' && (
                <Input
                    value={typeof value === 'string' ? value : ''}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder={placeholder ?? t('value')}
                    className="h-9 rounded-lg text-xs"
                />
            )}
            {kind === 'number' && (
                <Input
                    type="number"
                    value={typeof value === 'number' ? String(value) : '0'}
                    onChange={(event) => {
                        const next = Number(event.target.value);
                        if (Number.isFinite(next)) onChange(next);
                    }}
                    placeholder={placeholder ?? t('value')}
                    className="h-9 rounded-lg text-xs"
                />
            )}
            {kind === 'boolean' && (
                <label className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
                    <Switch checked={value === true} onCheckedChange={onChange} />
                    {value === true ? t('literalTrue') : t('literalFalse')}
                </label>
            )}
            {kind === 'null' && (
                <div className="flex h-9 items-center text-xs text-muted-foreground">{t('literalNullHint')}</div>
            )}
            {kind === 'json' && (
                <JsonLiteralInput key={serialized} initialValue={serialized} arrayOnly={arrayOnly} onChange={onChange} />
            )}
        </div>
    );
}

function JsonLiteralInput({
    initialValue,
    arrayOnly,
    onChange,
}: {
    initialValue: string;
    arrayOnly: boolean;
    onChange: (next: unknown) => void;
}) {
    const t = useTranslations('rewrite');
    const [draft, setDraft] = useState(initialValue);
    const [invalid, setInvalid] = useState(false);
    return (
        <div className="space-y-1">
            <textarea
                value={draft}
                onChange={(event) => {
                    const raw = event.target.value;
                    setDraft(raw);
                    try {
                        const parsed = JSON.parse(raw) as unknown;
                        if (arrayOnly && !Array.isArray(parsed)) {
                            setInvalid(true);
                            return;
                        }
                        if (!arrayOnly && (parsed === null || typeof parsed !== 'object')) {
                            setInvalid(true);
                            return;
                        }
                        setInvalid(false);
                        onChange(parsed);
                    } catch {
                        setInvalid(true);
                    }
                }}
                aria-invalid={invalid}
                className={cn(
                    'min-h-20 w-full rounded-xl border bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    invalid ? 'border-destructive' : 'border-border',
                )}
            />
            {invalid && <p className="text-xs text-destructive">{arrayOnly ? t('arrayJsonInvalid') : t('literalJsonInvalid')}</p>}
        </div>
    );
}
