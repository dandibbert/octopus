'use client';

import { useTranslations } from 'next-intl';
import { CalendarSync, DollarSign, RefreshCw } from 'lucide-react';
import { SettingKey } from '@/api/endpoints/setting';
import { useLastSyncTime, useSyncChannel } from '@/api/endpoints/channel';
import { useLastUpdateTime, useUpdateModelPrice } from '@/api/endpoints/model';
import { toast } from '@/components/common/Toast';
import { SettingCard, TaskRow, useFormatTaskTime } from './shared';

export function SettingSyncTasks() {
    const t = useTranslations('setting');
    const formatTime = useFormatTaskTime();

    const syncChannel = useSyncChannel();
    const { data: lastSyncTime } = useLastSyncTime();
    const updatePrice = useUpdateModelPrice();
    const { data: lastUpdateTime } = useLastUpdateTime();

    return (
        <SettingCard icon={CalendarSync} title={t('syncTasks.title')}>
            {/* 渠道同步 */}
            <TaskRow
                icon={RefreshCw}
                label={t('syncTasks.llmSync.label')}
                settingKey={SettingKey.SyncLLMInterval}
                last={formatTime(lastSyncTime)}
                running={syncChannel.isPending}
                runLabel={t('syncTasks.llmSync.button')}
                pendingLabel={t('syncTasks.llmSync.pending')}
                onRun={() => syncChannel.mutate(undefined, {
                    onSuccess: () => toast.success(t('syncTasks.llmSync.success')),
                    onError: () => toast.error(t('syncTasks.llmSync.failed')),
                })}
            />

            {/* 模型价格更新 */}
            <TaskRow
                icon={DollarSign}
                label={t('syncTasks.llmPrice.label')}
                settingKey={SettingKey.ModelInfoUpdateInterval}
                last={formatTime(lastUpdateTime)}
                running={updatePrice.isPending}
                runLabel={t('syncTasks.llmPrice.button')}
                pendingLabel={t('syncTasks.llmPrice.pending')}
                onRun={() => updatePrice.mutate(undefined, {
                    onSuccess: () => toast.success(t('syncTasks.llmPrice.success')),
                    onError: () => toast.error(t('syncTasks.llmPrice.failed')),
                })}
            />
        </SettingCard>
    );
}
