'use client';

import { useTranslations } from 'next-intl';
import { CalendarCheck2, Globe2, Power } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { SettingKey } from '@/api/endpoints/setting';
import { useCheckinAllSites, useSiteLastCheckinTime, useSiteLastSyncTime, useSyncAllSites } from '@/api/endpoints/site';
import { toast } from '@/components/common/Toast';
import { useSettingStore } from '@/stores/setting';
import { translateSiteMessage } from '@/components/modules/site/site-message';
import { SettingCard, SettingRow, TaskRow, getTaskErrorMessage, useFormatTaskTime, useSettingToggle } from './shared';

// 站点域的唯一设置入口：总开关放在它所管辖的两个定时任务上方，
// 关闭时任务行随之消失，开关的作用范围因此是看得见的。
export function SettingSite() {
    const t = useTranslations('setting');
    const tAll = useTranslations();
    const locale = useSettingStore((state) => state.locale);
    const formatTime = useFormatTaskTime();

    const siteEnabled = useSettingToggle(SettingKey.SiteEnabled);
    const syncAllSites = useSyncAllSites();
    const checkinAllSites = useCheckinAllSites();
    const { data: lastSiteSyncTime } = useSiteLastSyncTime();
    const { data: lastSiteCheckinTime } = useSiteLastCheckinTime();

    return (
        <SettingCard icon={Globe2} title={t('site.title')}>
            <SettingRow icon={Power} label={t('site.enabled.label')} tooltip={t('site.enabled.description')}>
                <Switch checked={siteEnabled.enabled} onCheckedChange={siteEnabled.toggle} />
            </SettingRow>

            {siteEnabled.enabled && (
                <>
                    {/* 站点全量同步 */}
                    <TaskRow
                        icon={Globe2}
                        label={t('syncTasks.siteSync.label')}
                        settingKey={SettingKey.SiteSyncInterval}
                        last={formatTime(lastSiteSyncTime)}
                        running={syncAllSites.isPending}
                        runLabel={t('syncTasks.siteSync.button')}
                        pendingLabel={t('syncTasks.siteSync.pending')}
                        onRun={() => syncAllSites.mutate(undefined, {
                            onSuccess: () => toast.success(t('syncTasks.siteSync.success')),
                            onError: (error) => toast.error(
                                translateSiteMessage(locale, getTaskErrorMessage(error, t('syncTasks.siteSync.failed')), tAll)
                            ),
                        })}
                    />

                    {/* 站点全量签到 */}
                    <TaskRow
                        icon={CalendarCheck2}
                        label={t('syncTasks.siteCheckin.label')}
                        settingKey={SettingKey.SiteCheckinInterval}
                        last={formatTime(lastSiteCheckinTime)}
                        running={checkinAllSites.isPending}
                        runLabel={t('syncTasks.siteCheckin.button')}
                        pendingLabel={t('syncTasks.siteCheckin.pending')}
                        onRun={() => checkinAllSites.mutate(undefined, {
                            onSuccess: () => toast.success(t('syncTasks.siteCheckin.success')),
                            onError: (error) => toast.error(
                                translateSiteMessage(locale, getTaskErrorMessage(error, t('syncTasks.siteCheckin.failed')), tAll)
                            ),
                        })}
                    />
                </>
            )}
        </SettingCard>
    );
}
