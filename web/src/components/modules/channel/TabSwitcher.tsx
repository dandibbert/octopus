'use client';

import { useMemo, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { useChannelList } from '@/api/endpoints/channel';
import { useSiteEnabled } from '@/api/endpoints/setting';
import { useSiteChannelList } from '@/api/endpoints/site-channel';
import { SiteChannelCompletionAction } from '@/components/modules/site-channel';
import { cn } from '@/lib/utils';
import { useChannelTabStore, useEffectiveChannelTab, type ChannelTab } from './tab-store';

const TABS: { value: ChannelTab; key: 'site' | 'manual' }[] = [
    { value: 'site', key: 'site' },
    { value: 'manual', key: 'manual' },
];

type Props = {
    className?: string;
    underlineLayoutId?: string;
};

export function ChannelTabSwitcher({
    className,
    underlineLayoutId = 'channel-tab-underline',
}: Props) {
    const t = useTranslations('channel.tabs');
    const { enabled: siteEnabled } = useSiteEnabled();
    const activeTab = useEffectiveChannelTab();
    const setActiveTab = useChannelTabStore((s) => s.setActiveTab);
    const { data: channelsData } = useChannelList();
    const { data: siteChannelsData } = useSiteChannelList({ includeHistory: false });

    const tabs = useMemo(
        () => (siteEnabled ? TABS : TABS.filter((tab) => tab.value !== 'site')),
        [siteEnabled],
    );

    const counts = useMemo(
        () => ({
            site: (siteChannelsData ?? []).filter((card) => card.account_count > 0).length,
            manual: (channelsData ?? []).filter((c) => !c.raw.managed).length,
        }),
        [channelsData, siteChannelsData],
    );

    const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
        let nextIndex = currentIndex;
        if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = tabs.length - 1;
        else return;

        event.preventDefault();
        const nextTab = tabs[nextIndex].value;
        setActiveTab(nextTab);
        event.currentTarget.parentElement
            ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
            .item(nextIndex)
            .focus();
    };

    // 只剩一个 tab 时切换器没有意义，让渠道页回到无标签的单一形态
    if (tabs.length < 2) return null;

    return (
        <div
            role="tablist"
            aria-label={tabs.map(({ key }) => t(key)).join(' / ')}
            className={cn('flex items-center gap-3 sm:gap-5', className)}
        >
            {tabs.map(({ value, key }, index) => {
                const active = activeTab === value;
                return (
                    <button
                        key={value}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        tabIndex={active ? 0 : -1}
                        onClick={() => setActiveTab(value)}
                        onKeyDown={(event) => handleKeyDown(event, index)}
                        className={cn(
                            'relative inline-flex min-h-11 items-center gap-1.5 px-1 text-sm font-medium transition-colors sm:min-h-8 sm:items-baseline sm:pb-1',
                            active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                        )}
                    >
                        <span>{t(key)}</span>
                        <span
                            className={cn(
                                'text-xs tabular-nums transition-colors',
                                active ? 'text-primary font-semibold' : 'text-muted-foreground',
                            )}
                        >
                            {counts[value]}
                        </span>
                        {active && (
                            <motion.span
                                layoutId={underlineLayoutId}
                                className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-primary"
                                transition={{ type: 'spring', stiffness: 320, damping: 30, mass: 0.8 }}
                            />
                        )}
                    </button>
                );
            })}
        </div>
    );
}

export function ChannelHeaderActions() {
    const activeTab = useEffectiveChannelTab();
    if (activeTab !== 'site') return null;
    return <SiteChannelCompletionAction />;
}
