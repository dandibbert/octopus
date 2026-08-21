import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

export type RewriteScope = 'group' | 'channel';

export type RewriteTemplate = {
    id: number;
    name: string;
    description?: string;
    scope: RewriteScope;
    config: string;
    created_at: string;
    updated_at: string;
};

export type RewriteTemplateInput = Pick<RewriteTemplate, 'name' | 'description' | 'scope' | 'config'>;

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
    target_model?: string;
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

export function useRewriteTemplates(scope: RewriteScope, enabled = true) {
    return useQuery({
        queryKey: ['rewrite-templates', scope],
        queryFn: () => apiClient.get<RewriteTemplate[]>(`/api/v1/rewrite/template/list?scope=${scope}`),
        enabled,
    });
}

export function useCreateRewriteTemplate() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (req: RewriteTemplateInput) => apiClient.post<RewriteTemplate>('/api/v1/rewrite/template/create', req),
        onSuccess: (_data, variables) => queryClient.invalidateQueries({ queryKey: ['rewrite-templates', variables.scope] }),
    });
}

export function useUpdateRewriteTemplate() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (req: RewriteTemplate) => apiClient.post<RewriteTemplate>('/api/v1/rewrite/template/update', req),
        onSuccess: (_data, variables) => queryClient.invalidateQueries({ queryKey: ['rewrite-templates', variables.scope] }),
    });
}

export function useDeleteRewriteTemplate() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id }: { id: number; scope: RewriteScope }) => apiClient.delete<void>(`/api/v1/rewrite/template/delete/${id}`),
        onSuccess: (_data, variables) => queryClient.invalidateQueries({ queryKey: ['rewrite-templates', variables.scope] }),
    });
}
