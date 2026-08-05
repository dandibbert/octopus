'use client';

import { useMemo } from 'react';
import { GroupCard } from './Card';
import { useGroupList } from '@/api/endpoints/group';
import { useSearchStore, useToolbarViewOptionsStore } from '@/components/modules/toolbar';
import { VirtualizedGrid } from '@/components/common/VirtualizedGrid';
import { Layers3 } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function Group() {
    const { data: groups } = useGroupList();
    const t = useTranslations('group');
    const pageKey = 'group' as const;
    const searchTerm = useSearchStore((s) => s.getSearchTerm(pageKey));
    const sortField = useToolbarViewOptionsStore((s) => s.getSortField(pageKey));
    const sortOrder = useToolbarViewOptionsStore((s) => s.getSortOrder(pageKey));

    const sortedGroups = useMemo(() => {
        if (!groups) return [];
        return [...groups].sort((a, b) => {
            // 置顶优先：pinned 组排在前面，组内按 pinned_at desc
            if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
            if (a.pinned && b.pinned) {
                const ta = a.pinned_at ? new Date(a.pinned_at).getTime() : 0;
                const tb = b.pinned_at ? new Date(b.pinned_at).getTime() : 0;
                if (ta !== tb) return tb - ta;
            }
            const diff = sortField === 'name'
                ? a.name.localeCompare(b.name)
                : (a.id || 0) - (b.id || 0);
            return sortOrder === 'asc' ? diff : -diff;
        });
    }, [groups, sortField, sortOrder]);

    const visibleGroups = useMemo(() => {
        const term = searchTerm.toLowerCase().trim();
        return !term ? sortedGroups : sortedGroups.filter((g) => g.name.toLowerCase().includes(term));
    }, [sortedGroups, searchTerm]);

    return (
        <VirtualizedGrid
            items={visibleGroups}
            columns={{ default: 1, md: 2, lg: 3 }}
            estimateItemHeight={520}
            getItemKey={(group, index) => group.id ?? `group-${index}`}
            renderItem={(group) => <GroupCard group={group} />}
            emptyState={
                <div className="flex max-w-sm flex-col items-center gap-3 rounded-3xl border border-dashed bg-card px-8 py-10 text-center">
                    <Layers3 className="size-10 text-muted-foreground/60" />
                    <div>
                        <p className="font-medium text-card-foreground">
                            {searchTerm.trim() ? t('empty.noMatchTitle') : t('empty.title')}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {searchTerm.trim() ? t('empty.noMatchDescription') : t('empty.description')}
                        </p>
                    </div>
                </div>
            }
        />
    );
}
