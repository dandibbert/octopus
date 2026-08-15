'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import type { LLMInfo, PriceMode } from '@/api/endpoints/model';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const MAX_VISIBLE_OPTIONS = 100;

export type PricedModelOption = {
    key: string;
    name: string;
    provider?: string;
    canonicalModelID: string;
    billingClassID?: string;
    priceSource?: string;
    priceMode: PriceMode;
    input: number;
    output: number;
};

export function effectivePriceMode(model: LLMInfo): PriceMode {
    if (model.price_mode) return model.price_mode;
    return model.input === 0 && model.output === 0 && model.cache_read === 0 && model.cache_write === 0
        ? 'unknown'
        : 'explicit';
}

function normalizedIdentity(value?: string) {
    return value?.trim().toLocaleLowerCase() ?? '';
}

function bareCanonicalIdentity(value?: string) {
    const normalized = normalizedIdentity(value);
    const separator = normalized.indexOf(':');
    const withoutProvider = separator >= 0 ? normalized.slice(separator + 1) : normalized;
    return withoutProvider.endsWith('/default')
        ? withoutProvider.slice(0, -'/default'.length)
        : withoutProvider;
}

function optionRank(model: LLMInfo, priceMode: PriceMode, canonicalModelID: string) {
    const normalizedName = normalizedIdentity(model.name);
    const canonical = normalizedIdentity(canonicalModelID);
    const isCanonicalIdentity = normalizedName === canonical || normalizedName === bareCanonicalIdentity(canonical);
    const resolutionMethod = normalizedIdentity(model.resolution_method);
    const isAlias = priceMode === 'inherited' || resolutionMethod === 'alias' || resolutionMethod.endsWith('_alias');

    if (model.catalog_only && isCanonicalIdentity) return 0;
    if (!isAlias && isCanonicalIdentity) return 1;
    if (model.catalog_only) return 2;
    if (!isAlias) return 3;
    return 4;
}

export function getPricedModelOptions(models: LLMInfo[]): PricedModelOption[] {
    const candidates = models.flatMap((model) => {
        const priceMode = effectivePriceMode(model);
        if (priceMode === 'unknown') return [];

        const canonicalModelID = model.canonical_model_id?.trim() || model.name.trim();
        if (!canonicalModelID) return [];

        const billingClassID = model.billing_class_id?.trim() || undefined;
        const effectivePrice = model.effective_price ?? model;
        return [{
            rank: optionRank(model, priceMode, canonicalModelID),
            option: {
                key: `${normalizedIdentity(canonicalModelID)}\u0000${normalizedIdentity(billingClassID)}`,
                name: model.name,
                provider: model.provider,
                canonicalModelID,
                billingClassID,
                priceSource: model.effective_price_source || model.price_source,
                priceMode,
                input: effectivePrice.input,
                output: effectivePrice.output,
            } satisfies PricedModelOption,
        }];
    }).sort((a, b) => (
        a.rank - b.rank ||
        a.option.name.localeCompare(b.option.name) ||
        (a.option.provider ?? '').localeCompare(b.option.provider ?? '') ||
        (a.option.priceSource ?? '').localeCompare(b.option.priceSource ?? '') ||
        a.option.key.localeCompare(b.option.key) ||
        a.option.priceMode.localeCompare(b.option.priceMode) ||
        a.option.input - b.option.input ||
        a.option.output - b.option.output
    ));

    const options = new Map<string, PricedModelOption>();
    for (const candidate of candidates) {
        if (!options.has(candidate.option.key)) options.set(candidate.option.key, candidate.option);
    }

    return Array.from(options.values()).sort((a, b) => (
        a.name.localeCompare(b.name) ||
        (a.provider ?? '').localeCompare(b.provider ?? '') ||
        a.canonicalModelID.localeCompare(b.canonicalModelID) ||
        (a.billingClassID ?? '').localeCompare(b.billingClassID ?? '')
    ));
}

export function formatModelPrice(value: number, priceMode: PriceMode, freeLabel: string) {
    if (priceMode === 'free') return freeLabel;
    if (!Number.isFinite(value) || value === 0) return '$0';

    const absolute = Math.abs(value);
    if (absolute < 0.00000001) return `$${value.toExponential(2)}`;
    const fractionDigits = absolute >= 1 ? 2 : absolute >= 0.01 ? 4 : absolute >= 0.0001 ? 6 : 8;
    return `$${value.toFixed(fractionDigits).replace(/\.?0+$/, '')}`;
}

function normalizedSearch(values: Array<string | undefined>) {
    return values.filter(Boolean).join(' ').toLocaleLowerCase();
}

export function FreeformModelCombobox({
    value,
    options,
    onValueChange,
    onOptionSelect,
    ariaLabel,
}: {
    value: string;
    options: LLMInfo[];
    onValueChange: (value: string) => void;
    onOptionSelect?: (option: LLMInfo) => void;
    ariaLabel: string;
}) {
    const [open, setOpen] = useState(false);
    const listboxID = useId();
    const matches = useMemo(() => {
        const query = value.trim().toLocaleLowerCase();
        const filtered = query
            ? options.filter((option) => normalizedSearch([
                option.name,
                option.provider,
                option.canonical_model_id,
            ]).includes(query))
            : options;
        return filtered.slice(0, 50);
    }, [options, value]);

    return (
        <Popover open={open && matches.length > 0} onOpenChange={setOpen}>
            <PopoverAnchor asChild>
                <Input
                    value={value}
                    role="combobox"
                    aria-label={ariaLabel}
                    aria-autocomplete="list"
                    aria-expanded={open && matches.length > 0}
                    aria-controls={listboxID}
                    autoComplete="off"
                    onFocus={() => setOpen(true)}
                    onClick={() => setOpen(true)}
                    onChange={(event) => {
                        onValueChange(event.target.value);
                        setOpen(true);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') setOpen(false);
                        if (event.key === 'ArrowDown' && matches.length > 0) {
                            event.preventDefault();
                            document.getElementById(`${listboxID}-0`)?.focus();
                        }
                    }}
                    className="rounded-xl"
                />
            </PopoverAnchor>
            <PopoverContent
                align="start"
                onOpenAutoFocus={(event) => event.preventDefault()}
                className="z-[120] max-h-72 w-[calc(100vw-2rem)] max-w-md overflow-y-auto rounded-xl p-1 sm:w-[var(--radix-popover-anchor-width)] sm:min-w-72"
            >
                <div id={listboxID} role="listbox" aria-label={ariaLabel}>
                    {matches.map((option, index) => (
                        <button
                            id={`${listboxID}-${index}`}
                            key={`${option.provider ?? ''}:${option.name}`}
                            type="button"
                            role="option"
                            aria-selected={option.name === value}
                            className="flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                            onKeyDown={(event) => {
                                if (event.key === 'ArrowDown') {
                                    event.preventDefault();
                                    document.getElementById(`${listboxID}-${Math.min(index + 1, matches.length - 1)}`)?.focus();
                                }
                                if (event.key === 'ArrowUp') {
                                    event.preventDefault();
                                    if (index === 0) {
                                        document.querySelector<HTMLInputElement>(`[aria-controls="${listboxID}"]`)?.focus();
                                    } else {
                                        document.getElementById(`${listboxID}-${index - 1}`)?.focus();
                                    }
                                }
                                if (event.key === 'Escape') setOpen(false);
                            }}
                            onClick={() => {
                                onValueChange(option.name);
                                onOptionSelect?.(option);
                                setOpen(false);
                            }}
                        >
                            <span className="min-w-0">
                                <span className="block break-all font-medium text-card-foreground">{option.name}</span>
                                {(option.provider || option.canonical_model_id) && (
                                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                        {[option.provider, option.canonical_model_id].filter(Boolean).join(' · ')}
                                    </span>
                                )}
                            </span>
                            {option.name === value && <Check className="size-4 shrink-0 text-primary" />}
                        </button>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}

export function PricedModelCombobox({
    value,
    options,
    onSelect,
    labels,
    disabled,
}: {
    value: string;
    options: PricedModelOption[];
    onSelect: (option: PricedModelOption) => void;
    labels: {
        ariaLabel: string;
        searchPlaceholder: string;
        empty: string;
        input: string;
        output: string;
        free: string;
        source: (value: string) => string;
    };
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const listboxID = useId();
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const selected = options.find((option) => option.key === value);
    const matches = useMemo(() => {
        const normalized = query.trim().toLocaleLowerCase();
        const filtered = normalized
            ? options.filter((option) => normalizedSearch([
                option.name,
                option.provider,
                option.canonicalModelID,
                option.billingClassID,
                option.priceSource,
            ]).includes(normalized))
            : options;

        // Search always considers the complete catalog, while the popover only
        // mounts a bounded result set to keep large remote catalogs responsive.
        return filtered.slice(0, MAX_VISIBLE_OPTIONS);
    }, [options, query]);

    return (
        <Popover open={open} onOpenChange={(next) => {
            setOpen(next);
            if (!next) setQuery('');
        }}>
            <PopoverTrigger asChild>
                <Button
                    ref={triggerRef}
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-label={labels.ariaLabel}
                    aria-expanded={open}
                    aria-controls={listboxID}
                    disabled={disabled}
                    className="h-auto min-h-10 w-full min-w-0 justify-between rounded-xl px-3 py-2 font-normal"
                >
                    <span className={cn('min-w-0 truncate text-left', !selected && !value && 'text-muted-foreground')}>
                        {selected?.name || value || labels.ariaLabel}
                    </span>
                    <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="z-[120] w-[calc(100vw-2rem)] max-w-md rounded-xl p-2 sm:w-[var(--radix-popover-trigger-width)] sm:min-w-[20rem]"
            >
                <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        ref={searchInputRef}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'ArrowDown' || event.key === 'Home') {
                                event.preventDefault();
                                document.getElementById(`${listboxID}-0`)?.focus();
                            }
                            if (event.key === 'ArrowUp' || event.key === 'End') {
                                event.preventDefault();
                                document.getElementById(`${listboxID}-${matches.length - 1}`)?.focus();
                            }
                            if (event.key === 'Escape') {
                                event.preventDefault();
                                setOpen(false);
                                requestAnimationFrame(() => triggerRef.current?.focus());
                            }
                        }}
                        placeholder={labels.searchPlaceholder}
                        aria-label={labels.searchPlaceholder}
                        className="rounded-lg pl-9"
                    />
                </div>
                <div id={listboxID} role="listbox" aria-label={labels.ariaLabel} className="mt-2 max-h-72 overflow-y-auto">
                    {matches.length === 0 ? (
                        <p className="px-3 py-8 text-center text-sm text-muted-foreground">{labels.empty}</p>
                    ) : matches.map((option, index) => (
                        <button
                            id={`${listboxID}-${index}`}
                            key={option.key}
                            type="button"
                            role="option"
                            aria-selected={option.key === value}
                            className="flex min-h-14 w-full min-w-0 items-start gap-2 rounded-lg px-3 py-2 text-left outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                            onKeyDown={(event) => {
                                if (event.key === 'ArrowDown') {
                                    event.preventDefault();
                                    document.getElementById(`${listboxID}-${Math.min(index + 1, matches.length - 1)}`)?.focus();
                                }
                                if (event.key === 'ArrowUp') {
                                    event.preventDefault();
                                    if (index === 0) searchInputRef.current?.focus();
                                    else document.getElementById(`${listboxID}-${index - 1}`)?.focus();
                                }
                                if (event.key === 'Home') {
                                    event.preventDefault();
                                    document.getElementById(`${listboxID}-0`)?.focus();
                                }
                                if (event.key === 'End') {
                                    event.preventDefault();
                                    document.getElementById(`${listboxID}-${matches.length - 1}`)?.focus();
                                }
                                if (event.key === 'Escape') {
                                    event.preventDefault();
                                    setOpen(false);
                                    requestAnimationFrame(() => triggerRef.current?.focus());
                                }
                            }}
                            onClick={() => {
                                onSelect(option);
                                setOpen(false);
                            }}
                        >
                            <Check className={cn('mt-0.5 size-4 shrink-0 text-primary', option.key !== value && 'invisible')} />
                            <span className="min-w-0 flex-1">
                                <span className="block break-all text-sm font-medium text-card-foreground">{option.name}</span>
                                <span className="mt-0.5 block break-all text-xs text-muted-foreground">
                                    {[option.provider, option.canonicalModelID].filter(Boolean).join(' · ')}
                                </span>
                                <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
                                    <span>{labels.input} {formatModelPrice(option.input, option.priceMode, labels.free)}</span>
                                    <span>{labels.output} {formatModelPrice(option.output, option.priceMode, labels.free)}</span>
                                    {option.priceSource && <span>{labels.source(option.priceSource)}</span>}
                                </span>
                            </span>
                        </button>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}
