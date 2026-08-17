'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink, Globe2, Power, Waypoints } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    MorphingDialogTitle,
    MorphingDialogDescription,
    useMorphingDialog,
} from '@/components/ui/morphing-dialog';
import { cn } from '@/lib/utils';
import type { SiteChannelCard } from '@/api/endpoints/site-channel';
import { useEnableSiteAccount } from '@/api/endpoints/site';
import { platformLabel } from './utils';
import type { SiteChannelPendingJump } from './helpers';
import { SiteAccountPanel, SiteAccountPanelSkeleton } from './AccountPanel';

export function SiteChannelDialog({
    card,
    jumpRequest,
    onJumpHandled,
    onNavigateToSite,
    onNavigateToSiteAccount,
    onNavigateToChannel,
}: {
    card: SiteChannelCard;
    jumpRequest: SiteChannelPendingJump | null;
    onJumpHandled: (requestId: number) => void;
    onNavigateToSite: () => void;
    onNavigateToSiteAccount: (accountId: number) => void;
    onNavigateToChannel: (channelId: number) => void;
}) {
    const t = useTranslations('siteChannel');
    const { setIsOpen } = useMorphingDialog();
    const [activeAccountId, setActiveAccountId] = useState<number | null>(card.accounts[0]?.account_id ?? null);
    const [highlightedAccountId, setHighlightedAccountId] = useState<number | null>(null);
    const handledJumpRequestRef = useRef<number | null>(null);
    // Defer mounting the heavy SiteAccountPanel by one frame so the morph
    // animation can start immediately. The panel pulls in recharts, dnd, ~16
    // useStates and ~14 useMemos; rendering it synchronously while the FLIP
    // animation tries to measure layout is the main cause of the perceived
    // "click → wait → animate" delay (especially on top/middle cards).
    const [panelReady, setPanelReady] = useState(false);
    const accountTabRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

    useEffect(() => {
        // Two-frame defer: frame 1 lets the morph animation start + first paint,
        // frame 2 actually mounts the panel content.
        let raf2 = 0;
        const raf1 = window.requestAnimationFrame(() => {
            raf2 = window.requestAnimationFrame(() => setPanelReady(true));
        });
        return () => {
            window.cancelAnimationFrame(raf1);
            if (raf2) window.cancelAnimationFrame(raf2);
        };
    }, []);

    const closeAndNavigate = useCallback((navigate: () => void) => {
        setIsOpen(false);
        window.requestAnimationFrame(() => {
            navigate();
        });
    }, [setIsOpen]);

    const handleOpenSiteBaseUrl = useCallback(() => {
        if (!card.base_url) return;
        window.open(card.base_url, '_blank', 'noopener,noreferrer');
    }, [card.base_url]);

    const resolvedAccount =
        card.accounts.find((account) => account.account_id === activeAccountId) ??
        card.accounts[0] ??
        null;

    const enableSiteAccount = useEnableSiteAccount();

    const setAccountTabRef = useCallback((accountId: number, node: HTMLButtonElement | null) => {
        if (node) {
            accountTabRefs.current.set(accountId, node);
            return;
        }
        accountTabRefs.current.delete(accountId);
    }, []);

    useEffect(() => {
        if (!jumpRequest) return;
        if (jumpRequest.target.siteId !== card.site_id) return;
        if (handledJumpRequestRef.current === jumpRequest.requestId) return;
        const target = jumpRequest.target;
        if (target.kind === 'site-channel-card') return;

        if (activeAccountId !== target.accountId) {
            const frameId = window.requestAnimationFrame(() => {
                setActiveAccountId(target.accountId);
            });
            return () => window.cancelAnimationFrame(frameId);
        }

        const node = accountTabRefs.current.get(target.accountId);
        const frameId = window.requestAnimationFrame(() => {
            if (node) {
                node.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                setHighlightedAccountId(target.accountId);
                window.setTimeout(() => {
                    setHighlightedAccountId((current) =>
                        current === target.accountId ? null : current,
                    );
                }, 1800);
            }

            if (target.kind === 'site-channel-account') {
                handledJumpRequestRef.current = jumpRequest.requestId;
                onJumpHandled(jumpRequest.requestId);
            }
        });

        return () => window.cancelAnimationFrame(frameId);
    }, [jumpRequest, card.site_id, activeAccountId, onJumpHandled]);

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden md:h-[88dvh]">
            <header className="flex flex-none items-center gap-2 border-b border-border/70 px-5 py-3 text-left sm:px-6">
                <MorphingDialogDescription className="sr-only">
                    {t('dialog.panelDescription')}
                </MorphingDialogDescription>

                <MorphingDialogTitle className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-lg font-semibold sm:text-xl">
                    <span className="min-w-0 line-clamp-2 break-words leading-6 md:truncate md:whitespace-nowrap">{card.site_name}</span>
                    <Badge variant="outline" className="h-6 px-2 text-2xs">
                        {platformLabel(card.platform, t)}
                    </Badge>
                    <Badge
                        variant="outline"
                        className={cn(
                            'h-6 px-2 text-2xs',
                            card.enabled
                                ? 'border-success/30 bg-success/10 text-success'
                                : 'border-destructive/30 bg-destructive/10 text-destructive',
                        )}
                    >
                        {card.enabled ? t('badge.siteEnabled') : t('badge.siteDisabled')}
                    </Badge>
                    {resolvedAccount && card.accounts.length <= 1 ? (
                        <>
                            <span className="text-sm font-normal text-muted-foreground">
                                · {resolvedAccount.account_name}
                            </span>
                            <button
                                type="button"
                                onClick={() =>
                                    enableSiteAccount.mutate({
                                        id: resolvedAccount.account_id,
                                        enabled: !resolvedAccount.enabled,
                                    })
                                }
                                disabled={enableSiteAccount.isPending}
                                className={cn(
                                    'inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border px-2 text-2xs font-medium transition hover:opacity-80',
                                    resolvedAccount.enabled
                                        ? 'border-success/30 bg-success/10 text-success'
                                        : 'border-destructive/30 bg-destructive/10 text-destructive',
                                )}
                            >
                                <Power className={cn('size-3', enableSiteAccount.isPending && 'animate-spin')} />
                                {resolvedAccount.enabled ? t('badge.accountEnabled') : t('badge.accountDisabled')}
                            </button>
                        </>
                    ) : null}
                </MorphingDialogTitle>

                <div className="flex flex-none items-center gap-1">
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-8 rounded-xl"
                        onClick={handleOpenSiteBaseUrl}
                        disabled={!card.base_url}
                        aria-label={t('dialog.openSite')}
                        title={t('dialog.openSite')}
                    >
                        <ExternalLink className="size-4" />
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-8 rounded-xl"
                        onClick={() => closeAndNavigate(onNavigateToSite)}
                        aria-label={t('dialog.sitePage')}
                        title={t('dialog.sitePage')}
                    >
                        <Globe2 className="size-4" />
                    </Button>
                    {resolvedAccount ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="size-8 rounded-xl"
                            onClick={() => closeAndNavigate(() => onNavigateToSiteAccount(resolvedAccount.account_id))}
                            aria-label={t('dialog.siteAccountPage')}
                            title={t('dialog.siteAccountPage')}
                        >
                            <Waypoints className="size-4" />
                        </Button>
                    ) : null}
                </div>
            </header>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-3 sm:px-6">
                {resolvedAccount ? (
                    panelReady ? (
                        <SiteAccountPanel
                            key={resolvedAccount.account_id}
                            siteId={card.site_id}
                            account={resolvedAccount}
                            accounts={card.accounts}
                            activeAccountId={activeAccountId}
                            onSelectAccount={setActiveAccountId}
                            highlightedAccountId={highlightedAccountId}
                            registerAccountTabRef={setAccountTabRef}
                            jumpRequest={jumpRequest}
                            onJumpHandled={onJumpHandled}
                            onNavigateToChannel={(channelId) => closeAndNavigate(() => onNavigateToChannel(channelId))}
                        />
                    ) : (
                        <div className="min-h-0 flex-1 overflow-y-auto">
                            <SiteAccountPanelSkeleton />
                        </div>
                    )
                ) : (
                    <div className="flex min-h-[16rem] flex-1 items-center justify-center rounded-3xl border border-dashed border-border/70 bg-muted/20 text-sm text-muted-foreground">
                        {t('panel.noAccount')}
                    </div>
                )}
            </div>
        </div>
    );
}
