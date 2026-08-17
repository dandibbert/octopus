"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type DragEvent,
} from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import {
  Site as SiteRecord,
  SiteAccount,
  SiteCredentialType,
  SitePlatform,
  useCheckinAllSites,
  useCheckinSiteAccount,
  useArchiveSite,
  useArchivedSiteList,
  useDeleteSite,
  useDeleteSiteAccount,
  useEnableSite,
  useEnableSiteAccount,
  useImportAllAPIHub,
  useImportMetAPI,
  useRestoreSite,
  useSiteBatchAction,
  useSiteList,
  useSyncAllSites,
  useSyncSiteAccount,
  useUpdateSite,
} from "@/api/endpoints/site";
import { PageWrapper } from "@/components/common/PageWrapper";
import { toast } from "@/components/common/Toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/animate-ui/components/animate/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  useSearchStore,
  useToolbarViewOptionsStore,
} from "@/components/modules/toolbar";
import { cn } from "@/lib/utils";
import { useSettingStore } from "@/stores/setting";
import { CheckinPanel } from "./CheckinPanel";
import { SiteEditDialog } from "./SiteEditDialog";
import { BatchEditDialog } from "./BatchEditDialog";
import { AccountEditDialog } from "./AccountEditDialog";
import {
  accountHasCheckinEnabled,
  accountMatchesCheckinFilters,
  deriveCheckinStatus,
  sitePlatformSupportsCheckin,
  type CheckinFilterStatus,
} from "./checkin-status";
import { translateSiteMessage } from "./site-message";
import { useSiteUIStore } from "./ui-store";
import {
  isSiteJumpTarget,
  type PendingJump,
  type SiteJumpTarget,
  useJumpStore,
} from "@/stores/jump";
import {
  CalendarCheck2,
  CheckSquare,
  ChevronDown,
  CircleAlert,
  FileJson,
  FilterX,
  Link2,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Power,
  Plus,
  RefreshCw,
  Square,
  Archive,
  ArchiveRestore,
  Trash2,
  TriangleAlert,
  Upload,
  Waypoints,
  X,
} from "lucide-react";

type SiteTranslate = ReturnType<typeof useTranslations>;

function platformLabels(t: SiteTranslate): Record<SitePlatform, string> {
  return {
    [SitePlatform.API]: t("platform.api"),
    [SitePlatform.NewAPI]: "New API",
    [SitePlatform.AnyRouter]: "AnyRouter",
    [SitePlatform.OneAPI]: "One API",
    [SitePlatform.OneHub]: "One Hub",
    [SitePlatform.DoneHub]: "Done Hub",
    [SitePlatform.Sub2API]: "Sub2API",
  };
}

function credentialLabels(t: SiteTranslate): Record<SiteCredentialType, string> {
  return {
    [SiteCredentialType.UsernamePassword]: t("credential.usernamePassword"),
    [SiteCredentialType.AccessToken]: t("credential.accessToken"),
    [SiteCredentialType.APIKey]: t("credential.apiKey"),
  };
}

type HealthTone = "default" | "danger" | "muted" | "warning";

type SiteSummary = {
  accountCount: number;
  keyCount: number;
  modelCount: number;
  groupCount: number;
  balance: number;
  todayIncome: number;
  failedAccountCount: number;
  partialAccountCount: number;
  disabledAccountCount: number;
  enabledAccountCount: number;
  healthLabel: string;
  healthTone: HealthTone;
};

type VisibleSite = {
  site: SiteRecord;
  summary: SiteSummary;
  visibleAccounts: SiteAccount[];
  forceExpanded: boolean;
  hasFilteredAccounts: boolean;
};

const MENU_BUTTON_CLASS =
  "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-left transition-colors hover:bg-muted/60";

type SitePendingJump = PendingJump & { target: SiteJumpTarget };
type ImportSource = "all-api-hub" | "metapi";
type SiteImportResult = {
  created_sites: number;
  reused_sites: number;
  created_accounts: number;
  updated_accounts: number;
  skipped_accounts: number;
  scheduled_sync_accounts?: number;
  warnings: string[];
  imported_tokens?: number;
  imported_groups?: number;
  imported_models?: number;
  disabled_models?: number;
};

function formatDateTime(t: SiteTranslate, value?: string | null) {
  if (!value) return t("common.never");
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getFullYear() <= 1) {
    return t("common.never");
  }
  return date.toLocaleString();
}

function statusLabel(t: SiteTranslate, status: string) {
  switch (status) {
    case "partial":
      return t("status.partial");
    case "success":
      return t("status.success");
    case "failed":
      return t("status.failed");
    case "skipped":
      return t("status.skipped");
    case "idle":
    default:
      return t("status.idle");
  }
}

function SiteMetric({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-muted/20 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

function getSiteErrorMessage(
  locale: ReturnType<typeof useSettingStore.getState>["locale"],
  error: unknown,
  t: ReturnType<typeof useTranslations>,
) {
  return translateSiteMessage(
    locale,
    getErrorMessage(error, t("site.common.operationFailed")),
    t,
  );
}

function formatBalance(value: number) {
  if (value === 0) return "0";
  if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(2)}K`;
  return value.toFixed(2);
}

function normalizeSearchTerm(value: string) {
  return value.trim().toLowerCase();
}

function matchesSearch(value: string | null | undefined, query: string) {
  return (value ?? "").toLowerCase().includes(query);
}

function normalizedStatus(status?: string | null) {
  return status || "idle";
}

function accountHasSyncFailure(account: SiteAccount) {
  return normalizedStatus(account.last_sync_status) === "failed";
}

function accountHasCheckinFailure(
  site: SiteRecord,
  account: SiteAccount,
) {
  return deriveCheckinStatus(site, account) === "failed";
}

function accountHasHealthFailure(
  site: SiteRecord,
  account: SiteAccount,
) {
  return accountHasSyncFailure(account) || accountHasCheckinFailure(site, account);
}

function statusDotClass(status: string) {
  switch (status) {
    case "success":
      return "bg-success";
    case "partial":
      return "bg-warning";
    case "failed":
      return "bg-destructive";
    case "skipped":
      return "bg-warning";
    default:
      return "bg-muted-foreground/40";
  }
}

function badgeToneClass(tone: HealthTone) {
  switch (tone) {
    case "danger":
      return "border-destructive/20 bg-destructive/10 text-destructive";
    case "muted":
      return "border-border bg-muted/40 text-muted-foreground";
    case "warning":
      return "border-warning/20 bg-warning/10 text-warning";
    case "default":
    default:
      return "border-success/20 bg-success/10 text-success";
  }
}

function cardToneClass(tone: HealthTone) {
  switch (tone) {
    case "danger":
      return "border-destructive/25 bg-gradient-to-br from-destructive/10 via-card to-card";
    case "muted":
      return "border-border bg-gradient-to-br from-muted/40 via-card to-card";
    case "warning":
      return "border-warning/25 bg-gradient-to-br from-warning/10 via-card to-card";
    case "default":
    default:
      return "border-border/70 bg-card";
  }
}

function buildSiteSummary(t: SiteTranslate, site: SiteRecord): SiteSummary {
  let keyCount = 0;
  let modelCount = 0;
  let groupCount = 0;
  let balance = 0;
  let todayIncome = 0;
  let failedAccountCount = 0;
  let partialAccountCount = 0;
  let disabledAccountCount = 0;
  let enabledAccountCount = 0;

  for (const account of site.accounts) {
    keyCount += account.tokens.length;
    modelCount += account.models.length;
    groupCount += account.user_groups.length;
    balance += account.balance;
    todayIncome +=
      typeof account.today_income === "number" ? account.today_income : 0;

    if (account.enabled) enabledAccountCount += 1;
    else disabledAccountCount += 1;

    if (accountHasHealthFailure(site, account)) {
      failedAccountCount += 1;
    } else if (normalizedStatus(account.last_sync_status) === "partial") {
      partialAccountCount += 1;
    }
  }

  if (!site.enabled) {
    return {
      accountCount: site.accounts.length,
      keyCount,
      modelCount,
      groupCount,
      balance,
      todayIncome,
      failedAccountCount,
      partialAccountCount,
      disabledAccountCount,
      enabledAccountCount,
      healthLabel: t("health.siteDisabled"),
      healthTone: "muted",
    };
  }

  if (failedAccountCount > 0) {
    return {
      accountCount: site.accounts.length,
      keyCount,
      modelCount,
      groupCount,
      balance,
      todayIncome,
      failedAccountCount,
      partialAccountCount,
      disabledAccountCount,
      enabledAccountCount,
      healthLabel: t("health.failed", { count: failedAccountCount }),
      healthTone: "danger",
    };
  }

  if (disabledAccountCount > 0) {
    return {
      accountCount: site.accounts.length,
      keyCount,
      modelCount,
      groupCount,
      balance,
      todayIncome,
      failedAccountCount,
      partialAccountCount,
      disabledAccountCount,
      enabledAccountCount,
      healthLabel: t("health.disabled", { count: disabledAccountCount }),
      healthTone: "muted",
    };
  }

  if (partialAccountCount > 0) {
    return {
      accountCount: site.accounts.length,
      keyCount,
      modelCount,
      groupCount,
      balance,
      todayIncome,
      failedAccountCount,
      partialAccountCount,
      disabledAccountCount,
      enabledAccountCount,
      healthLabel: t("health.partial", { count: partialAccountCount }),
      healthTone: "warning",
    };
  }

  if (site.accounts.length === 0) {
    return {
      accountCount: site.accounts.length,
      keyCount,
      modelCount,
      groupCount,
      balance,
      todayIncome,
      failedAccountCount,
      partialAccountCount,
      disabledAccountCount,
      enabledAccountCount,
      healthLabel: t("health.unconfigured"),
      healthTone: "warning",
    };
  }

  const allIdle = site.accounts.every(
    (account) =>
      account.enabled &&
      normalizedStatus(account.last_sync_status) === "idle" &&
      (!accountHasCheckinEnabled(account, site.platform) ||
        deriveCheckinStatus(site, account) === "idle"),
  );

  return {
    accountCount: site.accounts.length,
    keyCount,
    modelCount,
    groupCount,
    balance,
    todayIncome,
    failedAccountCount,
    partialAccountCount,
    disabledAccountCount,
    enabledAccountCount,
    healthLabel: allIdle ? t("health.idle") : t("health.normal"),
    healthTone: allIdle ? "warning" : "default",
  };
}

function CompactMetric({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </span>
  );
}

function isCloudflareProtectionMessage(message?: string | null) {
  const lowered = (message ?? "").toLowerCase();
  return lowered.includes("cloudflare") || message?.includes("Cloudflare 保护") === true;
}

function ExecutionSummary({
  label,
  status,
  at,
  message,
}: {
  label: string;
  status: string;
  at?: string | null;
  message?: string | null;
}) {
  const t = useTranslations("site");
  const text = [
    t("execution.summary", { action: label, time: formatDateTime(t, at) }),
    statusLabel(t, status),
  ];
  if (message) {
    text.push(message);
  }

  const cloudflareProtected = isCloudflareProtectionMessage(message);
  const summary = text.join(" · ");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <span
            className={cn(
              "mt-1 size-2 shrink-0 rounded-full",
              cloudflareProtected ? "bg-warning" : statusDotClass(status),
            )}
          />
          <span className="min-w-0 truncate">
            {cloudflareProtected ? t("execution.cloudflarePrefix") : ""}
            {summary}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">{summary}</TooltipContent>
    </Tooltip>
  );
}

function StaticSummary({
  tone = "muted",
  text,
}: {
  tone?: "muted" | "warning";
  text: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 text-xs",
        tone === "warning" ? "text-warning" : "text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "mt-1 size-2 shrink-0 rounded-full",
          tone === "warning" ? "bg-warning" : "bg-muted-foreground/40",
        )}
      />
      <span className="min-w-0 truncate">{text}</span>
    </div>
  );
}

function IconActionButton({
  label,
  className,
  ...props
}: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          className={cn("rounded-xl", className)}
          aria-label={label}
          title={label}
          {...props}
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function estimateVisibleSiteCardHeight(item: VisibleSite, expanded: boolean) {
  const tagRow = item.site.tags.length > 0 ? 30 : 0;
  if (item.forceExpanded || expanded) {
    return 360 + tagRow + item.visibleAccounts.length * 190;
  }
  if (item.site.accounts.length === 0) {
    return 280 + tagRow;
  }
  return 310 + tagRow;
}

export function Site() {
  const t = useTranslations();
  const tSite = useTranslations('site');
  const tProxy = useTranslations('proxyPool');
  const PLATFORM_LABELS = useMemo(() => platformLabels(tSite), [tSite]);
  const CREDENTIAL_LABELS = useMemo(() => credentialLabels(tSite), [tSite]);
  const locale = useSettingStore((state) => state.locale);
  const { data: sites, isLoading, error } = useSiteList();
  const updateSite = useUpdateSite();
  const enableSite = useEnableSite();
  const deleteSite = useDeleteSite();
  const archiveSite = useArchiveSite();
  const restoreSite = useRestoreSite();
  const enableSiteAccount = useEnableSiteAccount();
  const deleteSiteAccount = useDeleteSiteAccount();
  const syncSiteAccount = useSyncSiteAccount();
  const checkinSiteAccount = useCheckinSiteAccount();
  const syncAllSites = useSyncAllSites();
  const checkinAllSites = useCheckinAllSites();
  const importAllAPIHub = useImportAllAPIHub();
  const importMetAPI = useImportMetAPI();
  const batchAction = useSiteBatchAction();

  const [siteDialogOpen, setSiteDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [archivedDialogOpen, setArchivedDialogOpen] = useState(false);
  const {
    data: archivedSites,
    isLoading: archivedLoading,
    error: archivedError,
  } = useArchivedSiteList(archivedDialogOpen);
  const [importPayloadText, setImportPayloadText] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const importDragDepthRef = useRef(0);
  const [isImportDragging, setIsImportDragging] = useState(false);
  const [importSource, setImportSource] =
    useState<ImportSource>("all-api-hub");
  const [lastImportResult, setLastImportResult] =
    useState<SiteImportResult | null>(null);
  const [editingSite, setEditingSite] = useState<SiteRecord | null>(null);

  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [accountSite, setAccountSite] = useState<SiteRecord | null>(null);
  const [editingAccount, setEditingAccount] = useState<SiteAccount | null>(
    null,
  );

  // Batch selection
  const [selectedSiteIds, setSelectedSiteIds] = useState<number[]>([]);
  const [batchEditOpen, setBatchEditOpen] = useState(false);

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: "site" | "account" | "archive-site" | "batch-site";
    id: number;
    name: string;
  } | null>(null);
  const [expandedSiteIds, setExpandedSiteIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [syncingAccountIds, setSyncingAccountIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [checkinAccountIds, setCheckinAccountIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [siteCardHeights, setSiteCardHeights] = useState<Record<number, number>>(
    {},
  );
  const [statusDayKey, setStatusDayKey] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  });
  const cardObserversRef = useRef<Map<number, ResizeObserver>>(new Map());
  const cardElementsRef = useRef<Map<number, HTMLElement>>(new Map());
  const cardMeasureRefCallbacks = useRef<
    Map<number, (node: HTMLElement | null) => void>
  >(new Map());
  const accountElementsRef = useRef<Map<number, HTMLElement>>(new Map());
  const [highlightedSiteId, setHighlightedSiteId] = useState<number | null>(
    null,
  );
  const [highlightedAccountId, setHighlightedAccountId] = useState<number | null>(
    null,
  );

  const searchTerm = useSearchStore((state) => state.getSearchTerm("site"));
  const setSearchTerm = useSearchStore((state) => state.setSearchTerm);
  const siteSortField = useToolbarViewOptionsStore((state) =>
    state.getSortField("site"),
  );
  const siteSortOrder = useToolbarViewOptionsStore((state) =>
    state.getSortOrder("site"),
  );
  const checkinFilterStatuses = useSiteUIStore(
    (state) => state.checkinFilterStatuses,
  );
  const setCheckinFilterStatuses = useSiteUIStore(
    (state) => state.setCheckinFilterStatuses,
  );
  const tagFilters = useSiteUIStore((state) => state.tagFilters);
  const setTagFilters = useSiteUIStore((state) => state.setTagFilters);
  const setSiteHandlers = useSiteUIStore((state) => state.setHandlers);
  const resetSiteHandlers = useSiteUIStore((state) => state.resetHandlers);
  const pendingJump = useJumpStore((state) => state.pending);
  const clearPendingJump = useJumpStore((state) => state.clearPending);
  const requestJump = useJumpStore((state) => state.requestJump);

  const pendingSiteJump =
    pendingJump && isSiteJumpTarget(pendingJump.target)
      ? (pendingJump as SitePendingJump)
      : null;
  const forcedSiteId = pendingSiteJump?.target.siteId ?? null;

  const setSiteCardMeasureRef = useCallback(
    (siteID: number, node: HTMLElement | null) => {
      const observers = cardObserversRef.current;
      const elements = cardElementsRef.current;
      const currentNode = elements.get(siteID);

      if (currentNode === node) {
        return;
      }

      if (currentNode) {
        observers.get(siteID)?.disconnect();
        observers.delete(siteID);
        elements.delete(siteID);
      }

      if (!node) {
        return;
      }

      elements.set(siteID, node);
      const observer = new ResizeObserver((entries) => {
        const nextHeight = Math.round(
          entries[0]?.contentRect.height ?? node.getBoundingClientRect().height,
        );
        setSiteCardHeights((current) =>
          current[siteID] === nextHeight
            ? current
            : { ...current, [siteID]: nextHeight },
        );
      });
      observer.observe(node);
      observers.set(siteID, observer);

      const initialHeight = Math.round(node.getBoundingClientRect().height);
      setSiteCardHeights((current) =>
        current[siteID] === initialHeight
          ? current
          : { ...current, [siteID]: initialHeight },
      );
    },
    [],
  );

  const getSiteCardMeasureRef = useCallback(
    (siteID: number) => {
      const existing = cardMeasureRefCallbacks.current.get(siteID);
      if (existing) {
        return existing;
      }

      const callback = (node: HTMLElement | null) => {
        setSiteCardMeasureRef(siteID, node);
      };
      cardMeasureRefCallbacks.current.set(siteID, callback);
      return callback;
    },
    [setSiteCardMeasureRef],
  );

  const setAccountElementRef = useCallback(
    (accountId: number, node: HTMLElement | null) => {
      const elements = accountElementsRef.current;
      if (node) {
        elements.set(accountId, node);
        return;
      }
      elements.delete(accountId);
    },
    [],
  );

  const flashTarget = useCallback(
    (target: "site" | "account", id: number) => {
      if (target === "site") {
        setHighlightedSiteId(id);
        window.setTimeout(() => {
          setHighlightedSiteId((current) => (current === id ? null : current));
        }, 1800);
        return;
      }

      setHighlightedAccountId(id);
      window.setTimeout(() => {
        setHighlightedAccountId((current) => (current === id ? null : current));
      }, 1800);
    },
    [],
  );

  const inventory = useMemo(() => {
    let totalBalance = 0;
    let totalBalanceUsed = 0;
    let enabledAccounts = 0;
    let totalAccounts = 0;

    for (const site of sites ?? []) {
      for (const account of site.accounts) {
        totalAccounts += 1;
        if (site.enabled && account.enabled) {
          enabledAccounts += 1;
        }
        totalBalance += typeof account.balance === "number" ? account.balance : 0;
        totalBalanceUsed +=
          typeof account.balance_used === "number" ? account.balance_used : 0;
      }
    }

    return {
      totalBalance,
      totalBalanceUsed,
      enabledAccounts,
      totalAccounts,
    };
  }, [sites]);

  const normalizedQuery = useMemo(
    () => normalizeSearchTerm(searchTerm),
    [searchTerm],
  );

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const site of sites ?? []) {
      for (const tag of site.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
      (a, b) => b.count - a.count || a.tag.localeCompare(b.tag),
    );
  }, [sites]);
  const allTagNames = useMemo(
    () => allTags.map((item) => item.tag),
    [allTags],
  );
  const selectedSiteTags = useMemo(() => {
    const tags = new Set<string>();
    for (const site of sites ?? []) {
      if (!selectedSiteIds.includes(site.id)) continue;
      for (const tag of site.tags) {
        tags.add(tag);
      }
    }
    return Array.from(tags);
  }, [sites, selectedSiteIds]);

  const visibleSites = useMemo<VisibleSite[]>(() => {
    const hasSearch = normalizedQuery.length > 0;

    const list = (sites ?? []).flatMap((site) => {
      const summary = buildSiteSummary(tSite, site);
      const isForcedTarget = forcedSiteId === site.id;

      if (
        tagFilters.length > 0 &&
        !isForcedTarget &&
        !site.tags.some((tag) => tagFilters.includes(tag))
      ) {
        return [];
      }

      const hasCheckinFilters = checkinFilterStatuses.length > 0;

      const siteMatchesQuery =
        !hasSearch ||
        matchesSearch(site.name, normalizedQuery) ||
        matchesSearch(site.base_url, normalizedQuery) ||
        matchesSearch(PLATFORM_LABELS[site.platform], normalizedQuery);

      const accountMatchesQuery = (account: SiteAccount) =>
        matchesSearch(account.name, normalizedQuery);

      const matchedAccountsBySearch = hasSearch
        ? site.accounts.filter(accountMatchesQuery)
        : site.accounts;

      let visibleAccounts = site.accounts;
      let forceExpanded = hasCheckinFilters || isForcedTarget;

      if (hasCheckinFilters && !isForcedTarget) {
        visibleAccounts = visibleAccounts.filter((account) =>
          accountMatchesCheckinFilters(site, account, checkinFilterStatuses),
        );
      }

      if (hasSearch && !siteMatchesQuery && !isForcedTarget) {
        visibleAccounts = visibleAccounts.filter(accountMatchesQuery);
        forceExpanded = visibleAccounts.length > 0 || forceExpanded;
      }

      if (isForcedTarget) {
        visibleAccounts = site.accounts;
      }

      const visible =
        isForcedTarget
          ? true
          : hasCheckinFilters
            ? visibleAccounts.length > 0
            : !hasSearch || siteMatchesQuery || matchedAccountsBySearch.length > 0;

      if (!visible) {
        return [];
      }

      return [
        {
          site,
          summary,
          visibleAccounts,
          forceExpanded,
          hasFilteredAccounts: visibleAccounts.length !== site.accounts.length,
        },
      ];
    });

    if (siteSortField === "default") {
      return list;
    }

    return [...list].sort((a, b) => {
      if (a.site.is_pinned !== b.site.is_pinned) {
        return a.site.is_pinned ? -1 : 1;
      }

      let diff = 0;
      if (siteSortField === "balance") {
        diff = a.summary.balance - b.summary.balance;
      } else {
        diff = a.site.name.localeCompare(b.site.name);
      }

      if (diff !== 0) {
        return siteSortOrder === "asc" ? diff : -diff;
      }

      return a.site.sort_order - b.site.sort_order || a.site.id - b.site.id;
    });
  }, [
    sites,
    normalizedQuery,
    checkinFilterStatuses,
    tagFilters,
    forcedSiteId,
    siteSortField,
    siteSortOrder,
    tSite,
    PLATFORM_LABELS,
  ]);

  const hasActiveFilters =
    normalizedQuery.length > 0 ||
    checkinFilterStatuses.length > 0 ||
    tagFilters.length > 0;
  const visibleAccountCount = visibleSites.reduce(
    (sum, item) => sum + item.visibleAccounts.length,
    0,
  );

  function openCreateSiteDialog() {
    setEditingSite(null);
    setSiteDialogOpen(true);
  }

  function openEditSiteDialog(site: SiteRecord) {
    setEditingSite(site);
    setSiteDialogOpen(true);
  }

  function closeSiteDialog(open: boolean) {
    setSiteDialogOpen(open);
    if (!open) {
      setEditingSite(null);
    }
  }

  function openCreateAccountDialog(site: SiteRecord) {
    setAccountSite(site);
    setEditingAccount(null);
    setAccountDialogOpen(true);
  }

  function openEditAccountDialog(site: SiteRecord, account: SiteAccount) {
    setAccountSite(site);
    setEditingAccount(account);
    setAccountDialogOpen(true);
  }

  function closeAccountDialog(open: boolean) {
    setAccountDialogOpen(open);
    if (!open) {
      setAccountSite(null);
      setEditingAccount(null);
    }
  }

  async function handleToggleSite(site: SiteRecord) {
    try {
      await enableSite.mutateAsync({ id: site.id, enabled: !site.enabled });
      toast.success(
        site.enabled ? tSite("toast.siteDisabled") : tSite("toast.siteEnabled"),
      );
    } catch (toggleError) {
      toast.error(getSiteErrorMessage(locale, toggleError, t));
    }
  }

  async function handleDeleteSite(site: SiteRecord) {
    setDeleteConfirm({ type: "site", id: site.id, name: site.name });
  }

  async function handleArchiveSite(site: SiteRecord) {
    setDeleteConfirm({ type: "archive-site", id: site.id, name: site.name });
  }

  async function handleRestoreSite(siteId: number, siteName: string) {
    try {
      await restoreSite.mutateAsync(siteId);
      toast.success(tSite("toast.siteRestored", { name: siteName }));
    } catch (err) {
      toast.error(getSiteErrorMessage(locale, err, t));
    }
  }

  async function handleToggleAccount(account: SiteAccount) {
    try {
      await enableSiteAccount.mutateAsync({
        id: account.id,
        enabled: !account.enabled,
      });
      toast.success(
        account.enabled
          ? tSite("toast.accountDisabled")
          : tSite("toast.accountEnabled"),
      );
    } catch (toggleError) {
      toast.error(getSiteErrorMessage(locale, toggleError, t));
    }
  }

  async function handleDeleteAccount(account: SiteAccount) {
    setDeleteConfirm({ type: "account", id: account.id, name: account.name });
  }

  async function handleSyncAccount(account: SiteAccount) {
    setSyncingAccountIds((current) => new Set(current).add(account.id));
    try {
      const result = await syncSiteAccount.mutateAsync(account.id);
      const summary = tSite("toast.syncSummary", {
        message: result.message,
        groups: result.group_count,
        keys: result.token_count,
        models: result.model_count,
      });
      if (result.status === "failed") {
        toast.error(summary);
      } else if (result.status === "partial") {
        toast.warning(summary);
      } else if (result.status === "success") {
        toast.success(summary);
      } else {
        console.warn(`Unexpected site sync status: ${result.status}`);
        toast.error(summary);
      }
    } catch (syncError) {
      toast.error(getSiteErrorMessage(locale, syncError, t));
    } finally {
      setSyncingAccountIds((current) => {
        const next = new Set(current);
        next.delete(account.id);
        return next;
      });
    }
  }

  async function handleCheckinAccount(account: SiteAccount) {
    setCheckinAccountIds((current) => new Set(current).add(account.id));
    try {
      const result = await checkinSiteAccount.mutateAsync(account.id);
      const message = result.reward
        ? tSite("toast.checkinResultReward", {
            status: statusLabel(tSite, result.status),
            message: result.message,
            reward: result.reward,
          })
        : tSite("toast.checkinResult", {
            status: statusLabel(tSite, result.status),
            message: result.message,
          });
      if (result.status === "failed") {
        toast.error(message);
      } else {
        toast.success(message);
      }
    } catch (checkinError) {
      toast.error(getSiteErrorMessage(locale, checkinError, t));
    } finally {
      setCheckinAccountIds((current) => {
        const next = new Set(current);
        next.delete(account.id);
        return next;
      });
    }
  }

  async function handleImportSites() {
    const hasFile = !!importFile;
    const hasText = !!importPayloadText.trim();
    if (!hasFile && !hasText) {
      toast.error(tSite("import.missingPayload"));
      return;
    }

    try {
      const payload = {
        file: importFile,
        text: importPayloadText,
      };
      const result =
        importSource === "metapi"
          ? await importMetAPI.mutateAsync(payload)
          : await importAllAPIHub.mutateAsync(payload);
      setLastImportResult(result);
      setImportFile(null);
      setImportPayloadText("");
      toast.success(
        tSite("import.success", {
          createdSites: result.created_sites,
          createdAccounts: result.created_accounts,
          updatedAccounts: result.updated_accounts,
        }),
      );
    } catch (importError) {
      toast.error(getSiteErrorMessage(locale, importError, t));
    }
  }

  function setSelectedImportFile(file: File | null) {
    setImportFile(file);
    setLastImportResult(null);
    setIsImportDragging(false);
    importDragDepthRef.current = 0;
    if (!file && importFileInputRef.current) {
      importFileInputRef.current.value = "";
    }
  }

  function isImportFileDrag(event: DragEvent<HTMLDivElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function handleImportDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!isImportFileDrag(event)) return;
    event.preventDefault();
    importDragDepthRef.current += 1;
    setIsImportDragging(true);
  }

  function handleImportDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!isImportFileDrag(event)) return;
    event.preventDefault();
    importDragDepthRef.current = Math.max(0, importDragDepthRef.current - 1);
    if (importDragDepthRef.current === 0) {
      setIsImportDragging(false);
    }
  }

  function handleImportDragOver(event: DragEvent<HTMLDivElement>) {
    if (!isImportFileDrag(event)) return;
    event.preventDefault();
  }

  function handleImportDrop(event: DragEvent<HTMLDivElement>) {
    if (!isImportFileDrag(event)) return;
    event.preventDefault();
    setSelectedImportFile(event.dataTransfer.files?.[0] ?? null);
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === "batch-site") {
      await handleBatchAction("delete");
      setDeleteConfirm(null);
      return;
    }
    try {
      if (deleteConfirm.type === "site") {
        await deleteSite.mutateAsync(deleteConfirm.id);
        toast.success(tSite("toast.siteDeleted"));
        setSelectedSiteIds((prev) =>
          prev.filter((id) => id !== deleteConfirm.id),
        );
        setExpandedSiteIds((current) => {
          const next = new Set(current);
          next.delete(deleteConfirm.id);
          return next;
        });
      } else if (deleteConfirm.type === "archive-site") {
        await archiveSite.mutateAsync(deleteConfirm.id);
        toast.success(tSite("toast.siteArchived"));
        setSelectedSiteIds((prev) =>
          prev.filter((id) => id !== deleteConfirm.id),
        );
        setExpandedSiteIds((current) => {
          const next = new Set(current);
          next.delete(deleteConfirm.id);
          return next;
        });
      } else {
        await deleteSiteAccount.mutateAsync(deleteConfirm.id);
        toast.success(tSite("toast.accountDeleted"));
      }
    } catch (deleteError) {
      toast.error(getSiteErrorMessage(locale, deleteError, t));
    }
    setDeleteConfirm(null);
  }

  function toggleSiteSelection(siteId: number) {
    setSelectedSiteIds((prev) =>
      prev.includes(siteId)
        ? prev.filter((id) => id !== siteId)
        : [...prev, siteId],
    );
  }

  async function handleBatchAction(action: string) {
    if (selectedSiteIds.length === 0) {
      toast.error(tSite("toast.selectSiteFirst"));
      return;
    }
    try {
      const result = await batchAction.mutateAsync({
        ids: selectedSiteIds,
        action,
      });
      const successCount = result.success_ids.length;
      const failedCount = result.failed_items.length;
      toast.success(
        tSite("toast.batchResult", {
          success: successCount,
          failed: failedCount,
        }),
      );
      if (action === "delete") {
        setSelectedSiteIds([]);
      }
    } catch (batchError) {
      toast.error(getSiteErrorMessage(locale, batchError, t));
    }
  }

  async function handleTogglePin(site: SiteRecord) {
    try {
      await updateSite.mutateAsync({ id: site.id, is_pinned: !site.is_pinned });
      toast.success(
        site.is_pinned ? tSite("toast.unpinned") : tSite("toast.pinned"),
      );
    } catch (pinError) {
      toast.error(getSiteErrorMessage(locale, pinError, t));
    }
  }

  function handleCheckinFilterChange(status: CheckinFilterStatus) {
    if (status === "all") {
      setCheckinFilterStatuses([]);
      return;
    }

    setCheckinFilterStatuses((current) =>
      current.includes(status)
        ? current.filter((item) => item !== status)
        : [...current, status],
    );
  }

  function handleTagFilterChange(tag: string) {
    setTagFilters((current) =>
      current.includes(tag)
        ? current.filter((item) => item !== tag)
        : [...current, tag],
    );
  }

  function clearFilters() {
    setSearchTerm("site", "");
    setCheckinFilterStatuses([]);
    setTagFilters([]);
  }

  function jumpToSiteChannel(siteId: number) {
    requestJump({ kind: "site-channel-card", siteId });
  }

  function jumpToSiteChannelAccount(siteId: number, accountId: number) {
    requestJump({ kind: "site-channel-account", siteId, accountId });
  }

  function toggleSiteExpanded(siteId: number, forceExpanded: boolean) {
    if (forceExpanded) return;
    setExpandedSiteIds((current) => {
      const next = new Set(current);
      if (next.has(siteId)) next.delete(siteId);
      else next.add(siteId);
      return next;
    });
  }

  useEffect(() => {
    setSiteHandlers({
      openCreateDialog: () => {
        setEditingSite(null);
        setSiteDialogOpen(true);
      },
      openImportDialog: () => setImportDialogOpen(true),
      openArchivedDialog: () => setArchivedDialogOpen(true),
      syncAll: () => {
        syncAllSites.mutate(undefined, {
          onSuccess: () => toast.success(tSite("toast.syncAllTriggered")),
          onError: (error) => toast.error(getSiteErrorMessage(locale, error, t)),
        });
      },
      checkinAll: () => {
        checkinAllSites.mutate(undefined, {
          onSuccess: () => toast.success(tSite("toast.checkinAllTriggered")),
          onError: (error) => toast.error(getSiteErrorMessage(locale, error, t)),
        });
      },
    });

    return () => {
      resetSiteHandlers();
    };
  }, [setSiteHandlers, resetSiteHandlers, syncAllSites, checkinAllSites, locale, t, tSite]);

  useEffect(() => {
    const updateDayKey = () => {
      const now = new Date();
      setStatusDayKey(`${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`);
    };

    updateDayKey();
    const timer = window.setInterval(updateDayKey, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const observerMap = cardObserversRef.current;
    const elementMap = cardElementsRef.current;
    const callbackMap = cardMeasureRefCallbacks.current;
    const accountMap = accountElementsRef.current;
    return () => {
      for (const observer of observerMap.values()) {
        observer.disconnect();
      }
      observerMap.clear();
      elementMap.clear();
      callbackMap.clear();
      accountMap.clear();
    };
  }, []);

  useEffect(() => {
    if (!pendingSiteJump) return;

    const { requestId, target } = pendingSiteJump;
    const targetSiteId = target.siteId;
    const siteVisible = visibleSites.some((item) => item.site.id === targetSiteId);
    if (!siteVisible) return;

    if (target.kind === "site-account") {
      setExpandedSiteIds((current) => {
        if (current.has(target.siteId)) return current;
        const next = new Set(current);
        next.add(target.siteId);
        return next;
      });
    }

    const node =
      target.kind === "site-account"
        ? accountElementsRef.current.get(target.accountId)
        : cardElementsRef.current.get(target.siteId);
    if (!node) return;

    const timer = window.setTimeout(() => {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      flashTarget("site", target.siteId);
      if (target.kind === "site-account") {
        flashTarget("account", target.accountId);
      }
      clearPendingJump(requestId);
    }, 80);

    return () => window.clearTimeout(timer);
  }, [pendingSiteJump, visibleSites, clearPendingJump, flashTarget]);

  const masonryColumns = useMemo<[VisibleSite[], VisibleSite[]]>(() => {
    const left: VisibleSite[] = [];
    const right: VisibleSite[] = [];
    let leftHeight = 0;
    let rightHeight = 0;

    for (const item of visibleSites) {
      const isExpanded = item.forceExpanded || expandedSiteIds.has(item.site.id);
      const estimatedHeight =
        siteCardHeights[item.site.id] ??
        estimateVisibleSiteCardHeight(item, isExpanded);
      if (leftHeight <= rightHeight) {
        left.push(item);
        leftHeight += estimatedHeight;
      } else {
        right.push(item);
        rightHeight += estimatedHeight;
      }
    }

    return [left, right];
  }, [visibleSites, expandedSiteIds, siteCardHeights]);

  const renderSiteCard = ({
    site,
    summary,
    visibleAccounts,
    forceExpanded,
    hasFilteredAccounts,
  }: VisibleSite) => {
    const isExpanded = forceExpanded || expandedSiteIds.has(site.id);

    return (
      <section
        key={site.id}
        className={cn(
          "custom-shadow rounded-3xl border bg-card p-5 transition-colors",
          cardToneClass(summary.healthTone),
          highlightedSiteId === site.id &&
            "ring-2 ring-primary/35 ring-offset-2 ring-offset-background",
        )}
      >
        <div className="flex items-start gap-3">
          <button
            type="button"
            className="relative mt-1 shrink-0 text-muted-foreground transition-colors before:absolute before:-inset-2.5 before:content-[''] hover:text-foreground"
            title={
              selectedSiteIds.includes(site.id)
                ? tSite("card.deselectSite")
                : tSite("card.selectSite")
            }
            onClick={() => toggleSiteSelection(site.id)}
          >
            {selectedSiteIds.includes(site.id) ? (
              <CheckSquare className="size-5 text-primary" />
            ) : (
              <Square className="size-5" />
            )}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-3">
              <div
                className="min-w-0 flex-1 cursor-pointer text-left"
                role="button"
                tabIndex={0}
                onClick={() => toggleSiteExpanded(site.id, forceExpanded)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleSiteExpanded(site.id, forceExpanded);
                  }
                }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="line-clamp-2 break-words text-lg font-semibold leading-6 md:truncate md:whitespace-nowrap">{site.name}</h2>
                  {site.is_pinned ? (
                    <Badge variant="outline" className="text-warning">
                      <Pin className="mr-1 size-3" />
                      {tSite("card.pinned")}
                    </Badge>
                  ) : null}
                  <Badge variant="outline">
                    {PLATFORM_LABELS[site.platform]}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={badgeToneClass(summary.healthTone)}
                  >
                    {summary.healthLabel}
                  </Badge>
                </div>

                <div className="mt-2 flex items-start gap-2 text-sm text-muted-foreground md:items-center">
                  <Link2 className="mt-0.5 size-4 shrink-0 md:mt-0" />
                  <a
                    href={site.base_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 line-clamp-2 break-all leading-5 transition-colors hover:text-foreground hover:underline md:truncate md:whitespace-nowrap"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {site.base_url}
                  </a>
                </div>

                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                  <CompactMetric label={tSite("card.accounts")} value={summary.accountCount} />
                  <CompactMetric label={tSite("card.keys")} value={summary.keyCount} />
                  <CompactMetric label={tSite("card.models")} value={summary.modelCount} />
                  <CompactMetric label={tSite("card.balance")} value={formatBalance(summary.balance)} />
                  <CompactMetric
                    label={tSite("card.todayIncome")}
                    value={formatBalance(summary.todayIncome)}
                  />
                </div>

                {site.tags.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {site.tags.map((tag) => (
                      <Badge
                        key={tag}
                        asChild
                        variant="secondary"
                        className={cn(
                          "cursor-pointer transition-colors hover:bg-secondary/70",
                          tagFilters.includes(tag) &&
                            "bg-primary text-primary-foreground hover:bg-primary/90",
                        )}
                      >
                        <button
                          type="button"
                          title={
                            tagFilters.includes(tag)
                              ? tSite("card.clearTagFilter", { tag })
                              : tSite("card.filterByTag", { tag })
                          }
                          aria-pressed={tagFilters.includes(tag)}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleTagFilterChange(tag);
                          }}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          {tag}
                        </button>
                      </Badge>
                    ))}
                  </div>
                ) : null}

                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {site.proxy_mode === "pool"
                      ? tProxy('mode.pool')
                      : site.proxy_mode === "system"
                        ? tProxy('mode.system')
                        : tProxy('mode.direct')}
                  </span>
                  {site.custom_header.length > 0 ? (
                    <span>
                      {tSite("card.headerCount", {
                        count: site.custom_header.length,
                      })}
                    </span>
                  ) : null}
                  {site.external_checkin_url ? (
                    <span>{tSite("card.manualCheckin")}</span>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-1">
                {site.accounts.length === 0 ? (
                  <IconActionButton
                    label={tSite("card.addAccount")}
                    onClick={() => openCreateAccountDialog(site)}
                  >
                    <Plus className="size-4" />
                  </IconActionButton>
                ) : null}

                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      className="rounded-xl"
                      aria-label={tSite("card.moreSiteActions")}
                      title={tSite("card.moreSiteActions")}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="w-52 rounded-2xl border border-border/60 bg-card p-2"
                  >
                    <div className="grid gap-1">
                      <button
                        type="button"
                        className={MENU_BUTTON_CLASS}
                        onClick={() => jumpToSiteChannel(site.id)}
                      >
                        <Waypoints className="size-4" />
                        <span>{tSite("card.viewSiteChannel")}</span>
                      </button>
                      {site.accounts.length > 0 ? (
                        <button
                          type="button"
                          className={MENU_BUTTON_CLASS}
                          onClick={() => openCreateAccountDialog(site)}
                        >
                          <Plus className="size-4" />
                          <span>{tSite("card.addAccount")}</span>
                        </button>
                      ) : null}
                      <div className="my-1 border-t border-border/60" />
                      <button
                        type="button"
                        className={MENU_BUTTON_CLASS}
                        onClick={() => openEditSiteDialog(site)}
                      >
                        <Pencil className="size-4" />
                        <span>{tSite("card.editSite")}</span>
                      </button>
                      <button
                        type="button"
                        className={MENU_BUTTON_CLASS}
                        onClick={() => handleTogglePin(site)}
                      >
                        {site.is_pinned ? (
                          <PinOff className="size-4" />
                        ) : (
                          <Pin className="size-4" />
                        )}
                        <span>
                          {site.is_pinned
                            ? tSite("card.unpin")
                            : tSite("card.pin")}
                        </span>
                      </button>
                      <button
                        type="button"
                        className={MENU_BUTTON_CLASS}
                        onClick={() => handleToggleSite(site)}
                      >
                        <Power className="size-4" />
                        <span>
                          {site.enabled
                            ? tSite("card.disableSite")
                            : tSite("card.enableSite")}
                        </span>
                      </button>
                      <button
                        type="button"
                        className={MENU_BUTTON_CLASS}
                        onClick={() => handleArchiveSite(site)}
                      >
                        <Archive className="size-4" />
                        <span>{tSite("card.archiveSite")}</span>
                      </button>
                      <button
                        type="button"
                        className={cn(MENU_BUTTON_CLASS, "text-destructive")}
                        onClick={() => handleDeleteSite(site)}
                      >
                        <Trash2 className="size-4" />
                        <span>{tSite("card.deleteSite")}</span>
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>

                <IconActionButton
                  label={
                    forceExpanded
                      ? tSite("card.autoExpanded")
                      : isExpanded
                        ? tSite("card.collapseAccounts")
                        : tSite("card.expandAccounts")
                  }
                  disabled={forceExpanded || site.accounts.length === 0}
                  onClick={() => toggleSiteExpanded(site.id, forceExpanded)}
                >
                  <ChevronDown
                    className={cn(
                      "size-4 transition-transform",
                      isExpanded && "rotate-180",
                    )}
                  />
                </IconActionButton>
              </div>
            </div>

            <AnimatePresence initial={false}>
              {isExpanded ? (
                <motion.div
                  key="site-accounts"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                  className="overflow-hidden"
                >
                  <div className="mt-4 border-t border-border/60 pt-4">
                    {hasFilteredAccounts ? (
                      <div className="mb-3 text-xs text-muted-foreground">
                        {tSite("card.visibleAccounts", {
                          visible: visibleAccounts.length,
                          total: site.accounts.length,
                        })}
                      </div>
                    ) : null}

                    {visibleAccounts.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border/70 bg-muted/10 px-4 py-6 text-sm text-muted-foreground">
                        {tSite("card.noAccounts")}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {visibleAccounts.map((account) => {
                          const accountFailed = accountHasHealthFailure(site, account);
                          const accountTone: HealthTone = accountFailed
                            ? "danger"
                            : account.enabled
                              ? "default"
                              : "muted";
                          const supportsCheckin = sitePlatformSupportsCheckin(
                            site.platform,
                          );
                          const canShowManualCheckin =
                            supportsCheckin &&
                            accountHasCheckinEnabled(account, site.platform);

                          return (
                            <article
                              key={account.id}
                              ref={(node) => setAccountElementRef(account.id, node)}
                              className={cn(
                                "rounded-2xl border px-4 py-3 transition-colors",
                                cardToneClass(accountTone),
                                highlightedAccountId === account.id &&
                                  "ring-2 ring-primary/35 ring-offset-2 ring-offset-background",
                              )}
                            >
                              <div className="space-y-3">
                                <div className="flex items-start gap-3">
                                  <div className="min-w-0 flex-1 space-y-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <div className="text-sm font-semibold">
                                        {account.name}
                                      </div>
                                      <Badge variant="outline">
                                        {
                                          CREDENTIAL_LABELS[
                                            account.credential_type
                                          ]
                                        }
                                      </Badge>
                                      <Badge
                                        variant="outline"
                                        className={
                                          account.enabled
                                            ? "text-success"
                                            : "text-muted-foreground"
                                        }
                                      >
                                        {account.enabled
                                          ? tSite("account.enabled")
                                          : tSite("account.disabled")}
                                      </Badge>
                                    </div>

                                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                                      <CompactMetric
                                        label={tSite("card.groups")}
                                        value={account.user_groups.length}
                                      />
                                      <CompactMetric
                                        label={tSite("card.models")}
                                        value={account.models.length}
                                      />
                                      <CompactMetric
                                        label={tSite("card.balance")}
                                        value={formatBalance(account.balance)}
                                      />
                                      <CompactMetric
                                        label={tSite("card.todayIncome")}
                                        value={formatBalance(account.today_income)}
                                      />
                                    </div>

                                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                      <span>
                                        {account.auto_sync
                                          ? tSite("account.autoSync")
                                          : tSite("account.manualSync")}
                                      </span>
                                      <span>
                                        {account.auto_checkin
                                          ? account.random_checkin
                                            ? tSite("account.randomCheckin")
                                            : tSite("account.autoCheckin")
                                          : tSite("account.manualCheckin")}
                                      </span>
                                      <span>
                                        {account.proxy_mode === "inherit"
                                          ? tProxy('site.inherit')
                                          : account.proxy_mode === "pool"
                                            ? tProxy('mode.pool')
                                            : account.proxy_mode === "system"
                                              ? tProxy('mode.system')
                                              : tProxy('mode.direct')}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex shrink-0 items-center gap-2 self-start">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span>
                                          <Switch
                                            checked={account.enabled}
                                            disabled={enableSiteAccount.isPending}
                                            onCheckedChange={() =>
                                              handleToggleAccount(account)
                                            }
                                          />
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {account.enabled
                                          ? tSite("account.disableAccount")
                                          : tSite("account.enableAccount")}
                                      </TooltipContent>
                                    </Tooltip>

                                    <IconActionButton
                                      label={tSite("account.syncAccount")}
                                      disabled={syncingAccountIds.has(account.id)}
                                      onClick={() => handleSyncAccount(account)}
                                    >
                                      <RefreshCw
                                        className={cn(
                                          "size-4",
                                          syncingAccountIds.has(account.id) &&
                                            "animate-spin",
                                        )}
                                      />
                                    </IconActionButton>

                                    <Popover>
                                      <PopoverTrigger asChild>
                                        <Button
                                          type="button"
                                          size="icon-sm"
                                          variant="outline"
                                          className="rounded-xl"
                                          aria-label={tSite("card.moreAccountActions")}
                                          title={tSite("card.moreAccountActions")}
                                        >
                                          <MoreHorizontal className="size-4" />
                                        </Button>
                                      </PopoverTrigger>
                                      <PopoverContent
                                        align="end"
                                        className="w-44 rounded-2xl border border-border/60 bg-card p-2"
                                      >
                                        <div className="grid gap-1">
                                          <button
                                            type="button"
                                            className={MENU_BUTTON_CLASS}
                                            onClick={() =>
                                              jumpToSiteChannelAccount(site.id, account.id)
                                            }
                                          >
                                            <Waypoints className="size-4" />
                                            <span>{tSite("card.viewSiteChannel")}</span>
                                          </button>
                                          <button
                                            type="button"
                                            className={cn(
                                              MENU_BUTTON_CLASS,
                                              "disabled:cursor-not-allowed disabled:opacity-50",
                                            )}
                                            onClick={() =>
                                              handleCheckinAccount(account)
                                            }
                                            disabled={checkinAccountIds.has(account.id)}
                                            hidden={!canShowManualCheckin}
                                          >
                                            <CalendarCheck2 className="size-4" />
                                            <span>{tSite("account.checkinNow")}</span>
                                          </button>
                                          <button
                                            type="button"
                                            className={MENU_BUTTON_CLASS}
                                            onClick={() =>
                                              openEditAccountDialog(site, account)
                                            }
                                          >
                                            <Pencil className="size-4" />
                                            <span>{tSite("account.editAccount")}</span>
                                          </button>
                                          <button
                                            type="button"
                                            className={cn(
                                              MENU_BUTTON_CLASS,
                                              "text-destructive",
                                            )}
                                            onClick={() =>
                                              handleDeleteAccount(account)
                                            }
                                          >
                                            <Trash2 className="size-4" />
                                            <span>{tSite("account.deleteAccount")}</span>
                                          </button>
                                        </div>
                                      </PopoverContent>
                                    </Popover>
                                  </div>
                                </div>

                                <div className="space-y-1">
                                    <ExecutionSummary
                                      label={tSite("execution.sync")}
                                      status={normalizedStatus(
                                        account.last_sync_status,
                                      )}
                                      at={account.last_sync_at}
                                      message={
                                        translateSiteMessage(locale, account.last_sync_message, t) ||
                                        tSite("execution.waitingFirstSync")
                                      }
                                    />
                                    {supportsCheckin ? (
                                      accountHasCheckinEnabled(
                                        account,
                                        site.platform,
                                      ) ? (
                                        <ExecutionSummary
                                          label={tSite("execution.checkin")}
                                          status={normalizedStatus(
                                            account.last_checkin_status,
                                          )}
                                          at={account.last_checkin_at}
                                          message={
                                            account.last_checkin_message ||
                                            tSite("execution.waitingFirstCheckin")
                                          }
                                        />
                                      ) : (
                                        <StaticSummary
                                          text={tSite("execution.checkinDisabled")}
                                        />
                                      )
                                    ) : (
                                      <StaticSummary
                                        tone="warning"
                                        text={tSite("execution.checkinUnsupported")}
                                      />
                                    )}
                                    {account.auto_checkin &&
                                    account.random_checkin ? (
                                      <div className="pl-4 text-xs text-muted-foreground">
                                        {tSite("execution.nextAutoCheckin", {
                                          time: account.next_auto_checkin_at
                                            ? formatDateTime(
                                                tSite,
                                                account.next_auto_checkin_at,
                                              )
                                            : tSite("common.pendingSchedule"),
                                          hours: account.checkin_interval_hours,
                                          minutes:
                                            account.checkin_random_window_minutes,
                                        })}
                                      </div>
                                    ) : null}
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      </section>
    );
  };

  return (
    <div className="h-full min-h-0 touch-pan-y overflow-y-auto overscroll-y-auto rounded-t-3xl [-webkit-overflow-scrolling:touch] md:overscroll-contain">
      <PageWrapper
        className="space-y-4 pb-24 md:pb-4"
        childLayout={false}
        animateChildren={false}
      >
        <CheckinPanel
          sites={sites}
          inventory={inventory}
          statusDayKey={statusDayKey}
          visibleSiteCount={visibleSites.length}
          visibleAccountCount={visibleAccountCount}
          searchTerm={searchTerm.trim()}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={clearFilters}
          activeFilterStatuses={checkinFilterStatuses}
          onFilterChange={handleCheckinFilterChange}
          allTags={allTags}
          activeTags={tagFilters}
          onTagFilterChange={handleTagFilterChange}
        />

        {selectedSiteIds.length > 0 ? (
          <section className="custom-shadow sticky top-0 z-30 rounded-3xl border border-border/70 bg-card/95 p-4 backdrop-blur supports-[backdrop-filter]:bg-card/90">
            <div className="flex flex-wrap items-center gap-3">
              {(() => {
                const visibleIds = visibleSites.map((item) => item.site.id);
                const allVisibleSelected =
                  visibleIds.length > 0 &&
                  visibleIds.every((id) => selectedSiteIds.includes(id));
                return (
                  <button
                    type="button"
                    onClick={() => {
                      if (allVisibleSelected) {
                        setSelectedSiteIds((prev) =>
                          prev.filter((id) => !visibleIds.includes(id))
                        );
                      } else {
                        setSelectedSiteIds((prev) =>
                          Array.from(new Set([...prev, ...visibleIds]))
                        );
                      }
                    }}
                    disabled={visibleIds.length === 0}
                    title={
                      allVisibleSelected
                        ? tSite("bulk.clearSelection")
                        : tSite("bulk.selectAllVisible")
                    }
                    className="inline-flex items-center gap-2 text-sm font-medium text-foreground transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {allVisibleSelected ? (
                      <CheckSquare className="size-5 text-primary" />
                    ) : (
                      <Square className="size-5" />
                    )}
                    {tSite("bulk.selectAll")}
                  </button>
                );
              })()}
              <span className="text-sm font-medium">
                {tSite("bulk.selectedCount", { count: selectedSiteIds.length })}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => handleBatchAction("enable")}
                disabled={batchAction.isPending}
              >
                {tSite("bulk.enable")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => handleBatchAction("disable")}
                disabled={batchAction.isPending}
              >
                {tSite("bulk.disable")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => setBatchEditOpen(true)}
                disabled={batchAction.isPending}
              >
                {tSite("bulk.edit")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="rounded-xl"
                onClick={() =>
                  setDeleteConfirm({
                    type: "batch-site",
                    id: 0,
                    name: String(selectedSiteIds.length),
                  })
                }
                disabled={batchAction.isPending}
              >
                {tSite("bulk.delete")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-xl"
                onClick={() => setSelectedSiteIds([])}
              >
                {tSite("bulk.cancel")}
              </Button>
            </div>
          </section>
        ) : null}

        {error ? (
          <section className="rounded-3xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
            {tSite("list.loadFailed", {
              message: getSiteErrorMessage(locale, error, t),
            })}
          </section>
        ) : null}

        {isLoading ? (
          <section className="rounded-3xl border border-border bg-card p-6 text-sm text-muted-foreground">
            {tSite("list.loading")}
          </section>
        ) : null}

        {!isLoading && !error && (!sites || sites.length === 0) ? (
          <section className="rounded-3xl border border-dashed border-border bg-card p-10 text-center">
            <CircleAlert className="mx-auto size-8 text-muted-foreground" />
            <div className="mt-4 text-lg font-semibold">{tSite("empty.title")}</div>
            <p className="mt-2 text-sm text-muted-foreground">
              {tSite("empty.description")}
            </p>
            <Button onClick={openCreateSiteDialog} className="mt-5 rounded-xl">
              <Plus className="size-4" />
              {tSite("empty.action")}
            </Button>
          </section>
        ) : null}

        {!isLoading &&
        !error &&
        sites &&
        sites.length > 0 &&
        visibleSites.length === 0 ? (
          <section className="rounded-3xl border border-dashed border-border bg-card p-10 text-center">
            <CircleAlert className="mx-auto size-8 text-muted-foreground" />
            <div className="mt-4 text-lg font-semibold">
              {tSite("empty.noMatchTitle")}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {tSite("empty.noMatchDescription")}
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-5 rounded-xl"
              onClick={clearFilters}
            >
              <FilterX className="size-4" />
              {tSite("empty.clearFilters")}
            </Button>
          </section>
        ) : null}

        {visibleSites.length > 0 ? (
          <>
            <div className="space-y-4 md:hidden">
              {visibleSites.map((item) => (
                <div
                  key={item.site.id}
                  ref={getSiteCardMeasureRef(item.site.id)}
                >
                  {renderSiteCard(item)}
                </div>
              ))}
            </div>
            <div className="hidden items-start gap-4 md:grid md:grid-cols-2">
              <div className="space-y-4">
                {masonryColumns[0].map((item) => (
                  <div
                    key={item.site.id}
                    ref={getSiteCardMeasureRef(item.site.id)}
                  >
                    {renderSiteCard(item)}
                  </div>
                ))}
              </div>
              <div className="space-y-4">
                {masonryColumns[1].map((item) => (
                  <div
                    key={item.site.id}
                    ref={getSiteCardMeasureRef(item.site.id)}
                  >
                    {renderSiteCard(item)}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </PageWrapper>

      <SiteEditDialog
        key={editingSite ? `edit-site-${editingSite.id}` : "create-site"}
        open={siteDialogOpen}
        onOpenChange={closeSiteDialog}
        site={editingSite}
        onCreated={(createdSite) => openCreateAccountDialog(createdSite)}
        allTags={allTagNames}
      />

      <BatchEditDialog
        open={batchEditOpen}
        onOpenChange={setBatchEditOpen}
        selectedSiteIds={selectedSiteIds}
        allTagNames={allTagNames}
        selectedSiteTags={selectedSiteTags}
      />

      <AccountEditDialog
        key={
          editingAccount
            ? `edit-site-account-${editingAccount.id}`
            : accountSite
              ? `create-site-account-${accountSite.id}`
              : "site-account"
        }
        open={accountDialogOpen}
        onOpenChange={closeAccountDialog}
        site={accountSite}
        account={editingAccount}
      />

      <Dialog
        open={importDialogOpen}
        onOpenChange={(open) => {
          setImportDialogOpen(open);
          if (!open) setLastImportResult(null);
        }}
      >
        <DialogContent className="max-w-3xl rounded-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileJson className="size-5" />
              {tSite("import.title")}
            </DialogTitle>
            <DialogDescription>
              {tSite("import.description")}
            </DialogDescription>
          </DialogHeader>

          <div
            className="space-y-5"
            onDragEnter={handleImportDragEnter}
            onDragLeave={handleImportDragLeave}
            onDragOver={handleImportDragOver}
            onDrop={handleImportDrop}
          >
            <div className="grid gap-2 text-sm">
              <span className="font-medium">{tSite("import.source")}</span>
              <Select
                value={importSource}
                onValueChange={(value) => {
                  setImportSource(value as ImportSource);
                  setLastImportResult(null);
                }}
              >
                <SelectTrigger className="w-full rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all-api-hub">All API Hub</SelectItem>
                  <SelectItem value="metapi">Metapi</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2 text-sm">
              <div className="text-sm font-medium">{tSite("import.uploadFile")}</div>
              <div className="flex items-center gap-2">
                <Input
                  ref={importFileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => {
                    setSelectedImportFile(event.target.files?.[0] ?? null);
                  }}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => importFileInputRef.current?.click()}
                  className={cn(
                    "flex min-w-0 flex-1 items-center justify-center rounded-xl border border-dashed px-3 text-center text-sm transition-all hover:bg-muted/30",
                    isImportDragging
                      ? "min-h-28 border-primary bg-primary/10 text-primary"
                      : "min-h-10 border-border bg-muted/20",
                  )}
                >
                  <span
                    className={cn(
                      "min-w-0 truncate",
                      importFile ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {isImportDragging
                      ? tSite("import.dropHint")
                      : importFile?.name ?? tSite("import.pickHint")}
                  </span>
                </button>
                <IconActionButton
                  label={tSite("import.clearFile")}
                  onClick={() => {
                    setSelectedImportFile(null);
                  }}
                  disabled={!importFile}
                  className={!importFile ? "opacity-50" : undefined}
                >
                  <X className="size-4" />
                </IconActionButton>
              </div>
              <div className="text-xs text-muted-foreground">
                {importFile
                  ? tSite("import.selectedFile", { name: importFile.name })
                  : tSite("import.supportedFile", {
                      source:
                        importSource === "metapi" ? "Metapi" : "All API Hub",
                    })}
              </div>
            </div>

            <label className="grid gap-2 text-sm">
              <span className="font-medium">{tSite("import.pasteLabel")}</span>
              <textarea
                value={importPayloadText}
                onChange={(event) => {
                  setImportPayloadText(event.target.value);
                  setLastImportResult(null);
                }}
                placeholder={
                  importSource === "metapi"
                    ? tSite("import.pastePlaceholderMetapi")
                    : tSite("import.pastePlaceholderAllAPIHub")
                }
                className="min-h-40 rounded-2xl border border-input bg-background px-4 py-3 font-mono text-xs outline-none transition focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
              />
              <span className="text-xs text-muted-foreground">
                {importSource === "metapi"
                  ? tSite("import.hintMetapi")
                  : tSite("import.hintAllAPIHub")}
              </span>
            </label>

            {lastImportResult ? (
              <div className="space-y-4 rounded-2xl border border-border/60 bg-muted/10 p-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <SiteMetric
                    label={tSite("import.createdSites")}
                    value={lastImportResult.created_sites}
                  />
                  <SiteMetric
                    label={tSite("import.reusedSites")}
                    value={lastImportResult.reused_sites}
                  />
                  <SiteMetric
                    label={tSite("import.createdAccounts")}
                    value={lastImportResult.created_accounts}
                  />
                  <SiteMetric
                    label={tSite("import.updatedAccounts")}
                    value={lastImportResult.updated_accounts}
                  />
                  <SiteMetric
                    label={tSite("import.skippedAccounts")}
                    value={lastImportResult.skipped_accounts}
                  />
                  {typeof lastImportResult.scheduled_sync_accounts ===
                  "number" ? (
                    <SiteMetric
                      label={tSite("import.scheduledSync")}
                      value={lastImportResult.scheduled_sync_accounts}
                    />
                  ) : null}
                  {typeof lastImportResult.imported_tokens === "number" ? (
                    <>
                      <SiteMetric
                        label={tSite("import.importedTokens")}
                        value={lastImportResult.imported_tokens}
                      />
                      <SiteMetric
                        label={tSite("import.importedGroups")}
                        value={lastImportResult.imported_groups ?? 0}
                      />
                      <SiteMetric
                        label={tSite("import.importedModels")}
                        value={lastImportResult.imported_models ?? 0}
                      />
                      <SiteMetric
                        label={tSite("import.disabledModels")}
                        value={lastImportResult.disabled_models ?? 0}
                      />
                    </>
                  ) : null}
                </div>

                {lastImportResult.warnings.length > 0 ? (
                  <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <TriangleAlert className="size-4 text-muted-foreground" />
                      <span>{tSite("import.warnings")}</span>
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                      {lastImportResult.warnings.map((warning) => (
                        <div
                          key={warning}
                          className="break-all rounded-xl border border-border/60 bg-muted/20 px-3 py-2"
                        >
                          {warning}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setImportDialogOpen(false)}
            >
              {tSite("common.close")}
            </Button>
            <Button
              onClick={handleImportSites}
              disabled={importAllAPIHub.isPending || importMetAPI.isPending}
              className="rounded-xl"
            >
              <Upload
                className={cn(
                  "size-4",
                  importAllAPIHub.isPending || importMetAPI.isPending
                    ? "animate-pulse"
                    : "",
                )}
              />
              {importAllAPIHub.isPending || importMetAPI.isPending
                ? tSite("import.submitting")
                : tSite("import.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={archivedDialogOpen} onOpenChange={setArchivedDialogOpen}>
        <DialogContent className="flex h-[min(85vh,42rem)] max-w-3xl flex-col overflow-hidden rounded-3xl border-border/70 p-0 sm:max-w-3xl">
          <DialogHeader className="shrink-0 border-b border-border/60 px-6 py-4">
            <DialogTitle>{tSite("archived.title")}</DialogTitle>
            <DialogDescription>
              {tSite("archived.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {archivedLoading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {tSite("archived.loading")}
              </div>
            ) : archivedError ? (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                {tSite("archived.loadFailed", {
                  message: getSiteErrorMessage(locale, archivedError, t),
                })}
              </div>
            ) : !archivedSites || archivedSites.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {tSite("archived.empty")}
              </div>
            ) : (
              <div className="space-y-2">
                {archivedSites.map((site) => (
                  <div
                    key={site.id}
                    className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/60 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">
                          {site.name}
                        </span>
                        <Badge variant="outline" className="rounded-full text-xs">
                          {site.platform}
                        </Badge>
                        <span className="truncate text-xs text-muted-foreground">
                          {site.base_url}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {tSite("archived.archivedAt", {
                          time: site.archived_at
                            ? new Date(site.archived_at).toLocaleString()
                            : "-",
                        })}
                        {" · "}
                        {tSite("archived.accountsKept", {
                          count: site.accounts.length,
                        })}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-xl"
                      onClick={() => handleRestoreSite(site.id, site.name)}
                      disabled={restoreSite.isPending}
                    >
                      <ArchiveRestore className="size-4" />
                      {tSite("archived.restore")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter className="shrink-0 border-t border-border/60 px-6 py-4">
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setArchivedDialogOpen(false)}
            >
              {tSite("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteConfirm}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirm(null);
        }}
      >
        <DialogContent className="max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>
              {deleteConfirm?.type === "archive-site"
                ? tSite("confirm.archiveTitle")
                : tSite("confirm.deleteTitle")}
            </DialogTitle>
            <DialogDescription>
              {deleteConfirm?.type === "site"
                ? tSite("confirm.deleteSite", { name: deleteConfirm?.name })
                : deleteConfirm?.type === "archive-site"
                  ? tSite("confirm.archiveSite", { name: deleteConfirm?.name })
                  : deleteConfirm?.type === "batch-site"
                    ? tSite("confirm.deleteBatch", {
                        count: deleteConfirm?.name,
                      })
                    : tSite("confirm.deleteAccount", {
                        name: deleteConfirm?.name ?? "",
                      })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setDeleteConfirm(null)}
            >
              {tSite("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              className="rounded-xl"
              onClick={confirmDelete}
              disabled={
                deleteSite.isPending ||
                deleteSiteAccount.isPending ||
                archiveSite.isPending ||
                batchAction.isPending
              }
            >
              {deleteConfirm?.type === "archive-site"
                ? archiveSite.isPending
                  ? tSite("confirm.archiving")
                  : tSite("confirm.archiveConfirm")
                : deleteSite.isPending ||
                    deleteSiteAccount.isPending ||
                    batchAction.isPending
                  ? tSite("confirm.deleting")
                  : tSite("confirm.deleteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
