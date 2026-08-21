'use client';

import { useTranslations } from 'next-intl';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import type { RewritePolicy } from './schema';

type PolicyKey = keyof RewritePolicy;

const POLICY_OPTIONS: Record<PolicyKey, string[]> = {
    on_error: ['reject', 'warn_and_continue'],
    on_missing: ['skip', 'error'],
    on_type_mismatch: ['error', 'skip'],
    on_conflict: ['overwrite', 'keep', 'error'],
};

const POLICY_DEFAULTS: Required<RewritePolicy> = {
    on_error: 'reject',
    on_missing: 'skip',
    on_type_mismatch: 'error',
    on_conflict: 'overwrite',
};

export function PolicyEditor({
    value,
    onChange,
    inherit = false,
}: {
    value?: RewritePolicy;
    onChange: (next?: RewritePolicy) => void;
    inherit?: boolean;
}) {
    const t = useTranslations('rewrite');

    const update = (key: PolicyKey, next: string) => {
        const current = { ...(value ?? {}) } as RewritePolicy;
        if (inherit && next === 'inherit') {
            delete current[key];
        } else {
            current[key] = next;
        }
        onChange(Object.keys(current).length > 0 ? current : undefined);
    };

    return (
        <div className="space-y-2 rounded-lg border border-border/40 bg-muted/20 p-2.5">
            {!inherit && <div className="text-xs font-medium text-muted-foreground">{t('policy')}</div>}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(Object.keys(POLICY_OPTIONS) as PolicyKey[]).map((key) => {
                    const selected = value?.[key] ?? (inherit ? 'inherit' : POLICY_DEFAULTS[key]);
                    return (
                        <label key={key} className="grid gap-1 text-xs text-muted-foreground">
                            <span>{t(`policy_${key}`)}</span>
                            <Select value={selected} onValueChange={(next) => update(key, next)}>
                                <SelectTrigger className="h-8 rounded-md text-xs">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {inherit && <SelectItem value="inherit">{t('policyInherit')}</SelectItem>}
                                    {POLICY_OPTIONS[key].map((option) => (
                                        <SelectItem key={option} value={option}>{option}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </label>
                    );
                })}
            </div>
        </div>
    );
}
