import { useMutation } from '@tanstack/react-query';
import { apiClient } from '../client';

export type RewriteScope = 'group' | 'channel';

export type RewriteValidateRequest = {
    scope: RewriteScope;
    config: unknown;
};

export type RewriteValidateResult = {
    ok: boolean;
    legacy: boolean;
    warnings?: string[];
};

export type RewritePreviewRequest = {
    channel_id: number;
    group_id?: number;
    inbound_format?: string;
    path?: string;
    body?: unknown;
    headers?: Record<string, string>;
    draft_scope?: RewriteScope;
    draft_config?: unknown;
};

export type RewriteTraceEntry = {
    index: number;
    scope: RewriteScope;
    operation_id: string;
    operation: string;
    status: string;
    matched: boolean;
    changed: boolean;
    paths?: string[];
    warning?: string;
    error_kind?: string;
    duration_us: number;
};

export type RewritePreviewResult = {
    stage: string;
    target_format: string;
    stages: {
        inbound_raw?: unknown;
        outbound_before_rewrite?: unknown;
        after_group?: unknown;
        after_channel?: unknown;
        final_body?: unknown;
        final_headers?: Record<string, string>;
        before_headers?: Record<string, string>;
        after_group_headers?: Record<string, string>;
    };
    trace?: RewriteTraceEntry[];
    warnings?: string[];
    summary?: {
        applied?: number;
        skipped?: number;
        errors?: number;
        transport_model?: string;
    };
};

export function useValidateRewrite() {
    return useMutation({
        mutationFn: (req: RewriteValidateRequest) =>
            apiClient.post<RewriteValidateResult>('/api/v1/rewrite/validate', req),
    });
}

export function usePreviewRewrite() {
    return useMutation({
        mutationFn: (req: RewritePreviewRequest) =>
            apiClient.post<RewritePreviewResult>('/api/v1/rewrite/preview', req),
    });
}
