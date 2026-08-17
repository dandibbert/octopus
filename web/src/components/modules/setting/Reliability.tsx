'use client';

import { useTranslations } from 'next-intl';
import { Hash, HeartPulse, RotateCcw, ShieldCheck, Timer, TimerOff, type LucideIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SettingKey, useCircuitBreakerStatus, useResetCircuitBreaker, useSiteEnabled } from '@/api/endpoints/setting';
import { toast } from '@/components/common/Toast';
import { SettingCard, SettingRow, SettingSection, useSettingField, useSettingToggle } from './shared';

// min/max 与后端 model.Setting.Validate() 的边界保持一致，前端先行约束整数范围。
const OUTLIER_FIELDS: { key: string; labelKey: string; min: number; max?: number }[] = [
    { key: SettingKey.OutlierRetireInterval, labelKey: 'interval', min: 1 },
    { key: SettingKey.OutlierFailRatePct, labelKey: 'failRate', min: 1, max: 100 },
    { key: SettingKey.OutlierMinSamples, labelKey: 'minSamples', min: 1 },
    { key: SettingKey.OutlierConsecFails, labelKey: 'consecFails', min: 1 },
    { key: SettingKey.OutlierWindowMinutes, labelKey: 'windowMinutes', min: 1 },
    { key: SettingKey.OutlierWindowCapacity, labelKey: 'windowCapacity', min: 1, max: 20 },
    { key: SettingKey.OutlierRecoverStreak, labelKey: 'recoverStreak', min: 1 },
    { key: SettingKey.OutlierReapMinutes, labelKey: 'reapMinutes', min: 1 },
    { key: SettingKey.OutlierCFRecoverMinutes, labelKey: 'cfRecoverMinutes', min: 1 },
];

function NumberFieldRow({ settingKey, label, placeholder, tooltip, icon, min, max }: {
    settingKey: string;
    label: string;
    placeholder: string;
    tooltip?: React.ReactNode;
    icon?: LucideIcon;
    min?: number;
    max?: number;
}) {
    const field = useSettingField(settingKey);
    return (
        <SettingRow icon={icon} label={label} tooltip={tooltip}>
            <Input
                type="number"
                step={1}
                min={min}
                max={max}
                value={field.value}
                onChange={(e) => field.setValue(e.target.value)}
                onBlur={field.save}
                placeholder={placeholder}
                className="w-48 rounded-xl"
            />
        </SettingRow>
    );
}

export function SettingReliability() {
    const t = useTranslations('setting');
    const outlier = useSettingToggle(SettingKey.OutlierRetireEnabled);
    const groupHealth = useSettingToggle(SettingKey.GroupHealthEnabled);
    const { enabled: siteEnabled } = useSiteEnabled();
    const circuitEnabled = useSettingToggle(SettingKey.CircuitBreakerEnabled);
    const circuitStatus = useCircuitBreakerStatus();
    const resetCircuit = useResetCircuitBreaker();
    const tripped = circuitStatus.data ?? [];

    return (
        <SettingCard icon={ShieldCheck} title={t('reliability.title')}>
            {/* 分组健康检查 */}
            <SettingRow icon={HeartPulse} label={t('groupHealth.label')} tooltip={t('groupHealth.description')}>
                <Switch checked={groupHealth.enabled} onCheckedChange={groupHealth.toggle} />
            </SettingRow>

            {/* 熔断器 */}
            <SettingSection title={t('circuitBreaker.title')} tooltip={t('circuitBreaker.hint')} />
            <SettingRow label={t('circuitBreaker.enabled.label')} tooltip={t('circuitBreaker.enabled.description')}>
                <Switch checked={circuitEnabled.enabled} onCheckedChange={circuitEnabled.toggle} />
            </SettingRow>
            <NumberFieldRow
                settingKey={SettingKey.CircuitBreakerThreshold}
                label={t('circuitBreaker.threshold.label')}
                placeholder={t('circuitBreaker.threshold.placeholder')}
                icon={Hash}
            />
            <NumberFieldRow
                settingKey={SettingKey.CircuitBreakerCooldown}
                label={t('circuitBreaker.cooldown.label')}
                placeholder={t('circuitBreaker.cooldown.placeholder')}
                icon={Timer}
            />
            <NumberFieldRow
                settingKey={SettingKey.CircuitBreakerMaxCooldown}
                label={t('circuitBreaker.maxCooldown.label')}
                placeholder={t('circuitBreaker.maxCooldown.placeholder')}
                icon={TimerOff}
            />
            <div className="space-y-2 rounded-2xl border border-border/50 bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2">
                    <div>
                        <div className="text-sm font-medium text-card-foreground">{t('circuitBreaker.status.title')}</div>
                        <div className="text-xs text-muted-foreground">
                            {tripped.length > 0 ? t('circuitBreaker.status.count', { count: tripped.length }) : t('circuitBreaker.status.empty')}
                        </div>
                    </div>
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={resetCircuit.isPending || tripped.length === 0}
                        className="rounded-xl"
                        onClick={() => resetCircuit.mutate(undefined, {
                            onSuccess: () => toast.success(t('circuitBreaker.status.resetSuccess')),
                            onError: (error) => toast.error(t('circuitBreaker.status.resetFailed'), { description: error.message }),
                        })}
                    >
                        <RotateCcw className="mr-1 size-3.5" />
                        {t('circuitBreaker.status.reset')}
                    </Button>
                </div>
                {tripped.length > 0 && (
                    <div className="max-h-48 space-y-1 overflow-y-auto">
                        {tripped.map((item) => (
                            <div key={`${item.channel_id}:${item.key_id}:${item.model_name}`} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-background/70 px-3 py-2 text-xs">
                                <div className="min-w-0">
                                    <div className="truncate font-medium text-foreground">{item.channel_name || `#${item.channel_id}`} · {item.model_name}</div>
                                    <div className="truncate text-muted-foreground">Key #{item.key_id} · {t(`circuitBreaker.status.${item.state}`)} · {t('circuitBreaker.status.tripCount', { count: item.trip_count })}</div>
                                </div>
                                <span className="shrink-0 tabular-nums text-muted-foreground">
                                    {item.remaining_cooldown > 0 ? t('circuitBreaker.status.remaining', { seconds: item.remaining_cooldown }) : t('circuitBreaker.status.probing')}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* POR 只作用于站点投影渠道，站点功能关闭时一并收起设置面 */}
            {siteEnabled && (
                <>
                    <SettingSection title={t('outlierRetirement.title')} tooltip={t('outlierRetirement.hint')} />
                    <SettingRow label={t('outlierRetirement.enabled.label')}>
                        <Switch checked={outlier.enabled} onCheckedChange={outlier.toggle} />
                    </SettingRow>
                    {outlier.enabled && OUTLIER_FIELDS.map((f) => (
                        <NumberFieldRow
                            key={f.key}
                            settingKey={f.key}
                            label={t(`outlierRetirement.${f.labelKey}.label`)}
                            placeholder={t(`outlierRetirement.${f.labelKey}.placeholder`)}
                            tooltip={t(`outlierRetirement.${f.labelKey}.description`)}
                            min={f.min}
                            max={f.max}
                        />
                    ))}
                </>
            )}
        </SettingCard>
    );
}
