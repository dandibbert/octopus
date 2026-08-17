'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { KeyRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSiteChannelList } from '@/api/endpoints/site-channel';
import { collectPendingCompletionSites } from './utils';
import { UnifiedCompletionDialog } from './UnifiedCompletionDialog';

export function SiteChannelCompletionAction() {
    const t = useTranslations('siteChannel');
    const { data } = useSiteChannelList();
    const [completionDialogOpen, setCompletionDialogOpen] = useState(false);

    const pendingCompletionSites = useMemo(
        () => collectPendingCompletionSites(data ?? []),
        [data],
    );
    const totalPendingCompletionCount = useMemo(
        () => pendingCompletionSites.reduce((sum, site) => sum + site.pending_count, 0),
        [pendingCompletionSites],
    );
    const effectiveCompletionDialogOpen = completionDialogOpen && totalPendingCompletionCount > 0;

    if (totalPendingCompletionCount === 0) return null;

    return (
        <>
            <Button
                type="button"
                variant="outline"
                className="h-10 rounded-2xl px-3"
                onClick={() => setCompletionDialogOpen(true)}
            >
                <KeyRound className="size-4 text-primary" />
                {t('completion.title')}
                <Badge variant="outline" className="h-5 px-1.5 text-3xs">
                    {totalPendingCompletionCount}
                </Badge>
            </Button>
            <UnifiedCompletionDialog
                open={effectiveCompletionDialogOpen}
                onOpenChange={setCompletionDialogOpen}
                sites={pendingCompletionSites}
            />
        </>
    );
}

// 新增：用于在 SiteChannelSection 中同步状态到 store
export function useCompletionStateSync() {
    const { data } = useSiteChannelList();

    const pendingCompletionSites = useMemo(
        () => collectPendingCompletionSites(data ?? []),
        [data],
    );

    const totalPendingCompletionCount = useMemo(
        () => pendingCompletionSites.reduce((sum, site) => sum + site.pending_count, 0),
        [pendingCompletionSites],
    );

    return { pendingCompletionSites, totalPendingCompletionCount };
}
