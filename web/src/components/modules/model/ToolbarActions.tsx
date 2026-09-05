'use client';

import { Plus, Waypoints } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ToolbarActions } from '../toolbar/ToolbarActions';
import { CreateDialogContent } from './Create';
import { AliasDialogContent } from './AliasManager';

export function ModelToolbarActions() {
    const t = useTranslations('model');
    return <ToolbarActions actions={[
        { id: 'model-aliases', icon: <Waypoints className="size-4" />, label: t('alias.toolbarButton'), priority: 'large', content: <AliasDialogContent /> },
        { id: 'create-model', icon: <Plus className="size-4" />, label: t('create.toolbarButton'), priority: 'desktop', content: <CreateDialogContent /> },
    ]} />;
}
