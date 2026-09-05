'use client';

import { useRef, useState, type ReactNode } from 'react';
import { MorphingDialog, MorphingDialogTrigger, MorphingDialogContainer, MorphingDialogContent } from '@/components/ui/morphing-dialog';
import { ToolbarMenu, type ToolbarAction } from './ToolbarMenu';

export type PageToolbarAction = ToolbarAction | (Omit<ToolbarAction, 'onClick'> & { content: ReactNode });

/** Shared presentation; each resource owns its actions and dialog content. */
export function ToolbarActions({ actions }: { actions: PageToolbarAction[] }) {
    const [dialogId, setDialogId] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const returnFocusRef = useRef<HTMLElement | null>(null);
    const dialog = actions.find((action) => action.id === dialogId);

    return (
        <>
            <ToolbarMenu actions={actions.map((action) => 'content' in action ? {
                ...action,
                onClick: () => {
                    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                    setDialogId(action.id);
                    setOpen(true);
                },
            } : action)} />
            <MorphingDialog open={open} onOpenChange={(next) => {
                setOpen(next);
                if (!next && returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true });
            }}>
                <div className="hidden" aria-hidden="true">
                    <MorphingDialogTrigger><span /></MorphingDialogTrigger>
                </div>
                <MorphingDialogContainer>
                    <MorphingDialogContent className="flex max-h-[calc(100dvh-1rem)] w-fit max-w-full flex-col overflow-hidden rounded-3xl bg-card px-4 py-3 text-card-foreground custom-shadow sm:px-6 sm:py-4">
                        {dialog && 'content' in dialog ? dialog.content : null}
                    </MorphingDialogContent>
                </MorphingDialogContainer>
            </MorphingDialog>
        </>
    );
}
