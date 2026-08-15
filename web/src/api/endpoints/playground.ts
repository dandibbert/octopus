import { authenticatedFetch } from '../client';
import { translateApiErrorCode, type ErrorValues } from '../error-i18n';

export type PlaygroundMessage = { role: 'user' | 'assistant' | 'system'; content: string };
export type PlaygroundRequest = {
    target:
        | { type: 'group'; group?: string; group_id?: number }
        | { type: 'channel_model'; channel_id: number; model: string };
    messages: PlaygroundMessage[];
    system_prompt?: string;
    parameters: {
        reasoning_effort: 'auto' | 'off' | 'low' | 'medium' | 'high' | 'xhigh';
        temperature?: number;
        max_output_tokens?: number;
        stream: boolean;
    };
};

type PlaygroundErrorDescriptor = {
    errorCode?: string;
    params?: ErrorValues;
};

function isErrorValues(value: unknown): value is ErrorValues {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.values(value).every((item) => (
        item === null
        || item === undefined
        || typeof item === 'string'
        || typeof item === 'number'
        || typeof item === 'boolean'
    ));
}

function findErrorDescriptor(value: unknown): PlaygroundErrorDescriptor {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const record = value as Record<string, unknown>;
    const errorCode = typeof record.error_code === 'string' ? record.error_code : undefined;
    const params = isErrorValues(record.params) ? record.params : undefined;
    if (errorCode) return { errorCode, params };
    return findErrorDescriptor(record.error);
}

/**
 * Playground 会透传 relay 与上游的多种错误包络。只使用稳定 error_code
 * 选择展示文案；没有稳定码的上游错误统一降级，避免向用户暴露英文实现细节。
 */
export function translatePlaygroundError(value: unknown, fallback: string) {
    const descriptor = findErrorDescriptor(value);
    return translateApiErrorCode(
        descriptor.errorCode ?? 'playground.execution_failed',
        fallback,
        descriptor.params,
    );
}

export async function readPlaygroundError(response: Response, fallback: string) {
    const raw = await response.text();
    if (!raw.trim()) return translatePlaygroundError(undefined, fallback);
    try {
        return translatePlaygroundError(JSON.parse(raw), fallback);
    } catch {
        return translatePlaygroundError(undefined, fallback);
    }
}

export async function createPlaygroundChat(request: PlaygroundRequest, signal?: AbortSignal) {
    return authenticatedFetch('/api/v1/playground/chat', {
        method: 'POST',
        body: JSON.stringify(request),
        signal,
    });
}
