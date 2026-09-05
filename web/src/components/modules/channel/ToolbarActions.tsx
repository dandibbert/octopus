'use client';

import { KeyRound, Network, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSiteEnabled } from '@/api/endpoints/setting';
import { useCompletionStore } from '../site-channel/completion-store';
import { useProxyPoolDialogStore } from '../proxy-pool/dialog-store';
import { ToolbarActions, type PageToolbarAction } from '../toolbar/ToolbarActions';
import { useEffectiveChannelTab } from './tab-store';
import { CreateDialogContent } from './Create';

export function ChannelToolbarActions() {
    const t = useTranslations('toolbar.actions');
    const tProxy = useTranslations('proxyPool');
    const { enabled: siteEnabled } = useSiteEnabled();
    const activeTab = useEffectiveChannelTab();
    const pendingCount = useCompletionStore((s) => s.pendingCount);
    const openCompletion = useCompletionStore((s) => s.openDialog);
    const openProxyPool = useProxyPoolDialogStore((s) => s.open);
    const actions: PageToolbarAction[] = [];
    if (!siteEnabled) actions.push({ id: 'proxy-pool', icon: <Network className="size-4" />, label: tProxy('name'), onClick: openProxyPool, priority: 'large' });
    if (activeTab === 'site' && pendingCount > 0) actions.push({ id: 'completion', icon: <KeyRound className="size-4" />, label: t('completionKey'), onClick: openCompletion, badge: pendingCount, priority: 'large' });
    actions.push({ id: 'create-channel', icon: <Plus className="size-4" />, label: t('createChannel'), content: <CreateDialogContent />, priority: 'desktop' });
    return <ToolbarActions actions={actions} />;
}
