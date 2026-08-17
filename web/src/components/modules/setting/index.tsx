'use client';

import { PageWrapper } from '@/components/common/PageWrapper';
import { SettingAppearance } from './Appearance';
import { SettingAPIKey } from './APIKey';
import { SettingAccount } from './Account';
import { SettingInfo } from './Info';
import { SettingNetwork } from './Network';
import { SettingReliability } from './Reliability';
import { SettingSite } from './Site';
import { SettingSyncTasks } from './SyncTasks';
import { SettingData } from './Data';
import { SettingWebDAVBackup } from './WebDAVBackup';

export function Setting() {
    return (
        <div className="h-full min-h-0 touch-pan-y overflow-y-auto overscroll-y-auto rounded-t-3xl [-webkit-overflow-scrolling:touch] md:overscroll-contain">
            <PageWrapper className="columns-1 gap-4 pb-24 md:columns-2 md:pb-4 *:mb-4 *:min-w-0 *:break-inside-avoid">
                <SettingAPIKey key="setting-apikey" />
                <SettingInfo key="setting-info" />
                <SettingAppearance key="setting-appearance" />
                <SettingNetwork key="setting-network" />
                <SettingAccount key="setting-account" />
                <SettingReliability key="setting-reliability" />
                <SettingSyncTasks key="setting-sync-tasks" />
                <SettingSite key="setting-site" />
                <SettingData key="setting-data" />
                <SettingWebDAVBackup key="setting-webdav-backup" />
            </PageWrapper>
        </div>
    );
}
