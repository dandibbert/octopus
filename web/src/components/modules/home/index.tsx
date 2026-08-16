'use client';

import { Activity } from './activity';
import { StatsChart } from './chart';
import { GroupHealthSummaryStrip } from './group-health-summary-strip';
import { Rank } from './rank';
import { PageWrapper } from '@/components/common/PageWrapper';

export function Home() {
    return (
        <PageWrapper className="h-full min-h-0 touch-pan-y overflow-y-auto overscroll-y-auto space-y-6 rounded-t-3xl pb-24 [-webkit-overflow-scrolling:touch] md:overscroll-contain md:pb-4">
            <StatsChart />
            <GroupHealthSummaryStrip />
            <Activity />
            <Rank />
        </PageWrapper>
    );
}
