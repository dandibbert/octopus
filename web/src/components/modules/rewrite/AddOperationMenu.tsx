'use client';

import { useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { newOperation, type RewriteOperation, type RewriteOp } from './schema';
import { createOperationId } from './id';
import { operationLabel } from './labels';

const BODY_OPS: RewriteOp[] = [
    'set', 'set_if_absent', 'delete', 'move', 'copy',
    'array_append', 'array_prepend', 'array_insert', 'array_remove',
];

const HEADER_OPS: RewriteOp[] = [
    'header_set', 'header_set_if_absent', 'header_add',
    'header_delete', 'header_copy', 'header_move',
];

const CONTROL_OPS: RewriteOp[] = ['return_error'];

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
        onAdd(createOperation(op, createOperationId()));
        setOpen(false);
    };

    const renderOperation = (op: RewriteOp) => (
        <Button
            key={op}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handleSelect(op)}
            className="h-9 w-full justify-start rounded-lg px-2 text-xs font-normal text-foreground hover:bg-muted hover:text-foreground"
        >
            {operationLabel(t, op)}
        </Button>
    );

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg text-xs">
                    <Plus className="size-3.5" />
                    {t('add')}
                    <ChevronDown className="size-3.5 opacity-60" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" collisionPadding={12} className="w-64 overflow-hidden rounded-xl p-0">
                <div className="max-h-[min(26rem,var(--radix-popover-content-available-height))] space-y-1 overflow-y-auto overscroll-contain p-1 touch-pan-y [scrollbar-color:hsl(var(--border))_transparent] [scrollbar-width:thin] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2">
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t('opGroupBody')}</div>
                    {BODY_OPS.map(renderOperation)}
                    <div className="my-1 h-px bg-border/60" />
                    <div className="px-2 pt-2 pb-0.5 text-xs font-medium text-muted-foreground">{t('opGroupHeader')}</div>
                    <div className="px-2 pb-1 text-3xs leading-relaxed text-muted-foreground">{t('opGroupHeaderHint')}</div>
                    {HEADER_OPS.map(renderOperation)}
                    <div className="my-1 h-px bg-border/60" />
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t('opGroupControl')}</div>
                    {CONTROL_OPS.map(renderOperation)}
                </div>
            </PopoverContent>
        </Popover>
    );
}
