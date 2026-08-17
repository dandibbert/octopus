'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ConfirmActionProps {
    /** 触发元素，通常是一个 Button；会以 asChild 挂载 */
    children: ReactNode;
    title: ReactNode;
    description?: ReactNode;
    confirmLabel?: ReactNode;
    cancelLabel?: ReactNode;
    tone?: 'default' | 'destructive';
    disabled?: boolean;
    onConfirm: () => void;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}

/**
 * 破坏性操作的唯一确认入口。
 *
 * 不要用 window.confirm、也不要在组件里自己实现「点两次」或临时确认条 ——
 * 那些会让同一个动作在不同页面表现不同。需要更复杂的确认表单时，用 Dialog
 * 承载表单，但最终的破坏性提交仍然走这里。
 */
export function ConfirmAction({
    children,
    title,
    description,
    confirmLabel,
    cancelLabel,
    tone = 'destructive',
    disabled,
    onConfirm,
    open,
    onOpenChange,
}: ConfirmActionProps) {
    const t = useTranslations('common.confirm');

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogTrigger asChild disabled={disabled}>
                {children}
            </AlertDialogTrigger>
            <AlertDialogContent className="rounded-3xl">
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    {description ? (
                        <AlertDialogDescription>{description}</AlertDialogDescription>
                    ) : null}
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel className="rounded-xl">
                        {cancelLabel ?? t('cancel')}
                    </AlertDialogCancel>
                    <AlertDialogAction
                        className={cn(
                            tone === 'destructive' && buttonVariants({ variant: 'destructive' }),
                            'rounded-xl',
                        )}
                        onClick={onConfirm}
                    >
                        {confirmLabel ?? t('confirm')}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
