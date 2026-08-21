'use client';

import { useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { newOperation, type RewriteOperation, type RewriteOp } from './schema';

const BODY_OPS: { op: RewriteOp; labelKey: string }[] = [
    { op: 'set', labelKey: 'opSet' },
    { op: 'set_if_absent', labelKey: 'opSetIfAbsent' },
    { op: 'delete', labelKey: 'opDelete' },
    { op: 'move', labelKey: 'opMove' },
    { op: 'copy', labelKey: 'opCopy' },
    { op: 'array_append', labelKey: 'opArrayAppend' },
    { op: 'array_prepend', labelKey: 'opArrayPrepend' },
    { op: 'array_insert', labelKey: 'opArrayInsert' },
    { op: 'array_remove', labelKey: 'opArrayRemove' },
];

const HEADER_OPS: { op: RewriteOp; labelKey: string }[] = [
    { op: 'header_set', labelKey: 'opHeaderSet' },
    { op: 'header_set_if_absent', labelKey: 'opHeaderSetIfAbsent' },
    { op: 'header_add', labelKey: 'opHeaderAdd' },
    { op: 'header_delete', labelKey: 'opHeaderDelete' },
    { op: 'header_copy', labelKey: 'opHeaderCopy' },
    { op: 'header_move', labelKey: 'opHeaderMove' },
];

const CONTROL_OPS: { op: RewriteOp; labelKey: string }[] = [
    { op: 'return_error', labelKey: 'opReturnError' },
];

function createOperation(op: RewriteOp, id: string): RewriteOperation {
    const base = newOperation(0);
    return {
        ...base,
        id,
        op,
        path: op.startsWith('header_') ? undefined : base.path,
        header: op.startsWith('header_') ? 'X-Example' : undefined,
        value: op === 'delete' || op === 'return_error' ? undefined : base.value,
        error: op === 'return_error' ? { status: 400, code: 'request_rewrite_blocked', type: 'invalid_request_error', message: '', retry: 'stop' } : undefined,
    };
}

export function AddOperationMenu({ onAdd }: { onAdd: (op: RewriteOperation) => void }) {
    const t = useTranslations('rewrite');
    const [open, setOpen] = useState(false);

    const handleSelect = (op: RewriteOp) => {
        const id = `op-${crypto.randomUUID().slice(0, 8)}`;
        onAdd(createOperation(op, id));
        setOpen(false);
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg text-xs">
                    <Plus className="size-3.5" />
                    {t('add')}
                    <ChevronDown className="size-3.5 opacity-60" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="end"
                collisionPadding={12}
                className="max-h-[min(28rem,var(--radix-popover-content-available-height))] w-48 overflow-y-auto rounded-xl p-1"
            >
                <div className="space-y-1">
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t('opGroupBody')}</div>
                    {BODY_OPS.map(({ op, labelKey }) => (
                        <button
                            key={op}
                            type="button"
                            onClick={() => handleSelect(op)}
                            className="flex w-full items-center rounded-lg px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
                        >
                            {t(labelKey)}
                        </button>
                    ))}
                    <div className="my-1 h-px bg-border/60" />
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t('opGroupHeader')}</div>
                    {HEADER_OPS.map(({ op, labelKey }) => (
                        <button
                            key={op}
                            type="button"
                            onClick={() => handleSelect(op)}
                            className="flex w-full items-center rounded-lg px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
                        >
                            {t(labelKey)}
                        </button>
                    ))}
                    <div className="my-1 h-px bg-border/60" />
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t('opGroupControl')}</div>
                    {CONTROL_OPS.map(({ op, labelKey }) => (
                        <button
                            key={op}
                            type="button"
                            onClick={() => handleSelect(op)}
                            className="flex w-full items-center rounded-lg px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
                        >
                            {t(labelKey)}
                        </button>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}
