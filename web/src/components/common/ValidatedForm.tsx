'use client';

import type { ComponentProps } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from './Toast';

type FormField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function isFormField(element: Element): element is FormField {
    return element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement;
}

/** Keep HTML constraints, but present failures through the product's UI. */
export function ValidatedForm({ onSubmit, onInputCapture, ...props }: ComponentProps<'form'>) {
    const t = useTranslations('formValidation');

    return <form {...props} noValidate onInputCapture={(event) => {
        onInputCapture?.(event);
        const field = event.target;
        if (field instanceof HTMLElement && isFormField(field) && field.dataset.formInvalid && field.validity.valid) {
            field.removeAttribute('aria-invalid');
            delete field.dataset.formInvalid;
        }
    }} onSubmit={(event) => {
        const field = Array.from(event.currentTarget.elements).find(
            (element): element is FormField => isFormField(element) && element.willValidate && !element.validity.valid,
        );
        if (!field) {
            onSubmit?.(event);
            return;
        }
        event.preventDefault();
        const validity = field.validity;
        const key = validity.valueMissing ? 'required'
            : field instanceof HTMLInputElement && field.type === 'url' ? 'url'
            : field instanceof HTMLInputElement && field.type === 'email' ? 'email'
            : validity.rangeUnderflow ? 'min'
            : validity.rangeOverflow ? 'max'
            : validity.badInput || validity.stepMismatch ? 'number'
            : 'invalid';
        const label = field.labels?.[0]?.textContent?.trim() || field.getAttribute('aria-label') || field.getAttribute('placeholder');
        toast.error(t(key, { min: field.getAttribute('min') ?? '', max: field.getAttribute('max') ?? '' }), {
            description: key === 'url' ? undefined : label || undefined,
        });
        if (field.getAttribute('aria-invalid') !== 'true') {
            field.setAttribute('aria-invalid', 'true');
            field.dataset.formInvalid = 'true';
        }
        field.focus({ preventScroll: true });
        field.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }} />;
}
