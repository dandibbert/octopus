
'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, MotionConfig } from "motion/react"
import { useAuth } from '@/api/endpoints/user';
import { LoginForm } from '@/components/modules/login';
import { APIKeyDashboard } from '@/components/modules/apikey-dashboard';
import { ContentLoader } from '@/route/content-loader';
import { NavBar, useNavStore } from '@/components/modules/navbar';
import { useTranslations } from 'next-intl'
import Logo, { LOGO_DRAW_END_MS } from '@/components/modules/logo';
import { Toolbar } from '@/components/modules/toolbar';
import { ChannelTabSwitcher } from '@/components/modules/channel/TabSwitcher';
import { ProxyPoolDialog } from '@/components/modules/proxy-pool/ProxyPoolDialog';
import { ENTRANCE_VARIANTS } from '@/lib/animations/fluid-transitions';
import { useQueryClient } from '@tanstack/react-query';
import { CONTENT_MAP, useActiveRouteGuard } from '@/route';
import { useSiteEnabled } from '@/api/endpoints/setting';
import { apiClient } from '@/api/client';
import { logger } from '@/lib/logger';

const RETURNING_USER_KEY = 'octopus_visited';
const RETURNING_LOGO_MS = 300;

export function AppContainer() {
    const { isAuthenticated, isAPIKeyAuth, isLoading: authLoading } = useAuth();
    const { activeItem, direction } = useNavStore();
    const t = useTranslations('navbar');
    const queryClient = useQueryClient();
    const { enabled: siteEnabled } = useSiteEnabled();

    // 持久化的 activeItem 可能停在已被功能开关隐藏的席位上
    useActiveRouteGuard();

    // Logo 动画完成状态 — 回访用户缩短动画时间
    const [logoAnimationComplete, setLogoAnimationComplete] = useState(false);
    const bootstrapStartedRef = useRef(false);

    // 首屏最早的 server-rendered loader：一旦客户端开始渲染，就淡出移除
    useEffect(() => {
        const el = document.getElementById('initial-loader');
        if (!el) return;

        el.classList.add('octo-hide');
        const timer = setTimeout(() => el.remove(), 220);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        const isReturning = sessionStorage.getItem(RETURNING_USER_KEY) === '1';
        const duration = isReturning ? RETURNING_LOGO_MS : LOGO_DRAW_END_MS;
        const timer = setTimeout(() => {
            setLogoAnimationComplete(true);
            sessionStorage.setItem(RETURNING_USER_KEY, '1');
        }, duration);
        return () => clearTimeout(timer);
    }, []);

    // 后台预取数据 — 不阻塞内容渲染，React Query 缓存就绪后自动触发组件重渲染
    useEffect(() => {
        if (authLoading) return;
        if (!isAuthenticated) return;

        if (bootstrapStartedRef.current) return;
        bootstrapStartedRef.current = true;

        const prefetches: Array<Promise<unknown>> = [];

        // API Key 认证模式：预取 dashboard stats
        if (isAPIKeyAuth) {
            prefetches.push(
                queryClient.prefetchQuery({
                    queryKey: ['apikey', 'dashboard', 'stats'],
                    queryFn: async () => apiClient.get('/api/v1/apikey/stats'),
                })
            );
        } else {
            // 普通用户认证模式：预取对应页面数据
            const component = CONTENT_MAP[activeItem];
            if (component?.preload) {
                prefetches.push(component.preload());
            }

            switch (activeItem) {
                case 'home': {
                    prefetches.push(
                        queryClient.prefetchQuery({
                            queryKey: ['stats', 'total'],
                            queryFn: async () => apiClient.get('/api/v1/stats/total'),
                        })
                    );
                    prefetches.push(
                        queryClient.prefetchQuery({
                            queryKey: ['stats', 'daily'],
                            queryFn: async () => apiClient.get('/api/v1/stats/daily'),
                        })
                    );
                    prefetches.push(
                        queryClient.prefetchQuery({
                            queryKey: ['stats', 'hourly'],
                            queryFn: async () => apiClient.get('/api/v1/stats/hourly'),
                        })
                    );
                    prefetches.push(
                        queryClient.prefetchQuery({
                            queryKey: ['channels', 'list'],
                            queryFn: async () => apiClient.get('/api/v1/channel/list'),
                        })
                    );
                    break;
                }
                case 'site': {
                    if (!siteEnabled) break;
                    prefetches.push(
                        queryClient.prefetchQuery({
                            queryKey: ['sites', 'list'],
                            queryFn: async () => apiClient.get('/api/v1/site/list'),
                        })
                    );
                    break;
                }
                case 'channel': {
                    prefetches.push(
                        queryClient.prefetchQuery({
                            queryKey: ['channels', 'list'],
                            queryFn: async () => apiClient.get('/api/v1/channel/list'),
                        })
                    );
                    break;
                }
                case 'group': {
                    prefetches.push(
                        queryClient.prefetchQuery({
                            queryKey: ['groups', 'list'],
                            queryFn: async () => apiClient.get('/api/v1/group/list'),
                        })
                    );
                    prefetches.push(
                        queryClient.prefetchQuery({
                            queryKey: ['models', 'channel'],
                            queryFn: async () => apiClient.get('/api/v1/model/channel'),
                        })
                    );
                    break;
                }
                case 'model': {
                    prefetches.push(
                        queryClient.prefetchQuery({
                            queryKey: ['models', 'list'],
                            queryFn: async () => apiClient.get('/api/v1/model/list'),
                        })
                    );
                    break;
                }
                case 'setting': {
                    prefetches.push(
                        queryClient.prefetchQuery({
                            queryKey: ['apikeys', 'list'],
                            queryFn: async () => apiClient.get('/api/v1/apikey/list'),
                        })
                    );
                    break;
                }
                default:
                    break;
            }
        }

        // 后台静默运行，不阻塞渲染
        Promise.allSettled(prefetches).catch((e) => {
            logger.warn('bootstrap prefetch failed:', e);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authLoading, isAuthenticated]);

    // 加载状态 — 仅等待认证和 Logo 动画，不再等待数据预取
    const isLoading = authLoading || !logoAnimationComplete;

    // 加载页面
    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <Logo size={120} animate />
            </div>
        );
    }

    // API Key 认证模式 - 显示 API Key Dashboard
    if (isAPIKeyAuth) {
        return (
            <AnimatePresence mode="wait">
                <APIKeyDashboard key="apikey-dashboard" />
            </AnimatePresence>
        );
    }

    // 登录页面
    if (!isAuthenticated) {
        return (
            <AnimatePresence mode="wait">
                <LoginForm key="login" />
            </AnimatePresence>
        );
    }

    // 主界面
    return (
        <MotionConfig reducedMotion="user">
            <motion.div
                key="main-app"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="mx-auto flex h-dvh w-full max-w-6xl flex-col overflow-hidden px-3 md:grid md:grid-cols-[auto_1fr] md:gap-6 md:px-6"
            >
            <NavBar />
            <main className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
                <header className="my-6 grid min-w-0 flex-none grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 px-2">
                    <Logo size={48} />
                    <div className="min-w-0 overflow-hidden pb-2 sm:pb-0">
                        <AnimatePresence mode="wait" custom={direction}>
                            <motion.div
                                key={activeItem}
                                custom={direction}
                                variants={{
                                    initial: (direction: number) => ({
                                        y: 32 * direction,
                                        opacity: 0
                                    }),
                                    animate: {
                                        y: 0,
                                        opacity: 1
                                    },
                                    exit: (direction: number) => ({
                                        y: -32 * direction,
                                        opacity: 0
                                    })
                                }}
                                initial="initial"
                                animate="animate"
                                exit="exit"
                                transition={{ duration: 0.3 }}
                                className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-baseline sm:gap-6"
                            >
                                <span className="mt-1 min-w-0 truncate text-3xl font-bold">{t(activeItem)}</span>
                                {activeItem === 'channel' && (
                                    <ChannelTabSwitcher
                                        className="hidden w-fit max-w-full sm:flex"
                                        underlineLayoutId="channel-tab-underline-desktop"
                                    />
                                )}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                    <div className="relative ml-auto flex min-h-9 min-w-0 shrink-0 items-center gap-1 sm:gap-3">
                        <Toolbar />
                    </div>
                    {activeItem === 'channel' && (
                        <ChannelTabSwitcher
                            className="col-start-2 col-end-4 row-start-2 w-fit max-w-full sm:hidden"
                            underlineLayoutId="channel-tab-underline-mobile"
                        />
                    )}
                    <ProxyPoolDialog />
                </header>
                <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                        key={activeItem}
                        variants={ENTRANCE_VARIANTS.content}
                        initial="initial"
                        animate="animate"
                        exit={{
                            opacity: 0,
                            scale: 0.98,
                        }}
                        transition={{ duration: 0.25 }}
                        className="h-full min-h-0 flex-1"
                    >
                        <ContentLoader activeRoute={activeItem} />
                    </motion.div>
                </AnimatePresence>
            </main>
            </motion.div>
        </MotionConfig>
    );
}
