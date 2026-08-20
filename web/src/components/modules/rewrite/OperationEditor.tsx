'use client';

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
import {
    ALL_OPS,
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
    onChange,
}: {
    op: RewriteOperation;
    scope: Scope;
    allowSensitive?: boolean;
    onChange: (patch: Partial<RewriteOperation>) => void;
}) {
    const t = useTranslations('rewrite');
    const modelWarning = touchesModel(op);
    const sensitive = isSensitiveHeader(op.header) || isSensitiveHeader(op.from_header) || isSensitiveHeader(op.to_header);

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <Input value={op.id} onChange={(event) => onChange({ id: event.target.value })} placeholder={t('id')} className="h-10 rounded-xl md:h-9" />
                <Input value={op.name ?? ''} onChange={(event) => onChange({ name: event.target.value || undefined })} placeholder={t('name')} className="h-10 rounded-xl md:h-9" />
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <Select value={String(op.op)} onValueChange={(next) => onChange({ op: next })}>
                    <SelectTrigger className="h-10 rounded-xl md:h-9">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {ALL_OPS.map((item) => (
                            <SelectItem key={item} value={item}>{item}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <label className="flex h-10 items-center gap-2 text-xs text-muted-foreground md:h-9">
                    <Switch checked={op.enabled !== false} onCheckedChange={(checked) => onChange({ enabled: checked })} />
                    {t('opEnabled')}
                </label>
            </div>
            {opNeedsPath(String(op.op)) && (
                <Input value={op.path ?? ''} onChange={(event) => onChange({ path: event.target.value })} placeholder={t('path')} className="h-10 rounded-xl md:h-9" />
            )}
            {opNeedsFromTo(String(op.op)) && (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <Input value={op.from ?? ''} onChange={(event) => onChange({ from: event.target.value })} placeholder={t('from')} className="h-10 rounded-xl md:h-9" />
                    <Input value={op.to ?? ''} onChange={(event) => onChange({ to: event.target.value })} placeholder={t('to')} className="h-10 rounded-xl md:h-9" />
                </div>
            )}
            {opNeedsHeader(String(op.op)) && (
                <Input value={op.header ?? ''} onChange={(event) => onChange({ header: event.target.value })} placeholder={t('header')} className="h-10 rounded-xl md:h-9" />
            )}
            {opNeedsHeaderFromTo(String(op.op)) && (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <Input value={op.from_header ?? ''} onChange={(event) => onChange({ from_header: event.target.value })} placeholder={t('fromHeader')} className="h-10 rounded-xl md:h-9" />
                    <Input value={op.to_header ?? ''} onChange={(event) => onChange({ to_header: event.target.value })} placeholder={t('toHeader')} className="h-10 rounded-xl md:h-9" />
                </div>
            )}
            {String(op.op) === 'array_insert' && (
                <Input
                    type="number"
                    value={op.index ?? 0}
                    onChange={(event) => onChange({ index: Number(event.target.value) })}
                    placeholder={t('index')}
                    className="h-10 rounded-xl md:h-9"
                />
            )}
            {opNeedsSearch(String(op.op)) && (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <Input value={op.search ?? ''} onChange={(event) => onChange({ search: event.target.value })} placeholder={t('search')} className="h-10 rounded-xl md:h-9" />
                    <Input value={op.replacement ?? ''} onChange={(event) => onChange({ replacement: event.target.value })} placeholder={t('replacement')} className="h-10 rounded-xl md:h-9" />
                </div>
            )}
            {opNeedsPattern(String(op.op)) && (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <Input value={op.pattern ?? ''} onChange={(event) => onChange({ pattern: event.target.value })} placeholder={t('pattern')} className="h-10 rounded-xl md:h-9" />
                    {String(op.op) === 'regex_replace' && (
                        <Input value={op.replacement ?? ''} onChange={(event) => onChange({ replacement: event.target.value })} placeholder={t('replacement')} className="h-10 rounded-xl md:h-9" />
                    )}
                </div>
            )}
            {String(op.op) === 'prune_objects' && (
                <label className="flex h-10 items-center gap-2 text-xs text-muted-foreground md:h-9">
                    <Switch checked={op.recursive !== false} onCheckedChange={(checked) => onChange({ recursive: checked })} />
                    {t('recursive')}
                </label>
            )}
            {opNeedsValue(String(op.op)) && <ValueEditor op={op} onChange={onChange} />}
            {String(op.op) === 'return_error' && (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <Input
                        value={op.error?.message ?? ''}
                        onChange={(event) => onChange({ error: { ...(op.error ?? { message: '' }), message: event.target.value } })}
                        placeholder={t('errorMessage')}
                        className="h-10 rounded-xl md:h-9"
                    />
                    <Input
                        type="number"
                        value={op.error?.status ?? 400}
                        onChange={(event) => onChange({ error: { ...(op.error ?? { message: '' }), status: Number(event.target.value || 400) } })}
                        placeholder={t('errorStatus')}
                        className="h-10 rounded-xl md:h-9"
                    />
                    {scope === 'channel' && (
                        <Select
                            value={op.error?.retry ?? 'stop'}
                            onValueChange={(next) => onChange({ error: { ...(op.error ?? { message: '' }), retry: next as 'stop' | 'next_channel' } })}
                        >
                            <SelectTrigger className="h-10 rounded-xl md:h-9">
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
            <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">{t('when')}</div>
                <ConditionBuilder value={op.when} onChange={(next) => onChange({ when: next })} />
            </div>
            {opNeedsItemWhen(String(op.op)) && (
                <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground">{t('itemWhen')}</div>
                    <ConditionBuilder value={op.item_when} onChange={(next) => onChange({ item_when: next })} allowItem />
                </div>
            )}
            {modelWarning && <p className="text-xs text-muted-foreground">{t('modelWarning')}</p>}
            {sensitive && (
                <p className="text-xs text-destructive">
                    {scope === 'group' || !allowSensitive ? t('sensitiveBlocked') : t('sensitiveWarning')}
                </p>
            )}
        </div>
    );
}
