'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import {
    Check,
    CircleAlert,
    CircleOff,
    CirclePause,
    Eye,
    EyeOff,
    KeyRound,
    MoreHorizontal,
    Plus,
    Power,
    RefreshCw,
    Search,
    Settings,
    SlidersHorizontal,
    Waypoints,
} from 'lucide-react';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RewriteEditor } from '@/components/modules/rewrite/Editor';
import { toast } from '@/components/common/Toast';
import { cn } from '@/lib/utils';
import { useSettingStore } from '@/stores/setting';
import {
    type SiteChannelAccount,
    type SiteChannelGroup,
    type SiteModelDisableUpdateRequest,
    type SiteModelRouteType,
    type SiteModelRouteUpdateRequest,
    useAddSiteManualModels,
    useCreateSiteChannelKey,
    useDeleteSiteManualModel,
    useResetSiteChannelModelRoutes,
    useUpdateSiteChannelModelDisabled,
    useUpdateSiteChannelModelRoutes,
    useUpdateSiteGroupProjection,
    useUpdateSiteProjectedChannelSettings,
    useUpdateSiteSourceKeys,
} from '@/api/endpoints/site-channel';
import { useEnableSiteAccount } from '@/api/endpoints/site';
import { SITE_ROUTE_COLUMN_ORDER, isSupportedRouteType } from './constants';
import { translateSiteMessage } from '../site/site-message';
import {
    SITE_GROUP_FILTER_ALL,
    createGroupFilter,
    type SiteChannelGroupFilter,
    type SiteSourceKeyFormItem,
    type SiteModelView,
    buildSourceKeyFormItems,
    buildSourceKeyUpdatePayload,
    filterGroups,
    flattenAccountModels,
    getErrorMessage,
    hasSourceKeyChanges,
    isMaskedTokenValue,
    matchesMaskedToken,
    isSameGroupFilter,
    routeTypeLabel,
} from './utils';
import {
    DEFAULT_SITE_CHANNEL_PANEL_PREFERENCES,
    type SiteChannelQuickFilter,
    type SiteChannelTableSort,
    type SiteChannelTableSortField,
    useSiteChannelPanelViewStore,
} from './ui-store';
import {
    QUICK_FILTER_OPTIONS,
    SITE_GROUP_FILTER_ALL_VALUE,
    STALE_MODEL_SYNC_STATUSES,
    type SiteChannelPendingJump,
    addPendingKeys,
    getBaseGroupKey,
    getGroupStatusBadge,
    makeModelKey,
    matchesQuickFilters,
    removeKeys,
    removePendingKeys,
    sortModels,
} from './helpers';
import { type SiteChannelTableHandle, SiteChannelTableView } from './TableView';

export function SiteAccountPanel({
    siteId,
    account,
    accounts,
    activeAccountId,
    onSelectAccount,
    highlightedAccountId,
    registerAccountTabRef,
    jumpRequest,
    onJumpHandled,
    onNavigateToChannel,
}: {
    siteId: number;
    account: SiteChannelAccount;
    accounts: SiteChannelAccount[];
    activeAccountId: number | null;
    onSelectAccount: (accountId: number) => void;
    highlightedAccountId: number | null;
    registerAccountTabRef: (accountId: number, node: HTMLButtonElement | null) => void;
    jumpRequest: SiteChannelPendingJump | null;
    onJumpHandled: (requestId: number) => void;
    onNavigateToChannel: (channelId: number) => void;
}) {
    const t = useTranslations();
    const tSite = useTranslations('siteChannel');
    const locale = useSettingStore((state) => state.locale);
    const [activeFilter, setActiveFilter] = useState<SiteChannelGroupFilter>(SITE_GROUP_FILTER_ALL);
    const [pendingRouteOverrides, setPendingRouteOverrides] = useState<Record<string, SiteModelRouteType>>({});
    const [pendingDisabledOverrides, setPendingDisabledOverrides] = useState<Record<string, boolean>>({});
    const [pendingModelKeys, setPendingModelKeys] = useState<Set<string>>(new Set());
    const [selectedModelKeys, setSelectedModelKeys] = useState<Set<string>>(new Set());
    const [creatingGroup, setCreatingGroup] = useState<SiteChannelGroup | null>(null);
    const [editingProjectedGroup, setEditingProjectedGroup] = useState<SiteChannelGroup | null>(null);
    const [editingAdvancedGroup, setEditingAdvancedGroup] = useState<SiteChannelGroup | null>(null);
    const [selectedAdvancedChannelId, setSelectedAdvancedChannelId] = useState<number | null>(null);
    const [advancedForm, setAdvancedForm] = useState<Record<number, { param_override: string }>>({});
    const [addingManualGroup, setAddingManualGroup] = useState<SiteChannelGroup | null>(null);
    const [manualModelsInput, setManualModelsInput] = useState('');
    const [manualModelRouteType, setManualModelRouteType] = useState<SiteModelRouteType>('openai_chat');
    const [sourceKeyForm, setSourceKeyForm] = useState<SiteSourceKeyFormItem[]>([]);
    const [visibleSourceKeyRows, setVisibleSourceKeyRows] = useState<Record<string, boolean>>({});
    const [quickCreateName, setQuickCreateName] = useState('');
    const [highlightedModelKey, setHighlightedModelKey] = useState<string | null>(null);
    const [modelSearchTerm, setModelSearchTerm] = useState('');
    const [bulkMoveTarget, setBulkMoveTarget] = useState<SiteModelRouteType>('openai_chat');
    const [deletingManualModelKey, setDeletingManualModelKey] = useState<string | null>(null);
    const tableHandleRef = useRef<SiteChannelTableHandle | null>(null);
    const panelKey = `${siteId}:${account.account_id}`;

    const panelPreferences = useSiteChannelPanelViewStore(
        (state) => state.panels[panelKey] ?? DEFAULT_SITE_CHANNEL_PANEL_PREFERENCES,
    );
    const setCompactMode = useSiteChannelPanelViewStore((state) => state.setCompactMode);
    const setQuickFilters = useSiteChannelPanelViewStore((state) => state.setQuickFilters);
    const setTableSort = useSiteChannelPanelViewStore((state) => state.setTableSort);

    const createKeyMutation = useCreateSiteChannelKey(siteId, account.account_id);
    const sourceKeyMutation = useUpdateSiteSourceKeys(siteId, account.account_id);
    const advancedMutation = useUpdateSiteProjectedChannelSettings(siteId, account.account_id);
    const groupProjectionMutation = useUpdateSiteGroupProjection(siteId, account.account_id);
    const addManualModelsMutation = useAddSiteManualModels(siteId, account.account_id);
    const deleteManualModelMutation = useDeleteSiteManualModel(siteId, account.account_id);
    const routeMutation = useUpdateSiteChannelModelRoutes(siteId, account.account_id);
    const disabledMutation = useUpdateSiteChannelModelDisabled();
    const resetMutation = useResetSiteChannelModelRoutes(siteId, account.account_id);
    const enableSiteAccount = useEnableSiteAccount();

    const translateSiteError = useCallback(
        (error: unknown, fallback: string) => translateSiteMessage(locale, getErrorMessage(error, fallback), t),
        [locale, t],
    );

    const forcedModelKey =
        jumpRequest?.target.kind === 'site-channel-model' &&
        jumpRequest.target.siteId === siteId &&
        jumpRequest.target.accountId === account.account_id
            ? makeModelKey(getBaseGroupKey(jumpRequest.target.groupKey), jumpRequest.target.modelName)
            : null;

    const visibleGroups = useMemo(
        () => filterGroups(account.groups, activeFilter),
        [account.groups, activeFilter],
    );

    const scopedModels = useMemo(() => {
        return flattenAccountModels(account, activeFilter).map((model) => {
            const modelKey = makeModelKey(model.group_key, model.model_name);
            const nextRouteType = pendingRouteOverrides[modelKey];
            const nextDisabled = pendingDisabledOverrides[modelKey];

            return {
                ...model,
                route_type: nextRouteType ?? model.route_type,
                route_source: nextRouteType ? 'manual_override' : model.route_source,
                manual_override: nextRouteType ? true : model.manual_override,
                disabled: nextDisabled ?? model.disabled,
            };
        });
    }, [account, activeFilter, pendingRouteOverrides, pendingDisabledOverrides]);

    const filteredModels = useMemo(() => {
        const normalizedSearch = modelSearchTerm.trim().toLowerCase();

        return scopedModels.filter((model) => {
            const modelKey = makeModelKey(model.group_key, model.model_name);
            // Pin the jump target across the whole highlight window: forcedModelKey holds it
            // while jumpRequest is live, then highlightedModelKey keeps it pinned after the
            // request is cleared until the ring fades (~1.8s). Without this the row would be
            // dropped the instant onJumpHandled clears jumpRequest when an active search /
            // quick-filter excludes it, leaving the highlight on an unmounted row.
            if (forcedModelKey === modelKey || highlightedModelKey === modelKey) return true;

            const matchesSearch =
                !normalizedSearch ||
                model.model_name.toLowerCase().includes(normalizedSearch) ||
                (model.group_name || model.group_key).toLowerCase().includes(normalizedSearch);

            if (!matchesSearch) return false;

            return matchesQuickFilters(model, panelPreferences.quickFilters);
        });
    }, [scopedModels, modelSearchTerm, panelPreferences.quickFilters, forcedModelKey, highlightedModelKey]);

    const visibleModels = useMemo(
        () => sortModels(filteredModels, panelPreferences.tableSort, tSite),
        [filteredModels, panelPreferences.tableSort, tSite],
    );

    const visibleModelMap = useMemo(
        () =>
            new Map(
                visibleModels.map((model) => [makeModelKey(model.group_key, model.model_name), model] as const),
            ),
        [visibleModels],
    );

    // Scope key for the models list; changing filter / search / quick-filters tells the
    // virtualized table to scroll back to the top (see SiteChannelTableView resetKey).
    const modelsScopeKey = `${account.account_id}|${activeFilter.kind}|${activeFilter.kind === 'group' ? activeFilter.groupKey : ''}|${modelSearchTerm}|${panelPreferences.quickFilters.join(',')}`;

    const selectedModels = useMemo(
        () => Array.from(selectedModelKeys).map((key) => visibleModelMap.get(key)).filter((model): model is SiteModelView => !!model),
        [selectedModelKeys, visibleModelMap],
    );
    const hasPendingChanges = pendingModelKeys.size > 0 || routeMutation.isPending || disabledMutation.isPending || advancedMutation.isPending || addManualModelsMutation.isPending || deleteManualModelMutation.isPending;

    useEffect(() => {
        if (!jumpRequest || jumpRequest.target.kind !== 'site-channel-model') return;
        const target = jumpRequest.target;
        if (target.siteId !== siteId || target.accountId !== account.account_id) return;

        const targetGroupKey = getBaseGroupKey(target.groupKey);
        const targetFilter = createGroupFilter(targetGroupKey);
        if (!isSameGroupFilter(activeFilter, targetFilter)) {
            const frameId = window.requestAnimationFrame(() => {
                setActiveFilter(targetFilter);
            });
            return () => window.cancelAnimationFrame(frameId);
        }

        const modelKey = makeModelKey(targetGroupKey, target.modelName);

        const timer = window.setTimeout(() => {
            // forcedModelKey keeps the target in visibleModels even when it doesn't match
            // the active search / quick-filters, so the virtualizer can always find it.
            tableHandleRef.current?.scrollToModelKey(modelKey);
            setHighlightedModelKey(modelKey);
            window.setTimeout(() => {
                setHighlightedModelKey((current) => (current === modelKey ? null : current));
            }, 1800);
            onJumpHandled(jumpRequest.requestId);
        }, 80);

        return () => window.clearTimeout(timer);
    }, [jumpRequest, siteId, account.account_id, activeFilter, onJumpHandled]);

    const setSelectionForKeys = useCallback((modelKeys: string[], checked: boolean) => {
        if (modelKeys.length === 0) return;

        setSelectedModelKeys((current) => {
            const next = new Set(current);
            for (const modelKey of modelKeys) {
                if (checked) {
                    next.add(modelKey);
                } else {
                    next.delete(modelKey);
                }
            }
            return next;
        });
    }, []);

    const handleToggleModelSelection = useCallback((modelKey: string, checked: boolean) => {
        setSelectionForKeys([modelKey], checked);
    }, [setSelectionForKeys]);

    const handleToggleAllVisible = useCallback((checked: boolean) => {
        setSelectionForKeys(
            visibleModels.map((model) => makeModelKey(model.group_key, model.model_name)),
            checked,
        );
    }, [visibleModels, setSelectionForKeys]);

    const allVisibleSelected = useMemo(
        () =>
            visibleModels.length > 0 &&
            visibleModels.every((model) =>
                selectedModelKeys.has(makeModelKey(model.group_key, model.model_name)),
            ),
        [visibleModels, selectedModelKeys],
    );

    const applyRouteChange = useCallback((models: SiteModelView[], nextRouteType: SiteModelRouteType) => {
        const eligibleModels = models.filter((model) => {
            const modelKey = makeModelKey(model.group_key, model.model_name);
            return !pendingModelKeys.has(modelKey) && !model.disabled && model.route_type !== nextRouteType;
        });

        if (eligibleModels.length === 0) return;

        const modelKeys = eligibleModels.map((model) => makeModelKey(model.group_key, model.model_name));
        const payload: SiteModelRouteUpdateRequest[] = eligibleModels.map((model) => ({
            group_key: model.group_key,
            model_name: model.model_name,
            route_type: nextRouteType,
        }));

        setPendingRouteOverrides((current) => {
            const next = { ...current };
            for (const modelKey of modelKeys) {
                next[modelKey] = nextRouteType;
            }
            return next;
        });
        setPendingModelKeys((current) => addPendingKeys(current, modelKeys));

        routeMutation.mutate(payload, {
            onSuccess: () => {
                setPendingRouteOverrides((current) => removeKeys(current, modelKeys));
                toast.success(payload.length === 1 ? tSite('toast.routeUpdated') : tSite('toast.routeUpdatedBulk', { n: payload.length }));
            },
            onError: (error) => {
                setPendingRouteOverrides((current) => removeKeys(current, modelKeys));
                toast.error(translateSiteError(error, tSite('toast.routeUpdateFailed')));
            },
            onSettled: () => {
                setPendingModelKeys((current) => removePendingKeys(current, modelKeys));
            },
        });
    }, [pendingModelKeys, routeMutation, translateSiteError, tSite]);

    const applyDisabledChange = useCallback((models: SiteModelView[], nextDisabled: boolean) => {
        const eligibleModels = models.filter((model) => {
            const modelKey = makeModelKey(model.group_key, model.model_name);
            return !pendingModelKeys.has(modelKey) && model.disabled !== nextDisabled;
        });

        if (eligibleModels.length === 0) return;

        const modelKeys = eligibleModels.map((model) => makeModelKey(model.group_key, model.model_name));
        const payload: SiteModelDisableUpdateRequest[] = eligibleModels.map((model) => ({
            group_key: model.group_key,
            model_name: model.model_name,
            disabled: nextDisabled,
        }));

        setPendingDisabledOverrides((current) => {
            const next = { ...current };
            for (const modelKey of modelKeys) {
                next[modelKey] = nextDisabled;
            }
            return next;
        });
        setPendingModelKeys((current) => addPendingKeys(current, modelKeys));

        disabledMutation.mutate({ siteId, accountId: account.account_id, payload }, {
            onSuccess: () => {
                setPendingDisabledOverrides((current) => removeKeys(current, modelKeys));
                toast.success(payload.length === 1
                    ? (nextDisabled ? tSite('toast.modelDisabled') : tSite('toast.modelEnabled'))
                    : (nextDisabled
                        ? tSite('toast.modelsDisabledBulk', { n: payload.length })
                        : tSite('toast.modelsEnabledBulk', { n: payload.length })));
            },
            onError: (error) => {
                setPendingDisabledOverrides((current) => removeKeys(current, modelKeys));
                toast.error(translateSiteError(error, tSite('toast.disabledUpdateFailed')));
            },
            onSettled: () => {
                setPendingModelKeys((current) => removePendingKeys(current, modelKeys));
            },
        });
    }, [pendingModelKeys, disabledMutation, siteId, account.account_id, translateSiteError, tSite]);

    const handleOpenCreateKey = (group: SiteChannelGroup) => {
        setCreatingGroup(group);
        setQuickCreateName('');
    };

    const handleToggleGroupProjection = (group: SiteChannelGroup) => {
        const nextDisabled = !group.projection_disabled;
        groupProjectionMutation.mutate({
            group_key: group.group_key,
            projection_disabled: nextDisabled,
        }, {
            onSuccess: () => {
                toast.success(nextDisabled ? tSite('toast.projectionStopped') : tSite('toast.projectionResumed'));
            },
            onError: (error) => {
                toast.error(translateSiteError(error, tSite('toast.projectionUpdateFailed')));
            },
        });
    };

    const handleCloseCreateKey = () => {
        if (createKeyMutation.isPending) return;
        setCreatingGroup(null);
        setQuickCreateName('');
    };

    const handleCreateKey = () => {
        if (!creatingGroup) return;

        createKeyMutation.mutate(
            {
                group_key: creatingGroup.group_key,
                name: quickCreateName.trim() || undefined,
            },
            {
                onSuccess: () => {
                    toast.success(tSite('toast.keyCreated', { group: creatingGroup.group_name || creatingGroup.group_key }));
                    setCreatingGroup(null);
                    setQuickCreateName('');
                },
                onError: (error) => {
                    toast.error(translateSiteError(error, tSite('toast.keyCreateFailed')));
                },
            },
        );
    };

    const handleOpenProjectedKeys = (group: SiteChannelGroup) => {
        const items = buildSourceKeyFormItems(group);
        setEditingProjectedGroup(group);
        setSourceKeyForm(items);
        setVisibleSourceKeyRows({});
    };

    const handleCloseProjectedKeys = () => {
        if (sourceKeyMutation.isPending) return;
        setEditingProjectedGroup(null);
        setSourceKeyForm([]);
        setVisibleSourceKeyRows({});
    };

    const handleOpenAdvancedSettings = (group: SiteChannelGroup) => {
        const form: Record<number, { param_override: string }> = {};
        group.projected_channels.forEach((channel) => {
            form[channel.channel_id] = {
                param_override: channel.param_override ?? '',
            };
        });
        setEditingAdvancedGroup(group);
        setSelectedAdvancedChannelId(group.projected_channels[0]?.channel_id ?? null);
        setAdvancedForm(form);
    };

    const handleCloseAdvancedSettings = () => {
        if (advancedMutation.isPending) return;
        setEditingAdvancedGroup(null);
        setSelectedAdvancedChannelId(null);
        setAdvancedForm({});
    };

    const handleOpenAddManualModels = (group: SiteChannelGroup) => {
        setAddingManualGroup(group);
        setManualModelsInput('');
        setManualModelRouteType('openai_chat');
    };

    const handleCloseAddManualModels = () => {
        if (addManualModelsMutation.isPending) return;
        setAddingManualGroup(null);
        setManualModelsInput('');
    };

    const parseManualModelNames = () => Array.from(new Set(manualModelsInput
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean)));

    const handleAddManualModels = () => {
        if (!addingManualGroup) return;
        const names = parseManualModelNames();
        if (names.length === 0) {
            toast.error(tSite('toast.manualModelNameRequired'));
            return;
        }
        const existing = new Set(addingManualGroup.models.map((model) => model.model_name));
        const duplicated = names.filter((name) => existing.has(name));
        if (duplicated.length > 0) {
            toast.error(tSite('toast.manualModelDuplicated', { names: duplicated.join(', ') }));
            return;
        }
        addManualModelsMutation.mutate({
            group_key: addingManualGroup.group_key,
            models: names.map((name) => ({ model_name: name, route_type: manualModelRouteType })),
        }, {
            onSuccess: () => {
                toast.success(tSite('toast.manualModelsAdded', { n: names.length }));
                handleCloseAddManualModels();
            },
            onError: (error) => {
                toast.error(translateSiteError(error, tSite('toast.manualModelsAddFailed')));
            },
        });
    };

    const handleDeleteManualModel = (model: SiteModelView) => {
        if (model.source !== 'manual') return;
        const modelKey = makeModelKey(model.group_key, model.model_name);
        if (deletingManualModelKey === modelKey) return;
        setDeletingManualModelKey(modelKey);
        deleteManualModelMutation.mutate({ group_key: model.group_key, model_name: model.model_name }, {
            onSuccess: () => toast.success(tSite('toast.manualModelDeleted')),
            onError: (error) => toast.error(translateSiteError(error, tSite('toast.manualModelDeleteFailed'))),
            onSettled: () => setDeletingManualModelKey((current) => (current === modelKey ? null : current)),
        });
    };

    const handleAdvancedParamChange = (channelId: number, value: string) => {
        setAdvancedForm((current) => ({
            ...current,
            [channelId]: { ...(current[channelId] ?? { param_override: '' }), param_override: value },
        }));
    };

    const validateAdvancedSettings = () => {
        for (const item of Object.values(advancedForm)) {
            const value = item.param_override.trim();
            if (!value) continue;
            try {
                const parsed = JSON.parse(value) as unknown;
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    return false;
                }
            } catch {
                return false;
            }
        }
        return true;
    };

    const selectedAdvancedChannel = editingAdvancedGroup?.projected_channels.find((channel) => channel.channel_id === selectedAdvancedChannelId)
        ?? editingAdvancedGroup?.projected_channels[0]
        ?? null;

    const handleSaveAdvancedSettings = () => {
        if (!editingAdvancedGroup) return;
        if (!validateAdvancedSettings()) {
            toast.error(t('siteChannel.advanced.invalidParamOverride'));
            return;
        }
        const payload = editingAdvancedGroup.projected_channels.map((channel) => ({
            channel_id: channel.channel_id,
            auto_group: channel.auto_group,
            param_override: advancedForm[channel.channel_id]?.param_override?.trim() ?? '',
        }));
        advancedMutation.mutate(payload, {
            onSuccess: () => {
                toast.success(t('siteChannel.advanced.saved'));
                handleCloseAdvancedSettings();
            },
            onError: (error) => {
                toast.error(translateSiteError(error, t('siteChannel.advanced.saveFailed')));
            },
        });
    };

    const projectedKeyRowId = (item: SiteSourceKeyFormItem, index: number) => `${item.id ?? 'new'}-${index}`;

    const handleToggleProjectedKeyVisibility = (item: SiteSourceKeyFormItem, index: number) => {
        const rowId = projectedKeyRowId(item, index);
        setVisibleSourceKeyRows((current) => ({
            ...current,
            [rowId]: !current[rowId],
        }));
    };

    const handleProjectedKeyFieldChange = (index: number, patch: Partial<SiteSourceKeyFormItem>) => {
        setSourceKeyForm((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
    };

    const handleAddProjectedKeyRow = () => {
        setSourceKeyForm((current) => ([
            ...current,
            {
                enabled: true,
                token: '',
                is_new: true,
                name: '',
                value_status: 'ready',
            },
        ]));
    };

    const handleRemoveProjectedKeyRow = (index: number) => {
        setSourceKeyForm((current) => current.filter((_, itemIndex) => itemIndex !== index));
    };

    const handleSaveProjectedKeys = () => {
        if (!editingProjectedGroup) return;
        const originalById = new Map(editingProjectedGroup.source_keys.map((key) => [key.id, key] as const));
        for (const item of sourceKeyForm) {
            if (!item.id) continue;
            const original = originalById.get(item.id);
            if (!original) continue;
            if (original.value_status !== 'masked_pending') continue;
            const trimmed = item.token.trim();
            if (trimmed === (original.token ?? '').trim()) continue;
            if (!trimmed) continue;
            if (isMaskedTokenValue(trimmed)) {
                toast.error(tSite('toast.keyStillMasked', { id: item.id }));
                return;
            }
            if (!matchesMaskedToken(trimmed, original.token)) {
                toast.error(tSite('toast.keyMismatch', { id: item.id }));
                return;
            }
        }
        const payload = buildSourceKeyUpdatePayload(editingProjectedGroup.group_key, editingProjectedGroup.source_keys, sourceKeyForm);
        if (!payload.keys_to_add?.length && !payload.keys_to_update?.length && !payload.keys_to_delete?.length) {
            toast.error(tSite('toast.noKeyChanges'));
            return;
        }
        sourceKeyMutation.mutate(payload, {
            onSuccess: () => {
                toast.success(tSite('toast.sourceKeysUpdated', { group: editingProjectedGroup.group_name || editingProjectedGroup.group_key }));
                setEditingProjectedGroup(null);
                setSourceKeyForm([]);
                setVisibleSourceKeyRows({});
            },
            onError: (error) => {
                toast.error(translateSiteError(error, tSite('toast.sourceKeysUpdateFailed')));
            },
        });
    };

    const handleToggleDisabled = (model: SiteModelView) => {
        applyDisabledChange([model], !model.disabled);
    };

    const handleResetRoutes = () => {
        resetMutation.mutate(undefined, {
            onSuccess: () => {
                setPendingRouteOverrides({});
                toast.success(tSite('toast.routesReset'));
            },
            onError: (error) => {
                toast.error(translateSiteError(error, tSite('toast.routesResetFailed')));
            },
        });
    };

    const toggleQuickFilter = (filter: SiteChannelQuickFilter) => {
        const next = panelPreferences.quickFilters.includes(filter)
            ? panelPreferences.quickFilters.filter((item) => item !== filter)
            : QUICK_FILTER_OPTIONS.map((item) => item.key).filter((key) => key === filter || panelPreferences.quickFilters.includes(key));

        setQuickFilters(panelKey, next);
    };

    const handleSortChange = (field: SiteChannelTableSortField) => {
        const nextSort: SiteChannelTableSort = {
            field,
            order:
                panelPreferences.tableSort.field === field && panelPreferences.tableSort.order === 'asc'
                    ? 'desc'
                    : 'asc',
        };
        setTableSort(panelKey, nextSort);
    };

    const selectedVisibleCount = selectedModels.length;
    const activeGroupValue = activeFilter.kind === 'all' ? SITE_GROUP_FILTER_ALL_VALUE : activeFilter.groupKey;
    const activeGroup = activeFilter.kind === 'group'
        ? account.groups.find((group) => group.group_key === activeFilter.groupKey) ?? null
        : null;
    const activeGroupLabel = activeGroup ? (activeGroup.group_name || activeGroup.group_key) : tSite('panel.allGroups');
    const activeGroupProjectionSuspended = activeGroup?.projection_suspended === true;
    const activeGroupProjectionStale = activeGroup && !activeGroupProjectionSuspended && STALE_MODEL_SYNC_STATUSES.includes(activeGroup.model_sync_status);
    const activeGroupSuspensionReason = activeGroup?.projection_suspend_reason || activeGroup?.model_sync_message || '';
    const activeGroupStaleReason = activeGroup?.model_sync_message || '';
    const activeQuickFilterCount = panelPreferences.quickFilters.length;
    const pendingKeyGroups = useMemo(
        () => visibleGroups.filter((group) => !group.has_keys),
        [visibleGroups],
    );
    const projectedGroups = useMemo(
        () => visibleGroups.filter((group) => group.has_projected_channel),
        [visibleGroups],
    );
    const unsupportedRouteCount = useMemo(
        () => visibleModels.filter((model) => !isSupportedRouteType(model.route_type)).length,
        [visibleModels],
    );
    const hasModelResultFilters = modelSearchTerm.trim().length > 0 || panelPreferences.quickFilters.length > 0;

    const handleGroupFilterChange = useCallback((value: string) => {
        setActiveFilter(value === SITE_GROUP_FILTER_ALL_VALUE ? SITE_GROUP_FILTER_ALL : createGroupFilter(value));
    }, []);

    const handleClearQuickFilters = useCallback(() => {
        setQuickFilters(panelKey, []);
    }, [panelKey, setQuickFilters]);

    const handleFocusAttention = useCallback(() => {
        if (panelPreferences.quickFilters.includes('attention')) return;
        const next = QUICK_FILTER_OPTIONS
            .map((item) => item.key)
            .filter((key) => key === 'attention' || panelPreferences.quickFilters.includes(key));
        setQuickFilters(panelKey, next);
    }, [panelKey, panelPreferences.quickFilters, setQuickFilters]);

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5">
            <div className="flex flex-none flex-col gap-2 rounded-2xl border border-border/70 bg-card/70 p-2.5">
                {accounts.length >= 2 ? (
                    <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-2">
                        <div className="-mb-px max-w-full overflow-x-auto">
                            <div className="flex min-w-max items-baseline gap-5 px-0.5 pb-1">
                                {accounts.map((acc) => {
                                    const isActive = acc.account_id === activeAccountId;
                                    return (
                                        <button
                                            key={acc.account_id}
                                            ref={(node) => registerAccountTabRef(acc.account_id, node)}
                                            type="button"
                                            onClick={() => onSelectAccount(acc.account_id)}
                                            className={cn(
                                                'relative inline-flex items-baseline gap-1.5 pb-1 text-sm font-medium transition-colors',
                                                isActive
                                                    ? 'text-foreground'
                                                    : 'text-muted-foreground hover:text-foreground',
                                                highlightedAccountId === acc.account_id &&
                                                    'rounded-md ring-2 ring-primary/35 ring-offset-2 ring-offset-background',
                                            )}
                                        >
                                            <span className="truncate">{acc.account_name}</span>
                                            <span
                                                className={cn(
                                                    'size-1.5 shrink-0 rounded-full',
                                                    acc.enabled ? 'bg-success' : 'bg-destructive',
                                                )}
                                                aria-hidden
                                            />
                                            {isActive && (
                                                <motion.span
                                                    layoutId="site-account-tab-underline"
                                                    className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-primary"
                                                    transition={{ type: 'spring', stiffness: 320, damping: 30, mass: 0.8 }}
                                                />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={() =>
                                enableSiteAccount.mutate({
                                    id: account.account_id,
                                    enabled: !account.enabled,
                                })
                            }
                            disabled={enableSiteAccount.isPending}
                            className={cn(
                                'inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2.5 text-2xs font-medium transition hover:opacity-80 md:h-7 md:min-h-0',
                                account.enabled
                                    ? 'border-success/30 bg-success/10 text-success'
                                    : 'border-destructive/30 bg-destructive/10 text-destructive',
                            )}
                        >
                            <Power className={cn('size-3', enableSiteAccount.isPending && 'animate-spin')} />
                            {account.enabled ? tSite('badge.accountEnabled') : tSite('badge.accountDisabled')}
                        </button>
                    </div>
                ) : null}

                <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                    <div className="flex flex-1 flex-col gap-2 md:flex-row md:items-center">
                        <Select value={activeGroupValue} onValueChange={handleGroupFilterChange}>
                            <SelectTrigger className="h-11 w-full rounded-2xl border-border/70 bg-background/80 md:h-8 md:w-[18rem]">
                                <div className="flex min-w-0 items-center gap-2">
                                    <span className="text-xs text-muted-foreground">{tSite('panel.groupLabel')}</span>
                                    <span className="truncate text-sm font-medium">{activeGroupLabel}</span>
                                </div>
                            </SelectTrigger>
                            <SelectContent align="start" className="rounded-2xl border border-border/70 bg-card">
                                <SelectItem value={SITE_GROUP_FILTER_ALL_VALUE} className="rounded-xl py-2">
                                    <div className="flex w-full min-w-0 items-center justify-between gap-3">
                                        <span className="truncate">{tSite('panel.allGroups')}</span>
                                        <span className="text-2xs text-muted-foreground">{tSite('panel.groupCount', { n: account.groups.length })}</span>
                                    </div>
                                </SelectItem>
                                {account.groups.map((group) => (
                                    <SelectItem key={group.group_key} value={group.group_key} className="rounded-xl py-2">
                                        <div className="flex w-full min-w-0 items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="truncate">{group.group_name || group.group_key}</div>
                                                <div className="text-2xs text-muted-foreground">
                                                    {tSite('panel.groupModelSummary', { models: group.models.length, enabled: group.enabled_key_count, total: group.key_count })}
                                                    {group.projection_disabled ? tSite('panel.groupTagNoProjection') : ''}
                                                    {group.projection_suspended ? tSite('panel.groupTagSuspended') : STALE_MODEL_SYNC_STATUSES.includes(group.model_sync_status) ? tSite('panel.groupTagStale') : ''}
                                                    {group.masked_pending_key_count > 0 ? tSite('panel.groupTagMaskedPending', { n: group.masked_pending_key_count }) : ''}
                                                    {group.has_projected_channel ? tSite('panel.groupTagProjected', { n: group.projected_keys.length }) : ''}
                                                </div>
                                            </div>
                                            {(() => {
                                                const statusBadge = getGroupStatusBadge(group, tSite);
                                                return statusBadge ? (
                                                    <span className={statusBadge.className}>{statusBadge.label}</span>
                                                ) : null;
                                            })()}
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <div className="relative min-w-0 flex-1">
                            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={modelSearchTerm}
                                onChange={(event) => setModelSearchTerm(event.target.value)}
                                placeholder={tSite('panel.searchPlaceholder')}
                                className="h-11 rounded-2xl pl-9 md:h-8"
                            />
                        </div>
                    </div>

                    {activeGroupProjectionSuspended ? (
                        <div className="flex items-start gap-2 rounded-2xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                            <CircleAlert className="mt-0.5 size-4 shrink-0" />
                            <div className="min-w-0">
                                <div className="font-medium">{tSite('panel.suspendedTitle')}</div>
                                <div className="mt-0.5 break-words text-destructive/80">
                                    {activeGroupSuspensionReason || tSite('panel.suspendedFallback')}
                                </div>
                            </div>
                        </div>
                    ) : activeGroupProjectionStale ? (
                        <div className="flex items-start gap-2 rounded-2xl border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning">
                            <CircleAlert className="mt-0.5 size-4 shrink-0" />
                            <div className="min-w-0">
                                <div className="font-medium">{tSite('panel.staleTitle')}</div>
                                <div className="mt-0.5 break-words text-warning/80">
                                    {activeGroupStaleReason || tSite('panel.staleFallback')}
                                </div>
                            </div>
                        </div>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            className="min-h-10 rounded-2xl px-3 md:h-8 md:min-h-0"
                            onClick={() => activeGroup && handleOpenAddManualModels(activeGroup)}
                            disabled={!activeGroup}
                            title={activeGroup ? undefined : tSite('panel.selectGroupFirst')}
                        >
                            <Plus className="size-4" />
                            {tSite('panel.addModel')}
                        </Button>

                        <Button
                            type="button"
                            variant="outline"
                            className={cn(
                                'min-h-10 rounded-2xl px-3 md:h-8 md:min-h-0',
                                activeGroup?.projection_disabled && 'border-warning/30 bg-warning/10 text-warning hover:bg-warning/15',
                                activeGroupProjectionSuspended && 'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15',
                            )}
                            onClick={() => activeGroup && handleToggleGroupProjection(activeGroup)}
                            disabled={!activeGroup || activeGroupProjectionSuspended || groupProjectionMutation.isPending}
                            title={!activeGroup
                                ? tSite('panel.selectGroupFirst')
                                : activeGroupProjectionSuspended
                                    ? tSite('panel.projectionSuspendedTitle', { reason: activeGroupSuspensionReason || tSite('panel.projectionSuspendedReasonFallback') })
                                    : activeGroup.projection_disabled
                                        ? tSite('panel.projectionResumeTitle')
                                        : tSite('panel.projectionStopTitle')}
                        >
                            {activeGroupProjectionSuspended ? <CirclePause className="size-4" /> : <Waypoints className={cn('size-4', groupProjectionMutation.isPending && 'animate-spin')} />}
                            {activeGroupProjectionSuspended ? tSite('panel.projectionSuspended') : activeGroup?.projection_disabled ? tSite('panel.projectionDisabled') : tSite('panel.projection')}
                        </Button>

                        <Popover>
                            <PopoverTrigger asChild>
                                <Button type="button" variant="outline" className="min-h-10 rounded-2xl px-3 md:h-8 md:min-h-0">
                                    <SlidersHorizontal className="size-4" />
                                    {activeQuickFilterCount > 0 ? tSite('filters.buttonWithCount', { n: activeQuickFilterCount }) : tSite('filters.button')}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-60 rounded-2xl border border-border/70 bg-card p-3 shadow-xl">
                                <div className="space-y-3">
                                    <div className="text-xs font-medium text-muted-foreground">{tSite('filters.quickTitle')}</div>
                                    <div className="grid gap-2">
                                        {QUICK_FILTER_OPTIONS.map((option) => {
                                            const active = panelPreferences.quickFilters.includes(option.key);
                                            return (
                                                <button
                                                    key={option.key}
                                                    type="button"
                                                    onClick={() => toggleQuickFilter(option.key)}
                                                    className={cn(
                                                        'flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition',
                                                        active
                                                            ? 'border-primary/30 bg-primary/10 text-foreground'
                                                            : 'border-border bg-background hover:bg-muted/60',
                                                    )}
                                                >
                                                    <span>{tSite(option.labelKey)}</span>
                                                    {active ? <Check className="size-4 text-primary" /> : null}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {activeQuickFilterCount > 0 ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 rounded-xl px-2"
                                            onClick={handleClearQuickFilters}
                                        >
                                            {tSite('filters.clear')}
                                        </Button>
                                    ) : null}
                                </div>
                            </PopoverContent>
                        </Popover>

                        <Button
                            type="button"
                            variant="outline"
                            className="min-h-10 rounded-2xl px-3 md:h-8 md:min-h-0"
                            onClick={() => activeGroup && handleOpenAdvancedSettings(activeGroup)}
                            disabled={!activeGroup || activeGroup.projected_channels.length === 0}
                            title={!activeGroup ? tSite('panel.selectGroupFirst') : activeGroup.projected_channels.length === 0 ? tSite('panel.noProjectedChannel') : undefined}
                        >
                            <Settings className="size-4" />
                            {tSite('panel.advanced')}
                        </Button>

                        <Popover>
                            <PopoverTrigger asChild>
                                <Button type="button" variant="outline" className="min-h-10 rounded-2xl px-3 md:h-8 md:min-h-0">
                                    <MoreHorizontal className="size-4" />
                                    {tSite('panel.more')}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-64 rounded-2xl border border-border/70 bg-card p-2 shadow-xl">
                                <div className="space-y-1">
                                    <button
                                        type="button"
                                        onClick={() => setCompactMode(panelKey, !panelPreferences.compactMode)}
                                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition hover:bg-muted/60"
                                    >
                                        <div>
                                            <div className="text-sm font-medium text-foreground">{tSite('panel.compactMode')}</div>
                                            <div className="text-2xs text-muted-foreground">{tSite('panel.compactModeHint')}</div>
                                        </div>
                                        {panelPreferences.compactMode ? <Check className="size-4 text-primary" /> : null}
                                    </button>
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="mt-2 h-8 w-full justify-start rounded-xl px-3"
                                    onClick={handleResetRoutes}
                                    disabled={resetMutation.isPending || hasPendingChanges}
                                >
                                    <RefreshCw className={cn('size-4', resetMutation.isPending && 'animate-spin')} />
                                    {resetMutation.isPending ? tSite('panel.resettingRoutes') : tSite('panel.resetRoutes')}
                                </Button>
                            </PopoverContent>
                        </Popover>
                    </div>
                </div>

                {pendingKeyGroups.length > 0 || projectedGroups.length > 0 || unsupportedRouteCount > 0 || selectedVisibleCount > 0 ? (
                    <div className="flex min-h-8 flex-wrap items-center gap-2">
                        {pendingKeyGroups.length > 0 ? (
                            <Popover>
                                <PopoverTrigger asChild>
                                    <button
                                        type="button"
                                        className="inline-flex h-8 items-center gap-2 rounded-full border border-warning/30 bg-warning/10 px-3 text-xs font-medium text-warning transition hover:bg-warning/15"
                                    >
                                        <CircleAlert className="size-3.5" />
                                        {tSite('panel.pendingKeyGroups', { n: pendingKeyGroups.length })}
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent align="start" className="w-72 rounded-2xl border border-warning/30 bg-card p-3 shadow-xl">
                                    <div className="space-y-2">
                                        <div className="text-xs font-medium text-muted-foreground">{tSite('panel.pendingKeyGroupsTitle')}</div>
                                        <div className="flex flex-wrap gap-2">
                                            {pendingKeyGroups.map((group) => (
                                                <Button
                                                    key={group.group_key}
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="rounded-full border-warning/30 bg-card/60 text-warning hover:bg-card"
                                                    onClick={() => handleOpenCreateKey(group)}
                                                    disabled={createKeyMutation.isPending}
                                                >
                                                    {group.group_name || group.group_key}
                                                    <span className="text-3xs text-warning/80">
                                                        {createKeyMutation.isPending && creatingGroup?.group_key === group.group_key ? tSite('panel.creatingKey') : tSite('panel.quickCreate')}
                                                    </span>
                                                </Button>
                                            ))}
                                        </div>
                                    </div>
                                </PopoverContent>
                            </Popover>
                        ) : null}

                        {visibleGroups.some((group) => group.masked_pending_key_count > 0 && group.enabled_key_count === 0) ? (
                            <button
                                type="button"
                                onClick={handleFocusAttention}
                                className="inline-flex h-8 items-center gap-2 rounded-full border border-warning/30 bg-warning/10 px-3 text-xs font-medium text-warning transition hover:bg-warning/15"
                            >
                                <CircleAlert className="size-3.5" />
                                {tSite('panel.maskedPendingAlert')}
                            </button>
                        ) : null}

                        {projectedGroups.length > 0 ? (
                            <Popover>
                                <PopoverTrigger asChild>
                                    <button
                                        type="button"
                                        className="inline-flex h-8 items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 text-xs font-medium text-foreground transition hover:bg-muted/60"
                                    >
                                        <KeyRound className="size-3.5 text-primary" />
                                        {tSite('panel.projectedKeyGroups', { n: projectedGroups.length })}
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent align="start" className="w-72 rounded-2xl border border-border/70 bg-card p-3 shadow-xl">
                                    <div className="space-y-2">
                                        <div className="text-xs font-medium text-muted-foreground">{tSite('panel.projectedKeyGroupsTitle')}</div>
                                        <div className="flex flex-wrap gap-2">
                                            {projectedGroups.map((group) => (
                                                <Button
                                                    key={`projected-${group.group_key}`}
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="rounded-full"
                                                    onClick={() => handleOpenProjectedKeys(group)}
                                                >
                                                    {group.group_name || group.group_key}
                                                    <span className="text-3xs text-muted-foreground">{group.projected_keys.length} Keys</span>
                                                </Button>
                                            ))}
                                        </div>
                                    </div>
                                </PopoverContent>
                            </Popover>
                        ) : null}

                        {unsupportedRouteCount > 0 ? (
                            <button
                                type="button"
                                onClick={handleFocusAttention}
                                className="inline-flex h-8 items-center gap-2 rounded-full border border-warning/30 bg-warning/10 px-3 text-xs font-medium text-warning transition hover:bg-warning/15"
                            >
                                <CircleAlert className="size-3.5" />
                                {tSite('panel.unsupportedRoute', { n: unsupportedRouteCount })}
                            </button>
                        ) : null}

                        {selectedVisibleCount > 0 ? (
                            <div className="flex w-full flex-wrap items-center gap-2 md:ml-auto md:w-auto">
                                <span className="text-xs font-medium text-foreground">{tSite('panel.selectedCount', { n: selectedVisibleCount })}</span>
                                <Select value={bulkMoveTarget} onValueChange={(value) => setBulkMoveTarget(value as SiteModelRouteType)}>
                                    <SelectTrigger className="h-10 min-w-0 flex-1 rounded-xl text-base md:h-7 md:w-[10rem] md:flex-none md:text-xs">
                                        <SelectValue placeholder={tSite('panel.targetRoutePlaceholder')} />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl">
                                        {SITE_ROUTE_COLUMN_ORDER.map((routeType) => (
                                            <SelectItem key={routeType} value={routeType}>
                                                {routeTypeLabel(routeType, tSite)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Button type="button" size="sm" className="min-h-10 rounded-xl px-3 text-xs md:h-7 md:min-h-0 md:px-2" onClick={() => applyRouteChange(selectedModels, bulkMoveTarget)} disabled={hasPendingChanges}>
                                    {tSite('panel.bulkMove')}
                                </Button>
                                <Button type="button" variant="outline" size="sm" className="min-h-10 rounded-xl px-3 text-xs md:h-7 md:min-h-0 md:px-2" onClick={() => applyDisabledChange(selectedModels, false)} disabled={hasPendingChanges}>
                                    {tSite('panel.bulkEnable')}
                                </Button>
                                <Button type="button" variant="outline" size="sm" className="min-h-10 rounded-xl px-3 text-xs md:h-7 md:min-h-0 md:px-2" onClick={() => applyDisabledChange(selectedModels, true)} disabled={hasPendingChanges}>
                                    {tSite('panel.bulkDisable')}
                                </Button>
                                <Button type="button" variant="ghost" size="sm" className="min-h-10 rounded-xl px-3 text-xs md:h-7 md:min-h-0 md:px-2" onClick={() => setSelectedModelKeys(new Set())}>
                                    {tSite('panel.bulkClear')}
                                </Button>
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>

            <Dialog open={!!creatingGroup} onOpenChange={(open) => !open && handleCloseCreateKey()}>
                <DialogContent className="rounded-3xl sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-semibold">{tSite('dialog.quickCreateKey.title')}</DialogTitle>
                        <DialogDescription>
                            {tSite('dialog.quickCreateKey.description', {
                                group: creatingGroup?.group_name || creatingGroup?.group_key || '-',
                                account: account.account_name,
                            })}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="rounded-2xl border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                            {tSite('dialog.quickCreateKey.groupKeyLabel')}<span className="font-medium text-foreground">{creatingGroup?.group_key || '-'}</span>
                        </div>

                        <label className="grid gap-1.5 text-xs text-muted-foreground">
                            {tSite('dialog.quickCreateKey.nameLabel')}
                            <Input
                                value={quickCreateName}
                                onChange={(event) => setQuickCreateName(event.target.value)}
                                placeholder={tSite('dialog.quickCreateKey.namePlaceholder')}
                                disabled={createKeyMutation.isPending}
                                className="h-10 rounded-2xl"
                            />
                        </label>
                    </div>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            className="rounded-2xl"
                            onClick={handleCloseCreateKey}
                            disabled={createKeyMutation.isPending}
                        >
                            {tSite('dialog.cancel')}
                        </Button>
                        <Button
                            type="button"
                            className="rounded-2xl"
                            onClick={handleCreateKey}
                            disabled={createKeyMutation.isPending || !creatingGroup}
                        >
                            <RefreshCw className={cn('size-4', createKeyMutation.isPending && 'animate-spin')} />
                            {createKeyMutation.isPending ? tSite('dialog.quickCreateKey.creating') : tSite('dialog.quickCreateKey.submit')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!editingAdvancedGroup} onOpenChange={(open) => !open && handleCloseAdvancedSettings()}>
                <DialogContent className="max-h-[85vh] overflow-y-auto rounded-3xl sm:max-w-4xl">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-semibold">{t('siteChannel.advanced.title')}</DialogTitle>
                        <DialogDescription>
                            {t('siteChannel.advanced.description', { group: editingAdvancedGroup?.group_name || editingAdvancedGroup?.group_key || '-' })}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
                            <div className="space-y-2">
                                <div className="px-1 text-xs font-medium text-muted-foreground">{t('siteChannel.advanced.channelList')}</div>
                                <div className="space-y-2">
                                    {editingAdvancedGroup?.projected_channels.map((channel) => {
                                        const active = selectedAdvancedChannel?.channel_id === channel.channel_id;
                                        return (
                                            <button
                                                key={channel.channel_id}
                                                type="button"
                                                onClick={() => setSelectedAdvancedChannelId(channel.channel_id)}
                                                className={cn(
                                                    'flex w-full items-center justify-between gap-3 rounded-2xl border px-3 py-3 text-left transition',
                                                    active
                                                        ? 'border-primary/30 bg-primary/10 text-foreground'
                                                        : 'border-border/60 bg-muted/10 hover:bg-muted/40',
                                                )}
                                            >
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-medium">{routeTypeLabel(channel.route_type, tSite)}</div>
                                                    <div className="mt-0.5 truncate text-xs text-muted-foreground">#{channel.channel_id}</div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {selectedAdvancedChannel ? (() => {
                                const channel = selectedAdvancedChannel;
                                const form = advancedForm[channel.channel_id] ?? { param_override: channel.param_override ?? '' };
                                return (
                                    <div className="space-y-4 rounded-2xl border border-border/60 bg-muted/10 p-4">
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="text-sm font-medium text-foreground">{routeTypeLabel(channel.route_type, tSite)}</div>
                                                <div className="mt-1 truncate text-xs text-muted-foreground">#{channel.channel_id} · {channel.channel_name}</div>
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <div className="grid gap-2 text-sm">
                                                <span className="font-medium">{t('siteChannel.advanced.paramOverride')}</span>
                                                <RewriteEditor
                                                    value={form.param_override}
                                                    onChange={(next) => handleAdvancedParamChange(channel.channel_id, next)}
                                                    scope="channel"
                                                    channelId={channel.channel_id}
                                                    compact
                                                />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })() : (
                                <div className="flex min-h-48 items-center justify-center rounded-2xl border border-dashed border-border/70 bg-muted/10 text-sm text-muted-foreground">
                                    {t('siteChannel.advanced.empty')}
                                </div>
                            )}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" className="rounded-xl" onClick={handleCloseAdvancedSettings} disabled={advancedMutation.isPending}>{t('siteChannel.advanced.cancel')}</Button>
                        <Button type="button" className="rounded-xl" onClick={handleSaveAdvancedSettings} disabled={advancedMutation.isPending || !editingAdvancedGroup}>
                            {advancedMutation.isPending ? t('siteChannel.advanced.saving') : t('siteChannel.advanced.save')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!addingManualGroup} onOpenChange={(open) => !open && handleCloseAddManualModels()}>
                <DialogContent className="max-h-[85vh] overflow-y-auto rounded-3xl sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-semibold">
                            {tSite('dialog.addManualModels.title')}
                        </DialogTitle>
                        <DialogDescription>
                            {tSite('dialog.addManualModels.description', { group: addingManualGroup?.group_name || addingManualGroup?.group_key || '-' })}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <label className="grid gap-1.5 text-xs text-muted-foreground">
                            {tSite('dialog.addManualModels.namesLabel')}
                            <textarea
                                value={manualModelsInput}
                                onChange={(event) => setManualModelsInput(event.target.value)}
                                placeholder={"gpt-4o\ngpt-4.1-mini"}
                                className="min-h-36 rounded-xl border border-border bg-background px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
                            />
                        </label>
                        <label className="grid gap-1.5 text-xs text-muted-foreground">
                            {tSite('dialog.addManualModels.routeTypeLabel')}
                            <Select value={manualModelRouteType} onValueChange={(value) => setManualModelRouteType(value as SiteModelRouteType)}>
                                <SelectTrigger className="h-10 w-full rounded-xl bg-background"><SelectValue /></SelectTrigger>
                                <SelectContent className="rounded-xl">
                                    {SITE_ROUTE_COLUMN_ORDER.map((routeType) => (
                                        <SelectItem key={routeType} value={routeType}>{routeTypeLabel(routeType, tSite)}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </label>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" className="rounded-xl" onClick={handleCloseAddManualModels} disabled={addManualModelsMutation.isPending}>{tSite('dialog.cancel')}</Button>
                        <Button type="button" className="rounded-xl" onClick={handleAddManualModels} disabled={addManualModelsMutation.isPending || !addingManualGroup}>
                            {addManualModelsMutation.isPending ? tSite('dialog.addManualModels.submitting') : tSite('dialog.addManualModels.submit')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!editingProjectedGroup} onOpenChange={(open) => !open && handleCloseProjectedKeys()}>
                <DialogContent className="flex h-[min(85vh,42rem)] max-w-3xl flex-col overflow-hidden rounded-3xl border-border/70 p-0 sm:max-w-3xl">
                    <DialogHeader className="shrink-0 border-b border-border/60 px-6 py-4">
                        <DialogTitle className="text-lg font-semibold">{tSite('dialog.projectedKeys.title')}</DialogTitle>
                        <DialogDescription>
                            {tSite('dialog.projectedKeys.description', { group: editingProjectedGroup?.group_name || editingProjectedGroup?.group_key || '-' })}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-6 py-4">
                        <div className="rounded-2xl border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground shrink-0">
                            {tSite('dialog.projectedKeys.projectedChannels', { channels: editingProjectedGroup?.projected_channel_ids.join(', ') || '-' })}
                        </div>

                        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                            {sourceKeyForm.map((item, index) => (
                                <div key={projectedKeyRowId(item, index)} className="rounded-2xl border border-border/70 bg-background/80 p-3">
                                    {(() => {
                                        const rowId = projectedKeyRowId(item, index);
                                        const isVisible = item.is_new || Boolean(visibleSourceKeyRows[rowId]);

                                        return (
                                            <>
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="text-xs text-muted-foreground">
                                            {item.id ? tSite('dialog.projectedKeys.existingKey', { id: item.id }) : tSite('dialog.projectedKeys.newKey')}
                                            {item.value_status === 'masked_pending' ? tSite('dialog.projectedKeys.pendingSuffix') : ''}
                                        </div>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="rounded-xl"
                                            onClick={() => handleRemoveProjectedKeyRow(index)}
                                            disabled={sourceKeyMutation.isPending}
                                        >
                                            {tSite('dialog.projectedKeys.remove')}
                                        </Button>
                                    </div>
                                    <div className="mt-3 grid gap-3 md:grid-cols-[auto,1fr,12rem]">
                                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <input
                                                type="checkbox"
                                                checked={item.enabled}
                                                disabled={sourceKeyMutation.isPending}
                                                onChange={(event) => handleProjectedKeyFieldChange(index, { enabled: event.target.checked })}
                                                className="size-4 rounded border-border bg-background align-middle accent-primary"
                                            />
                                            {tSite('dialog.projectedKeys.enabled')}
                                        </label>
                                        <label className="grid gap-1.5 text-xs text-muted-foreground">
                                            Key
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    type={isVisible ? 'text' : 'password'}
                                                    value={item.token}
                                                    onChange={(event) => handleProjectedKeyFieldChange(index, { token: event.target.value })}
                                                    placeholder={item.id ? tSite('dialog.projectedKeys.tokenPlaceholderExisting') : tSite('dialog.projectedKeys.tokenPlaceholderNew')}
                                                    disabled={sourceKeyMutation.isPending}
                                                    className="h-10 rounded-2xl"
                                                />
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="icon"
                                                    className="size-10 rounded-2xl shrink-0"
                                                    onClick={() => handleToggleProjectedKeyVisibility(item, index)}
                                                    disabled={sourceKeyMutation.isPending}
                                                    aria-label={isVisible ? tSite('dialog.projectedKeys.hideToken') : tSite('dialog.projectedKeys.showToken')}
                                                    title={isVisible ? tSite('dialog.projectedKeys.hideToken') : tSite('dialog.projectedKeys.showToken')}
                                                >
                                                    {isVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                                                </Button>
                                            </div>
                                            {!isVisible && item.token_masked ? (
                                                <span className="text-2xs text-muted-foreground">{tSite('dialog.projectedKeys.currentValue', { value: item.token_masked })}</span>
                                            ) : null}
                                        </label>
                                        <label className="grid gap-1.5 text-xs text-muted-foreground">
                                            {tSite('dialog.projectedKeys.nameLabel')}
                                            <Input
                                                value={item.name}
                                                onChange={(event) => handleProjectedKeyFieldChange(index, { name: event.target.value })}
                                                placeholder={tSite('dialog.projectedKeys.namePlaceholder')}
                                                disabled={sourceKeyMutation.isPending}
                                                className="h-10 rounded-2xl"
                                            />
                                        </label>
                                    </div>
                                    {item.last_sync_at ? (
                                        <div className="mt-2 text-2xs text-muted-foreground">
                                            {tSite('dialog.projectedKeys.lastSync', { time: new Date(item.last_sync_at).toLocaleString() })}
                                        </div>
                                    ) : null}
                                            </>
                                        );
                                    })()}
                                </div>
                            ))}
                        </div>

                        <Button
                            type="button"
                            variant="outline"
                            className="rounded-2xl shrink-0"
                            onClick={handleAddProjectedKeyRow}
                            disabled={sourceKeyMutation.isPending}
                        >
                            {tSite('dialog.projectedKeys.addRow')}
                        </Button>
                    </div>

                    <DialogFooter className="shrink-0 border-t border-border/60 px-6 py-4">
                        <Button
                            type="button"
                            variant="outline"
                            className="rounded-2xl"
                            onClick={handleCloseProjectedKeys}
                            disabled={sourceKeyMutation.isPending}
                        >
                            {tSite('dialog.cancel')}
                        </Button>
                        <Button
                            type="button"
                            className="rounded-2xl"
                            onClick={handleSaveProjectedKeys}
                            disabled={sourceKeyMutation.isPending || !editingProjectedGroup || !hasSourceKeyChanges(editingProjectedGroup.source_keys, sourceKeyForm)}
                        >
                            <RefreshCw className={cn('size-4', sourceKeyMutation.isPending && 'animate-spin')} />
                            {sourceKeyMutation.isPending ? tSite('dialog.projectedKeys.saving') : tSite('dialog.projectedKeys.submit')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {visibleModels.length === 0 ? (
                <div
                    role="status"
                    className="flex min-h-[18rem] flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-border/70 bg-muted/20 px-6 text-center"
                >
                    {hasModelResultFilters ? (
                        <Search className="size-9 text-muted-foreground/60" />
                    ) : (
                        <CircleOff className="size-9 text-muted-foreground/60" />
                    )}
                    <p className="mt-3 text-sm font-medium text-foreground">
                        {hasModelResultFilters
                            ? t('siteChannel.empty.models.noMatchTitle')
                            : activeFilter.kind === 'group'
                                ? t('siteChannel.empty.models.groupTitle')
                                : t('siteChannel.empty.models.accountTitle')}
                    </p>
                    <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                        {hasModelResultFilters
                            ? t('siteChannel.empty.models.noMatchDescription')
                            : t('siteChannel.empty.models.dataDescription')}
                    </p>
                    {hasModelResultFilters ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-4 rounded-xl"
                            onClick={() => {
                                setModelSearchTerm('');
                                handleClearQuickFilters();
                            }}
                        >
                            {t('siteChannel.empty.models.clear')}
                        </Button>
                    ) : null}
                </div>
            ) : (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-border/70 bg-card/70">
                    <SiteChannelTableView
                        ref={tableHandleRef}
                        models={visibleModels}
                        resetKey={modelsScopeKey}
                        allVisibleSelected={allVisibleSelected}
                        pendingModelKeys={pendingModelKeys}
                        selectedModelKeys={selectedModelKeys}
                        compactMode={panelPreferences.compactMode}
                        tableSort={panelPreferences.tableSort}
                        highlightedModelKey={highlightedModelKey}
                        onToggleModelSelection={handleToggleModelSelection}
                        onToggleAllVisible={handleToggleAllVisible}
                        onSortChange={handleSortChange}
                        onMoveModel={(model, nextRouteType) => applyRouteChange([model], nextRouteType)}
                        onToggleDisabled={handleToggleDisabled}
                        onDeleteManualModel={handleDeleteManualModel}
                        onNavigateToChannel={onNavigateToChannel}
                    />
                </div>
            )}
        </div>
    );
}

export function SiteAccountPanelSkeleton() {
    // Lightweight skeleton shown for one frame while the morph animation starts.
    // Keeps the dialog body roughly the same height so morph layout doesn't jump
    // when SiteAccountPanel mounts. Pure CSS, no framer-motion / recharts / dnd.
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
                <div className="h-9 w-32 animate-pulse rounded-2xl bg-muted/50" />
                <div className="h-9 w-24 animate-pulse rounded-2xl bg-muted/50" />
                <div className="h-9 w-28 animate-pulse rounded-2xl bg-muted/50" />
                <div className="ml-auto h-9 w-44 animate-pulse rounded-2xl bg-muted/50" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, idx) => (
                    <div key={idx} className="h-40 animate-pulse rounded-3xl border border-border/70 bg-muted/40" />
                ))}
            </div>
            <div className="h-72 animate-pulse rounded-3xl border border-border/70 bg-muted/40" />
        </div>
    );
}
