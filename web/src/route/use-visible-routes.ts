'use client';

import { useEffect, useMemo } from 'react';
import { useSiteEnabled } from '@/api/endpoints/setting';
import { useNavStore } from '@/components/modules/navbar/nav-store';
import { ROUTES, type RouteConfig } from './config';

// 按功能开关过滤出当前可见的导航席位。
export function useVisibleRoutes(): RouteConfig[] {
    const { enabled: siteEnabled } = useSiteEnabled();

    return useMemo(
        () => ROUTES.filter((route) => (route.feature === 'site' ? siteEnabled : true)),
        [siteEnabled],
    );
}

// activeItem 是持久化的，可能停在一个刚被功能开关隐藏的席位上
// （关掉站点功能前最后停留在站点页），这时退回首页。
export function useActiveRouteGuard() {
    const visibleRoutes = useVisibleRoutes();
    const activeItem = useNavStore((state) => state.activeItem);
    const setActiveItem = useNavStore((state) => state.setActiveItem);

    useEffect(() => {
        if (visibleRoutes.some((route) => route.id === activeItem)) return;
        setActiveItem('home');
    }, [visibleRoutes, activeItem, setActiveItem]);
}
