'use client';

import { ValidatedForm } from '@/components/common/ValidatedForm';

import { useState } from 'react';
import { useCreateModel } from '@/api/endpoints/model';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel, FieldGroup } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import {
    MorphingDialogClose,
    MorphingDialogTitle,
    MorphingDialogDescription,
    useMorphingDialog,
} from '@/components/ui/morphing-dialog';
import { useTranslations } from 'next-intl';
import { toast } from '@/components/common/Toast';

export function CreateDialogContent() {
    const { setIsOpen } = useMorphingDialog();
    const t = useTranslations('model.create');
    const createModel = useCreateModel();

    const [formData, setFormData] = useState({
        name: '',
        input: '',
        output: '',
        cache_read: '',
        cache_write: '',
        canonical_model_id: '',
        billing_class_id: '',
        free: false,
    });

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!formData.name.trim()) return;

        const input = parseFloat(formData.input) || 0;
        const output = parseFloat(formData.output) || 0;
        const cacheRead = parseFloat(formData.cache_read) || 0;
        const cacheWrite = parseFloat(formData.cache_write) || 0;
        const allZero = input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0;
        createModel.mutate({
            name: formData.name.trim(),
            input: formData.free ? 0 : input,
            output: formData.free ? 0 : output,
            cache_read: formData.free ? 0 : cacheRead,
            cache_write: formData.free ? 0 : cacheWrite,
            canonical_model_id: formData.canonical_model_id.trim() || undefined,
            billing_class_id: formData.billing_class_id.trim() || undefined,
            price_mode: formData.free ? 'free' : allZero ? 'unknown' : 'explicit',
        }, {
            onSuccess: () => {
                toast.success(t('created'));
                setFormData({ name: '', input: '', output: '', cache_read: '', cache_write: '', canonical_model_id: '', billing_class_id: '', free: false });
                setIsOpen(false);
            },
            onError: (error) => toast.error(t('createFailed'), { description: error.message }),
        });
    };

    return (
        <div className="w-screen max-w-full md:max-w-xl">
            <MorphingDialogTitle>
                <header className="mb-5 flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-bold text-card-foreground">{t('title')}</h2>
                        <p className="mt-1 max-w-lg text-sm font-normal text-muted-foreground">{t('description')}</p>
                    </div>
                    <MorphingDialogClose
                        className="relative right-0 top-0"
                        variants={{
                            initial: { opacity: 0, scale: 0.8 },
                            animate: { opacity: 1, scale: 1 },
                            exit: { opacity: 0, scale: 0.8 },
                        }}
                    />
                </header>
            </MorphingDialogTitle>
            <MorphingDialogDescription>
                <ValidatedForm onSubmit={handleSubmit}>
                    <FieldGroup className="gap-4">
                        <Field>
                            <FieldLabel htmlFor="model-name">{t('name')}</FieldLabel>
                            <Input
                                id="model-name"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder={t('namePlaceholder')}
                                className="rounded-xl"
                            />
                        </Field>
                        <div className="rounded-2xl border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                            {t('mappingHint')}
                        </div>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Field>
                                <FieldLabel htmlFor="model-input">{t('input')}</FieldLabel>
                                <Input
                                    id="model-input"
                                    type="number"
                                    step="any"
                                    value={formData.input}
                                    onChange={(e) => setFormData({ ...formData, input: e.target.value })}
                                    disabled={formData.free}
                                    className="rounded-xl"
                                />
                            </Field>
                            <Field>
                                <FieldLabel htmlFor="model-output">{t('output')}</FieldLabel>
                                <Input
                                    id="model-output"
                                    type="number"
                                    step="any"
                                    value={formData.output}
                                    onChange={(e) => setFormData({ ...formData, output: e.target.value })}
                                    disabled={formData.free}
                                    className="rounded-xl"
                                />
                            </Field>
                            <Field>
                                <FieldLabel htmlFor="model-cache-read">{t('cacheRead')}</FieldLabel>
                                <Input
                                    id="model-cache-read"
                                    type="number"
                                    step="any"
                                    value={formData.cache_read}
                                    onChange={(e) => setFormData({ ...formData, cache_read: e.target.value })}
                                    disabled={formData.free}
                                    className="rounded-xl"
                                />
                            </Field>
                            <Field>
                                <FieldLabel htmlFor="model-cache-write">{t('cacheWrite')}</FieldLabel>
                                <Input
                                    id="model-cache-write"
                                    type="number"
                                    step="any"
                                    value={formData.cache_write}
                                    onChange={(e) => setFormData({ ...formData, cache_write: e.target.value })}
                                    disabled={formData.free}
                                    className="rounded-xl"
                                />
                            </Field>
                        </div>
                        <details className="rounded-2xl border bg-muted/15 px-4 py-3">
                            <summary className="cursor-pointer select-none text-sm font-medium text-card-foreground">
                                {t('advancedIdentity')}
                            </summary>
                            <p className="mt-1 text-xs text-muted-foreground">{t('advancedIdentityHint')}</p>
                            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <Field>
                                    <FieldLabel htmlFor="model-canonical">{t('canonicalModel')}</FieldLabel>
                                    <Input
                                        id="model-canonical"
                                        value={formData.canonical_model_id}
                                        onChange={(e) => setFormData({ ...formData, canonical_model_id: e.target.value })}
                                        placeholder={t('canonicalPlaceholder')}
                                        className="rounded-xl"
                                    />
                                </Field>
                                <Field>
                                    <FieldLabel htmlFor="model-billing-class">{t('billingClass')}</FieldLabel>
                                    <Input
                                        id="model-billing-class"
                                        value={formData.billing_class_id}
                                        onChange={(e) => setFormData({ ...formData, billing_class_id: e.target.value })}
                                        placeholder={t('billingClassPlaceholder')}
                                        className="rounded-xl"
                                    />
                                </Field>
                            </div>
                        </details>
                        <label className="flex items-center justify-between rounded-xl border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                            <span>{t('explicitFree')}</span>
                            <Switch
                                checked={formData.free}
                                onCheckedChange={(free) => setFormData({
                                    ...formData,
                                    free,
                                    ...(free ? { input: '0', output: '0', cache_read: '0', cache_write: '0' } : {}),
                                })}
                            />
                        </label>
                        <Button
                            type="submit"
                            disabled={createModel.isPending || !formData.name.trim()}
                            className="w-full rounded-xl h-11"
                        >
                            {createModel.isPending ? t('submitting') : t('submit')}
                        </Button>
                    </FieldGroup>
                </ValidatedForm>
            </MorphingDialogDescription>
        </div>
    );
}
