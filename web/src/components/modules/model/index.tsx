'use client';

import { useMemo } from 'react';
import { useModelList } from '@/api/endpoints/model';
import { ModelItem } from './Item';
import { useSearchStore, useToolbarViewOptionsStore } from '@/components/modules/toolbar';
import { VirtualizedGrid } from '@/components/common/VirtualizedGrid';
import { SearchX } from 'lucide-react';
import { useTranslations } from 'next-intl';

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
            columns={{ default: 1, md: 2, lg: 3 }}
            estimateItemHeight={layout === 'list' ? 156 : 232}
            getItemKey={(model) => `model-${model.canonical_model_id ?? model.name}-${model.provider ?? ''}-${model.name}`}
            renderItem={(model) => <ModelItem model={model} models={models ?? []} layout={layout} />}
            emptyState={
                <div className="flex max-w-sm flex-col items-center gap-3 rounded-3xl border border-dashed bg-card px-8 py-10 text-center">
                    <SearchX className="size-10 text-muted-foreground/60" />
                    <div>
                        <p className="font-medium text-card-foreground">{t('empty.title')}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{t('empty.description')}</p>
                    </div>
                </div>
            }
        />
    );
}
