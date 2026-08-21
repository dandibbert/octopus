'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { LiteralEditor } from './LiteralEditor';
import { ContextPathInput } from './ContextPathInput';
import { VALUE_SOURCES, type RewriteOperation, type ValueSource } from './schema';

type ValueMode = 'literal' | 'from' | 'template';

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

    const updateFrom = (patch: Partial<ValueSource>) => {
        onChange({ value_from: { source: 'body', path: '', ...(op.value_from ?? {}), ...patch } });
    };

    return (
        <div className="space-y-2">
            <Select value={mode} onValueChange={(next) => setMode(next as ValueMode)}>
                <SelectTrigger className="h-9 rounded-lg text-xs">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="literal">{t('valueLiteral')}</SelectItem>
                    <SelectItem value="from">{t('valueFrom')}</SelectItem>
                    <SelectItem value="template">{t('valueTemplate')}</SelectItem>
                </SelectContent>
            </Select>

            {mode === 'literal' && <LiteralEditor value={op.value} onChange={(value) => onChange({ value })} />}

            {mode === 'from' && (
                <div className="space-y-2">
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <Select
                        value={String(op.value_from?.source ?? 'body')}
                        onValueChange={(next) => updateFrom({ source: next })}
                    >
                        <SelectTrigger className="h-9 rounded-lg text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {VALUE_SOURCES.map((source) => (
                                <SelectItem key={source} value={source}>{source}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {op.value_from?.source === 'context' ? (
                        <ContextPathInput value={op.value_from.path} onChange={(path) => updateFrom({ path })} />
                    ) : (
                        <Input
                            value={op.value_from?.path ?? ''}
                            onChange={(event) => updateFrom({ path: event.target.value })}
                            placeholder={op.value_from?.source === 'header' ? t('header') : t('path')}
                            className="h-9 rounded-lg font-mono text-xs"
                        />
                    )}
                    </div>
                    {op.value_from?.default === undefined ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 rounded-md px-2 text-xs text-muted-foreground"
                            onClick={() => updateFrom({ default: '' })}
                        >
                            {t('addDefault')}
                        </Button>
                    ) : (
                        <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs text-muted-foreground">{t('valueDefault')}</span>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 rounded px-1.5 text-xs text-muted-foreground"
                                    onClick={() => updateFrom({ default: undefined })}
                                >
                                    {t('clearDefault')}
                                </Button>
                            </div>
                            <LiteralEditor value={op.value_from.default} onChange={(value) => updateFrom({ default: value })} />
                        </div>
                    )}
                </div>
            )}

            {mode === 'template' && (
                <Input
                    value={op.value_template ?? ''}
                    onChange={(event) => onChange({ value_template: event.target.value })}
                    placeholder={t('valueTemplateHint')}
                    className="h-9 rounded-lg font-mono text-xs"
                />
            )}
        </div>
    );
}
