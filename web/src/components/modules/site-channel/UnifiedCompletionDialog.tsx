'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink, KeyRound, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/common/Toast';
import { cn } from '@/lib/utils';
import { useSettingStore } from '@/stores/setting';
import {
    type SiteSourceKeyUpdateRequest,
    useUpdateAnySiteSourceKeys,
} from '@/api/endpoints/site-channel';
import { translateSiteMessage } from '../site/site-message';
import {
    type PendingCompletionSite,
    buildSiteTokenManagementUrl,
    getErrorMessage,
    isMaskedTokenValue,
    matchesMaskedToken,
    platformLabel,
} from './utils';
import { makeAccountKey } from './helpers';

type UnifiedCompletionInputState = Record<number, string>;
type UnifiedCompletionErrorState = Record<string, string>;

export function UnifiedCompletionDialog({
    open,
    onOpenChange,
    sites,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    sites: PendingCompletionSite[];
}) {
    const t = useTranslations();
    const tSite = useTranslations('siteChannel');
    const locale = useSettingStore((state) => state.locale);
    const updateSourceKeys = useUpdateAnySiteSourceKeys();
    const [inputValues, setInputValues] = useState<UnifiedCompletionInputState>({});
    const [savingAccounts, setSavingAccounts] = useState<Record<string, boolean>>({});
    const [accountErrors, setAccountErrors] = useState<UnifiedCompletionErrorState>({});

    const totalPendingCount = useMemo(
        () => sites.reduce((sum, site) => sum + site.pending_count, 0),
        [sites],
    );

    useEffect(() => {
        if (!open) return;
        if (totalPendingCount > 0) return;
        onOpenChange(false);
    }, [open, totalPendingCount, onOpenChange]);

    useEffect(() => {
        setInputValues((current) => {
            const validIds = new Set<number>();
            for (const site of sites) {
                for (const account of site.accounts) {
                    for (const item of account.items) {
                        validIds.add(item.key_id);
                    }
                }
            }

            let changed = false;
            const next: UnifiedCompletionInputState = {};
            for (const [rawId, value] of Object.entries(current)) {
                const keyId = Number(rawId);
                if (!validIds.has(keyId)) {
                    changed = true;
                    continue;
                }
                next[keyId] = value;
            }

            return changed ? next : current;
        });

        setSavingAccounts((current) => {
            const validKeys = new Set<string>();
            for (const site of sites) {
                for (const account of site.accounts) {
                    validKeys.add(makeAccountKey(site.site_id, account.account_id));
                }
            }

            let changed = false;
            const next: Record<string, boolean> = {};
            for (const [key, value] of Object.entries(current)) {
                if (!validKeys.has(key)) {
                    changed = true;
                    continue;
                }
                next[key] = value;
            }
            return changed ? next : current;
        });

        setAccountErrors((current) => {
            const validKeys = new Set<string>();
            for (const site of sites) {
                for (const account of site.accounts) {
                    validKeys.add(makeAccountKey(site.site_id, account.account_id));
                }
            }

            let changed = false;
            const next: UnifiedCompletionErrorState = {};
            for (const [key, value] of Object.entries(current)) {
                if (!validKeys.has(key)) {
                    changed = true;
                    continue;
                }
                next[key] = value;
            }
            return changed ? next : current;
        });
    }, [sites]);

    const handleInputChange = useCallback((keyId: number, value: string) => {
        setInputValues((current) => ({
            ...current,
            [keyId]: value,
        }));
    }, []);

    const handleOpenSite = useCallback((site: PendingCompletionSite) => {
        const url = buildSiteTokenManagementUrl(site.base_url, site.platform);
        if (!url) return;
        window.open(url, '_blank', 'noopener,noreferrer');
    }, []);

    const handleSaveAccount = useCallback(async (site: PendingCompletionSite, accountId: number) => {
        const account = site.accounts.find((item) => item.account_id === accountId);
        if (!account) return;

        const accountKey = makeAccountKey(site.site_id, accountId);
        const itemsToSave = account.items.filter((item) => {
            const value = inputValues[item.key_id]?.trim() ?? '';
            return value.length > 0;
        });

        if (itemsToSave.length === 0) {
            setAccountErrors((current) => ({
                ...current,
                [accountKey]: tSite('completion.errorNoSubmittable'),
            }));
            return;
        }

        for (const item of itemsToSave) {
            const value = inputValues[item.key_id]?.trim() ?? '';
            if (!value) continue;
            if (isMaskedTokenValue(value)) {
                setAccountErrors((current) => ({
                    ...current,
                    [accountKey]: tSite('completion.errorMasked', { group: item.group_name || item.group_key }),
                }));
                return;
            }
            if (!matchesMaskedToken(value, item.token)) {
                setAccountErrors((current) => ({
                    ...current,
                    [accountKey]: tSite('completion.errorMismatch', { group: item.group_name || item.group_key }),
                }));
                return;
            }
        }

        const groupedByGroupKey = new Map<string, typeof itemsToSave>();
        for (const item of itemsToSave) {
            const current = groupedByGroupKey.get(item.group_key) ?? [];
            current.push(item);
            groupedByGroupKey.set(item.group_key, current);
        }

        setSavingAccounts((current) => ({ ...current, [accountKey]: true }));
        setAccountErrors((current) => ({ ...current, [accountKey]: '' }));

        try {
            for (const [groupKey, groupItems] of groupedByGroupKey.entries()) {
                const payload: SiteSourceKeyUpdateRequest = {
                    group_key: groupKey,
                    keys_to_update: groupItems.map((item) => ({
                        id: item.key_id,
                        token: inputValues[item.key_id].trim(),
                        enabled: true,
                    })),
                };

                await updateSourceKeys.mutateAsync({
                    siteId: site.site_id,
                    accountId,
                    payload,
                });
            }

            setInputValues((current) => {
                const next = { ...current };
                for (const item of itemsToSave) {
                    delete next[item.key_id];
                }
                return next;
            });
            toast.success(tSite('completion.saved', { account: account.account_name }));
        } catch (error) {
            setAccountErrors((current) => ({
                ...current,
                [accountKey]: translateSiteMessage(locale, getErrorMessage(error, tSite('completion.saveFailed', { account: account.account_name })), t),
            }));
        } finally {
            setSavingAccounts((current) => ({ ...current, [accountKey]: false }));
        }
    }, [inputValues, locale, t, tSite, updateSourceKeys]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[calc(100vw-1rem)] rounded-[2rem] p-0 sm:max-w-[min(92vw,72rem)]">
                <div className="flex max-h-[calc(100dvh-1rem)] flex-col overflow-hidden sm:max-h-[88dvh]">
                    <DialogHeader className="gap-3 border-b border-border/70 px-5 py-4 text-left sm:px-6">
                        <DialogTitle className="flex items-center gap-2 text-xl">
                            <KeyRound className="size-5 text-primary" />
                            {tSite('completion.title')}
                            <Badge variant="outline" className="h-6 px-2 text-2xs">{tSite('completion.count', { n: totalPendingCount })}</Badge>
                        </DialogTitle>
                        <DialogDescription>
                            {tSite('completion.description')}
                        </DialogDescription>
                        <div className="rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                            {tSite('completion.tip')}
                        </div>
                    </DialogHeader>

                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
                        <div className="space-y-4">
                            {sites.map((site) => {
                                const targetUrl = buildSiteTokenManagementUrl(site.base_url, site.platform);

                                return (
                                    <section key={site.site_id} className="rounded-3xl border border-border/70 bg-card/70 p-4">
                                        <div className="flex flex-col gap-3 border-b border-border/60 pb-4 md:flex-row md:items-start md:justify-between">
                                            <div className="min-w-0 space-y-2">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <div className="line-clamp-2 break-words text-lg font-semibold leading-6 text-foreground md:truncate md:whitespace-nowrap">{site.site_name}</div>
                                                    <Badge variant="outline" className="h-6 px-2 text-2xs">
                                                        {platformLabel(site.platform, tSite)}
                                                    </Badge>
                                                    <Badge variant="outline" className="h-6 px-2 text-2xs border-warning/30 bg-warning/10 text-warning">
                                                        {tSite('completion.pending', { n: site.pending_count })}
                                                    </Badge>
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    {tSite('completion.siteHint')}
                                                </div>
                                            </div>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="rounded-2xl"
                                                onClick={() => handleOpenSite(site)}
                                                disabled={!targetUrl}
                                            >
                                                <ExternalLink className="size-4" />
                                                {tSite('completion.openTokenPage')}
                                            </Button>
                                        </div>

                                        <div className="mt-4 space-y-3">
                                            {site.accounts.map((account) => {
                                                const accountKey = makeAccountKey(site.site_id, account.account_id);
                                                const enteredCount = account.items.filter((item) => {
                                                    const value = inputValues[item.key_id]?.trim() ?? '';
                                                    return value.length > 0;
                                                }).length;
                                                const isSaving = Boolean(savingAccounts[accountKey]);
                                                const accountError = accountErrors[accountKey];

                                                return (
                                                    <div key={account.account_id} className="rounded-2xl border border-border/60 bg-background/70 p-4">
                                                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                                            <div>
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    <div className="text-sm font-semibold text-foreground">{account.account_name}</div>
                                                                    <Badge variant="outline" className="h-5 px-1.5 text-3xs">
                                                                        {tSite('completion.pending', { n: account.items.length })}
                                                                    </Badge>
                                                                    {enteredCount > 0 ? (
                                                                        <Badge variant="outline" className="h-5 px-1.5 text-3xs border-primary/30 bg-primary/10 text-primary">
                                                                            {tSite('completion.entered', { n: enteredCount })}
                                                                        </Badge>
                                                                    ) : null}
                                                                </div>
                                                                <div className="mt-1 text-xs text-muted-foreground">
                                                                    {tSite('completion.accountHint')}
                                                                </div>
                                                            </div>
                                                            <Button
                                                                type="button"
                                                                className="rounded-2xl"
                                                                onClick={() => void handleSaveAccount(site, account.account_id)}
                                                                disabled={isSaving || enteredCount === 0}
                                                            >
                                                                <RefreshCw className={cn('size-4', isSaving && 'animate-spin')} />
                                                                {isSaving ? tSite('completion.saving') : tSite('completion.saveAccount')}
                                                            </Button>
                                                        </div>

                                                        {accountError ? (
                                                            <div className="mt-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                                                                {accountError}
                                                            </div>
                                                        ) : null}

                                                        <div className="mt-4 space-y-3">
                                                            {account.items.map((item) => (
                                                                <div key={item.key_id} className="rounded-2xl border border-border/60 bg-card/80 p-3">
                                                                    <div className="grid gap-3 lg:grid-cols-[minmax(0,15rem)_minmax(0,14rem)_1fr]">
                                                                        <div className="space-y-1">
                                                                            <div className="text-xs text-muted-foreground">{tSite('completion.groupLabel')}</div>
                                                                            <div className="line-clamp-2 break-words text-sm font-medium leading-5 text-foreground md:truncate md:whitespace-nowrap">{item.group_name || item.group_key}</div>
                                                                            <div className="break-all text-2xs text-muted-foreground">{item.group_key}</div>
                                                                        </div>
                                                                        <div className="space-y-1">
                                                                            <div className="text-xs text-muted-foreground">Key</div>
                                                                            <div className="line-clamp-2 break-words text-sm font-medium leading-5 text-foreground md:truncate md:whitespace-nowrap">{item.key_name || tSite('completion.keyFallbackName', { id: item.key_id })}</div>
                                                                            <div className="break-all text-2xs text-muted-foreground">{tSite('completion.currentValue', { value: item.token_masked || item.token })}</div>
                                                                        </div>
                                                                        <label className="grid gap-1.5 text-xs text-muted-foreground">
                                                                            {tSite('completion.inputLabel')}
                                                                            <Input
                                                                                value={inputValues[item.key_id] ?? ''}
                                                                                onChange={(event) => handleInputChange(item.key_id, event.target.value)}
                                                                                placeholder={tSite('completion.inputPlaceholder')}
                                                                                disabled={isSaving}
                                                                                className="h-10 rounded-2xl"
                                                                            />
                                                                        </label>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </section>
                                );
                            })}
                        </div>
                    </div>

                    <DialogFooter className="border-t border-border/70 px-5 py-4 sm:px-6">
                        <Button type="button" variant="outline" className="rounded-2xl" onClick={() => onOpenChange(false)}>
                            {tSite('completion.close')}
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
}
