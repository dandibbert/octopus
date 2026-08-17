'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { User, KeyRound, Lock, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
    useChangeUsername,
    useChangePassword,
    useAuth,
    useSecurityStatus,
    useTwoFactorSetup,
    useTwoFactorEnable,
    useTwoFactorDisable,
    type TwoFactorSetupResponse,
} from '@/api/endpoints/user';
import { toast } from '@/components/common/Toast';

export function SettingAccount() {
    const t = useTranslations('setting');
    const { logout } = useAuth();
    const changeUsername = useChangeUsername();
    const changePassword = useChangePassword();
    const security = useSecurityStatus();
    const twoFactorSetup = useTwoFactorSetup();
    const twoFactorEnable = useTwoFactorEnable();
    const twoFactorDisable = useTwoFactorDisable();

    const [newUsername, setNewUsername] = useState('');
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const [showOldPassword, setShowOldPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [twoFactorSetupData, setTwoFactorSetupData] = useState<TwoFactorSetupResponse | null>(null);
    const [twoFactorCode, setTwoFactorCode] = useState('');

    const handleChangeUsername = () => {
        if (!newUsername.trim()) {
            toast.error(t('account.username.empty'));
            return;
        }

        changeUsername.mutate(
            { newUsername: newUsername.trim() },
            {
                onSuccess: () => {
                    toast.success(t('account.username.success'));
                    setTimeout(() => logout(), 1000);
                },
                onError: () => {
                    toast.error(t('account.username.failed'));
                },
            }
        );
    };

    const handleChangePassword = () => {
        if (!oldPassword) {
            toast.error(t('account.password.oldEmpty'));
            return;
        }
        if (!newPassword) {
            toast.error(t('account.password.newEmpty'));
            return;
        }
        if (newPassword !== confirmPassword) {
            toast.error(t('account.password.mismatch'));
            return;
        }
        if (newPassword.length < 6) {
            toast.error(t('account.password.tooShort'));
            return;
        }

        changePassword.mutate(
            { oldPassword, newPassword },
            {
                onSuccess: () => {
                    toast.success(t('account.password.success'));
                    setTimeout(() => logout(), 1000);
                },
                onError: () => {
                    toast.error(t('account.password.failed'));
                },
            }
        );
    };

    return (
        <div className="min-w-0 overflow-hidden rounded-3xl border border-border bg-card p-6 space-y-6">
            <h2 className="text-lg font-bold text-card-foreground flex items-center gap-2">
                <User className="h-5 w-5" />
                {t('account.title')}
            </h2>

            {/* 修改用户名 */}
            <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <KeyRound className="size-4" />
                    {t('account.username.label')}
                </div>
                <div className="flex min-w-0 gap-2">
                    <Input
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value)}
                        placeholder={t('account.username.placeholder')}
                        className="min-w-0 flex-1 rounded-xl"
                    />
                    <Button
                        onClick={handleChangeUsername}
                        disabled={changeUsername.isPending || !newUsername.trim()}
                        className="shrink-0 rounded-xl"
                    >
                        {changeUsername.isPending ? t('account.saving') : t('account.save')}
                    </Button>
                </div>
            </div>

            <div className="border-t border-border" />

            <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-muted-foreground">
                        <ShieldCheck className="size-4" />
                        <span>{t('account.twoFactor.label')}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                        {security.data?.two_factor_enabled ? t('account.twoFactor.enabled') : t('account.twoFactor.disabled')}
                    </span>
                </div>

                {!security.data?.two_factor_enabled && !twoFactorSetupData && (
                    <Button
                        type="button"
                        variant="secondary"
                        className="w-full rounded-xl"
                        disabled={twoFactorSetup.isPending}
                        onClick={() => twoFactorSetup.mutate(undefined, {
                            onSuccess: setTwoFactorSetupData,
                            onError: (error) => toast.error(t('account.twoFactor.setupFailed'), { description: error.message }),
                        })}
                    >
                        {t('account.twoFactor.setup')}
                    </Button>
                )}

                {!security.data?.two_factor_enabled && twoFactorSetupData && (
                    <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/20 p-4">
                        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
                            <Image
                                src={twoFactorSetupData.qr_code}
                                alt={t('account.twoFactor.qrAlt')}
                                width={160}
                                height={160}
                                unoptimized
                                className="size-40 rounded-xl bg-white p-2"
                            />
                            <div className="min-w-0 flex-1 space-y-2 text-xs text-muted-foreground">
                                <p>{t('account.twoFactor.scanHint')}</p>
                                <div className="rounded-lg bg-background px-3 py-2 font-mono text-foreground break-all">{twoFactorSetupData.secret}</div>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <Input
                                value={twoFactorCode}
                                onChange={(event) => setTwoFactorCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                maxLength={6}
                                placeholder={t('account.twoFactor.codePlaceholder')}
                                className="rounded-xl"
                            />
                            <Button
                                type="button"
                                className="shrink-0 rounded-xl"
                                disabled={twoFactorEnable.isPending || twoFactorCode.length !== 6}
                                onClick={() => twoFactorEnable.mutate(twoFactorCode, {
                                    onSuccess: () => {
                                        toast.success(t('account.twoFactor.enableSuccess'));
                                        setTwoFactorSetupData(null);
                                        setTwoFactorCode('');
                                    },
                                    onError: (error) => toast.error(t('account.twoFactor.enableFailed'), { description: error.message }),
                                })}
                            >
                                {t('account.twoFactor.enable')}
                            </Button>
                        </div>
                    </div>
                )}

                {security.data?.two_factor_enabled && (
                    <div className="flex gap-2">
                        <Input
                            value={twoFactorCode}
                            onChange={(event) => setTwoFactorCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            placeholder={t('account.twoFactor.codePlaceholder')}
                            className="rounded-xl"
                        />
                        <Button
                            type="button"
                            variant="destructive"
                            className="shrink-0 rounded-xl"
                            disabled={twoFactorDisable.isPending || twoFactorCode.length !== 6}
                            onClick={() => twoFactorDisable.mutate(twoFactorCode, {
                                onSuccess: () => {
                                    toast.success(t('account.twoFactor.disableSuccess'));
                                    setTwoFactorCode('');
                                },
                                onError: (error) => toast.error(t('account.twoFactor.disableFailed'), { description: error.message }),
                            })}
                        >
                            {t('account.twoFactor.disable')}
                        </Button>
                    </div>
                )}
            </div>

            <div className="border-t border-border" />

            {/* 修改密码 */}
            <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <Lock className="size-4" />
                    {t('account.password.label')}
                </div>
                <div className="space-y-2">
                    <div className="relative">
                        <Input
                            type={showOldPassword ? 'text' : 'password'}
                            value={oldPassword}
                            onChange={(e) => setOldPassword(e.target.value)}
                            placeholder={t('account.password.oldPlaceholder')}
                            className="rounded-xl pr-10"
                        />
                        <button
                            type="button"
                            onClick={() => setShowOldPassword(!showOldPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                            {showOldPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                    </div>
                    <div className="relative">
                        <Input
                            type={showNewPassword ? 'text' : 'password'}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder={t('account.password.newPlaceholder')}
                            className="rounded-xl pr-10"
                        />
                        <button
                            type="button"
                            onClick={() => setShowNewPassword(!showNewPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                            {showNewPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                    </div>
                    <div className="relative">
                        <Input
                            type={showConfirmPassword ? 'text' : 'password'}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder={t('account.password.confirmPlaceholder')}
                            className="rounded-xl pr-10"
                        />
                        <button
                            type="button"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                            {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                    </div>
                    <Button
                        onClick={handleChangePassword}
                        disabled={changePassword.isPending || !oldPassword || !newPassword || !confirmPassword}
                        className="w-full rounded-xl"
                    >
                        {changePassword.isPending ? t('account.saving') : t('account.password.change')}
                    </Button>
                </div>
            </div>
        </div>
    );
}

