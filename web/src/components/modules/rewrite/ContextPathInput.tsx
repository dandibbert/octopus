'use client';

import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { CONTEXT_PATHS } from './schema';

export function ContextPathInput({
    value,
    onChange,
    placeholder,
}: {
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
}) {
    const id = useId();
    return (
        <>
            <Input
                list={id}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder ?? CONTEXT_PATHS[0]}
                className="h-9 rounded-lg font-mono text-xs"
            />
            <datalist id={id}>
                {CONTEXT_PATHS.map((path) => <option key={path} value={path} />)}
            </datalist>
        </>
    );
}
