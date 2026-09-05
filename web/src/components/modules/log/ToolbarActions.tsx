'use client';

import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { ToolbarMenu } from '../toolbar/ToolbarMenu';
import { useLogUIStore } from './ui-store';

export function LogToolbarActions() {
    const t = useTranslations('toolbar.actions');
    const refresh = useLogUIStore((s) => s.requestRefresh);
    const isRefreshing = useLogUIStore((s) => s.isRefreshing);
    return <ToolbarMenu actions={[
        { id: 'refresh', icon: <RefreshCw className={cn('size-4', isRefreshing && 'animate-spin')} />, label: t('refresh'), onClick: refresh, disabled: isRefreshing, priority: 'desktop' },
    ]} />;
}
