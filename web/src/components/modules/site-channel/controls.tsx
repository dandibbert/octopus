'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, MoreHorizontal } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { SiteModelRouteType } from '@/api/endpoints/site-channel';
import { SITE_ROUTE_COLUMN_ORDER } from './constants';
import { routeTypeLabel } from './utils';

export function SelectionCheckbox({
    checked,
    onCheckedChange,
    disabled,
    ariaLabel,
    className,
}: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled?: boolean;
    ariaLabel: string;
    className?: string;
}) {
    return (
        <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            aria-label={ariaLabel}
            onChange={(event) => onCheckedChange(event.target.checked)}
            className={cn(
                'size-4 rounded border-border bg-background align-middle accent-primary disabled:cursor-not-allowed disabled:opacity-50',
                className,
            )}
        />
    );
}

export function MoveRoutePopover({
    currentRouteType,
    disabled,
    buttonClassName,
    onMove,
}: {
    currentRouteType: SiteModelRouteType;
    disabled?: boolean;
    buttonClassName?: string;
    onMove: (routeType: SiteModelRouteType) => void;
}) {
    const t = useTranslations('siteChannel');
    const [open, setOpen] = useState(false);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    disabled={disabled}
                    className={cn(
                        'rounded-lg p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50',
                        buttonClassName,
                    )}
                >
                    <MoreHorizontal className="size-4" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 rounded-2xl border border-border/70 bg-card p-2 shadow-xl">
                <div className="space-y-2">
                    <div className="px-2 pt-1 text-xs font-medium text-muted-foreground">{t('table.moveTo')}</div>
                    <div className="grid gap-1">
                        {SITE_ROUTE_COLUMN_ORDER.map((routeType) => (
                            <button
                                key={routeType}
                                type="button"
                                disabled={disabled || routeType === currentRouteType}
                                onClick={() => {
                                    onMove(routeType);
                                    setOpen(false);
                                }}
                                className={cn(
                                    'flex items-center justify-between rounded-xl px-2 py-2 text-left text-sm transition',
                                    routeType === currentRouteType
                                        ? 'bg-muted/60 text-muted-foreground'
                                        : 'hover:bg-muted',
                                )}
                            >
                                <span>{routeTypeLabel(routeType, t)}</span>
                                {routeType === currentRouteType ? <Check className="size-4" /> : null}
                            </button>
                        ))}
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
