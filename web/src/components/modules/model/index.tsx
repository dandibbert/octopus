'use client';

import { useMemo } from 'react';
import { useModelList } from '@/api/endpoints/model';
import { ModelItem } from './Item';
import { useSearchStore, useToolbarViewOptionsStore } from '@/components/modules/toolbar';
import { VirtualizedGrid, columnsByMinWidth } from '@/components/common/VirtualizedGrid';
import { ListState } from '@/components/common/ListState';
import { SearchX } from 'lucide-react';
import { useTranslations } from 'next-intl';

const MODEL_COLUMNS = columnsByMinWidth(320, 3);

export function Model() {
    const { data: models } = useModelList();
    const t = useTranslations('model');
    const pageKey = 'model' as const;
    const searchTerm = useSearchStore((s) => s.getSearchTerm(pageKey));
    const layout = useToolbarViewOptionsStore((s) => s.getLayout(pageKey));
    const sortOrder = useToolbarViewOptionsStore((s) => s.getSortOrder(pageKey));

    const sortedModels = useMemo(() => {
        if (!models) return [];
        return [...models].sort((a, b) =>
            sortOrder === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
        );
    }, [models, sortOrder]);

    const visibleModels = useMemo(() => {
        const term = searchTerm.toLowerCase().trim();
        return !term ? sortedModels : sortedModels.filter((m) =>
            [m.name, m.provider, m.canonical_model_id, m.billing_class_id, m.price_source]
                .filter(Boolean)
                .some((value) => value!.toLowerCase().includes(term)),
        );
    }, [sortedModels, searchTerm]);

    return (
        <VirtualizedGrid
            items={visibleModels}
            layout={layout}
            columns={MODEL_COLUMNS}
            estimateItemHeight={layout === 'list' ? 156 : 232}
            getItemKey={(model) => `model-${model.canonical_model_id ?? model.name}-${model.provider ?? ''}-${model.name}`}
            renderItem={(model) => <ModelItem model={model} models={models ?? []} layout={layout} />}
            emptyState={
                <ListState
                    icon={SearchX}
                    title={t('empty.title')}
                    description={t('empty.description')}
                />
            }
        />
    );
}
