'use client';

import { Plus, WandSparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ToolbarActions } from '../toolbar/ToolbarActions';
import { CreateDialogContent } from './Create';
import { GroupAutoGroupDialogContent } from './AutoGroupDialog';

export function GroupToolbarActions() {
    const t = useTranslations('toolbar.actions');
    return <ToolbarActions actions={[
        { id: 'auto-group', icon: <WandSparkles className="size-4" />, label: t('autoGroup'), priority: 'large', content: <GroupAutoGroupDialogContent /> },
        { id: 'create-group', icon: <Plus className="size-4" />, label: t('createGroup'), priority: 'desktop', content: <CreateDialogContent /> },
    ]} />;
}
