'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ListStateProps {
    tone?: 'empty' | 'error';
    icon?: LucideIcon;
    title: ReactNode;
    description?: ReactNode;
    action?: ReactNode;
    className?: string;
}

/**
 * 列表的空态与错误态。任何"没有数据"或"加载失败"都应该长这样，
 * 不要在模块里自己拼虚线框或写一行灰字。
 */
export function ListState({
    tone = 'empty',
    icon: Icon,
    title,
    description,
    action,
    className,
}: ListStateProps) {
    const isError = tone === 'error';

    return (
        <div
            role={isError ? 'alert' : undefined}
            className={cn(
                'flex max-w-sm flex-col items-center gap-3 rounded-3xl border px-8 py-10 text-center',
                isError ? 'border-destructive/30 bg-destructive/10' : 'border-dashed bg-card',
                className,
            )}
        >
            {Icon ? (
                <Icon
                    className={cn('size-10', isError ? 'text-destructive/70' : 'text-muted-foreground/60')}
                    aria-hidden
                />
            ) : null}
            <div className="min-w-0">
                <p className={cn('font-medium', isError ? 'text-destructive' : 'text-card-foreground')}>
                    {title}
                </p>
                {description ? (
                    <p className="mt-1 text-sm break-words text-muted-foreground">{description}</p>
                ) : null}
            </div>
            {action}
        </div>
    );
}

interface ListSkeletonProps {
    count?: number;
    layout?: 'grid' | 'list';
    /** 与 columnsByMinWidth 用同一个数值，骨架屏才会和真实列表同时换列 */
    minCardWidth?: number;
    itemHeight?: number;
    className?: string;
}

/**
 * 列表加载态。用 auto-fill 而不是 Tailwind 的视口断点，这样骨架屏跟
 * VirtualizedGrid 一样按容器宽度换列，两者不会在某个宽度下列数打架。
 */
export function ListSkeleton({
    count = 3,
    layout = 'grid',
    minCardWidth = 320,
    itemHeight = 224,
    className,
}: ListSkeletonProps) {
    return (
        <div
            aria-hidden
            className={cn('grid gap-4', className)}
            style={{
                gridTemplateColumns: layout === 'list'
                    ? 'minmax(0, 1fr)'
                    : `repeat(auto-fill, minmax(min(${minCardWidth}px, 100%), 1fr))`,
            }}
        >
            {Array.from({ length: count }).map((_, index) => (
                <div
                    key={index}
                    className="animate-pulse rounded-3xl border border-border/70 bg-muted/40"
                    style={{ height: itemHeight }}
                />
            ))}
        </div>
    );
}
