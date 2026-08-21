export const REWRITE_SCHEMA = 'octopus.request-rewrite/v2';

export type RewriteScopeLike = 'group' | 'channel';

export type RewriteOp =
    | 'set'
    | 'set_if_absent'
    | 'delete'
    | 'move'
    | 'copy'
    | 'array_append'
    | 'array_prepend'
    | 'array_insert'
    | 'array_remove'
    | 'header_set'
    | 'header_set_if_absent'
    | 'header_add'
    | 'header_delete'
    | 'header_copy'
    | 'header_move'
    | 'return_error'
    | 'trim_prefix'
    | 'trim_suffix'
    | 'ensure_prefix'
    | 'ensure_suffix'
    | 'trim_space'
    | 'to_lower'
    | 'to_upper'
    | 'replace'
    | 'regex_replace'
    | 'prune_objects'
    | 'header_pass'
    | 'sync_fields';

export const P0_OPS: RewriteOp[] = [
    'set',
    'set_if_absent',
    'delete',
    'move',
    'copy',
    'array_append',
    'array_prepend',
    'array_insert',
    'array_remove',
    'header_set',
    'header_set_if_absent',
    'header_add',
    'header_delete',
    'header_copy',
    'header_move',
    'return_error',
];

export const P1_OPS: RewriteOp[] = [
    'trim_prefix',
    'trim_suffix',
    'ensure_prefix',
    'ensure_suffix',
    'trim_space',
    'to_lower',
    'to_upper',
    'replace',
    'regex_replace',
    'prune_objects',
    'header_pass',
    'sync_fields',
];

export const ALL_OPS: RewriteOp[] = [...P0_OPS, ...P1_OPS];

export const CONDITION_OPERATORS = [
    'exists',
    'missing',
    'eq',
    'neq',
    'prefix',
    'suffix',
    'contains',
    'regex',
    'gt',
    'gte',
    'lt',
    'lte',
    'in',
    'not_in',
    'type_is',
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export const VALUE_SOURCES = ['body', 'header', 'context'] as const;
export type ValueSourceKind = (typeof VALUE_SOURCES)[number];

export const CONTEXT_PATHS = [
    'request.original_model',
    'request.normalized_model',
    'request.path',
    'request.method',
    'request.source',
    'request.stream',
    'request.reasoning_effort',
    'route.routed_model',
    'route.transport_model_before_rewrite',
    'route.inbound_format',
    'route.outbound_format',
    'route.channel_id',
    'route.channel_name',
    'route.channel_type',
    'route.group_id',
    'route.group_name',
    'retry.index',
    'retry.is_retry',
    'flags.is_channel_test',
    'flags.is_health_check',
    'flags.is_playground',
];

export const SENSITIVE_HEADERS = [
    'authorization',
    'proxy-authorization',
    'x-api-key',
    'x-api-secret',
    'x-api-token',
    'cookie',
    'set-cookie',
];

export type ValueSource = {
    source: ValueSourceKind | 'item' | string;
    path: string;
    default?: unknown;
};

export type ConditionExpr = {
    all?: ConditionExpr[];
    any?: ConditionExpr[];
    not?: ConditionExpr;
    source?: ValueSourceKind | 'item' | string;
    path?: string;
    operator?: ConditionOperator | string;
    value?: unknown;
    case_sensitive?: boolean;
};

export type RewritePolicy = {
    on_error?: 'reject' | 'warn_and_continue' | string;
    on_missing?: 'skip' | 'error' | string;
    on_type_mismatch?: 'skip' | 'error' | string;
    on_conflict?: 'overwrite' | 'keep' | 'error' | string;
};

export type RewriteOperation = {
    id: string;
    name?: string;
    enabled?: boolean;
    op: RewriteOp | string;
    path?: string;
    from?: string;
    to?: string;
    header?: string;
    from_header?: string;
    to_header?: string;
    value?: unknown;
    value_from?: ValueSource;
    value_template?: string;
    index?: number;
    splat?: boolean;
    recursive?: boolean;
    search?: string;
    pattern?: string;
    replacement?: string;
    when?: ConditionExpr;
    item_when?: ConditionExpr;
    policy?: RewritePolicy;
    error?: {
        status?: number;
        code?: string;
        type?: string;
        message: string;
        retry?: 'stop' | 'next_channel';
    };
};

export type RewriteConfig = {
    $schema: typeof REWRITE_SCHEMA;
    stage: 'outbound_provider';
    enabled?: boolean;
    allow_sensitive_headers?: boolean;
    policy?: RewritePolicy;
    operations: RewriteOperation[];
};

export function emptyConfig(): RewriteConfig {
    return {
        $schema: REWRITE_SCHEMA,
        stage: 'outbound_provider',
        enabled: true,
        operations: [],
    };
}

export function newOperation(index: number): RewriteOperation {
    return {
        id: `op-${index + 1}`,
        enabled: true,
        op: 'set',
        path: '/temperature',
        value: 0.2,
    };
}

export function looksLikeV2(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const rec = value as Record<string, unknown>;
    return rec.$schema === REWRITE_SCHEMA;
}

function looksLikeV2WithoutSchema(rec: Record<string, unknown>): boolean {
    return ['operations', 'stage', 'policy', 'allow_sensitive_headers'].some((key) => key in rec);
}

export function escapePointer(key: string): string {
    return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function legacyToV2(obj: Record<string, unknown>): RewriteConfig {
    const keys = Object.keys(obj).sort();
    const operations: RewriteOperation[] = keys.map((key) => {
        const id = `legacy-${key.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'field'}`;
        const path = `/${escapePointer(key)}`;
        if (obj[key] === null) {
            return { id, op: 'delete', path };
        }
        return { id, op: 'set', path, value: obj[key] };
    });
    return {
        $schema: REWRITE_SCHEMA,
        stage: 'outbound_provider',
        enabled: true,
        operations,
    };
}

export function parseRewriteInput(raw: string): {
    kind: 'empty' | 'v2' | 'legacy' | 'invalid';
    config: RewriteConfig;
    error?: string;
    legacyFieldCount?: number;
} {
    const trimmed = raw.trim();
    if (!trimmed) {
        return { kind: 'empty', config: emptyConfig() };
    }
    try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { kind: 'invalid', config: emptyConfig(), error: 'object' };
        }
        const rec = parsed as Record<string, unknown>;
        if ('$schema' in rec && rec.$schema !== REWRITE_SCHEMA) {
            return { kind: 'invalid', config: emptyConfig(), error: 'schema' };
        }
        if (looksLikeV2(parsed)) {
            if (rec.stage !== undefined && rec.stage !== 'outbound_provider') {
                return { kind: 'invalid', config: emptyConfig(), error: 'schema' };
            }
            const operations = Array.isArray(rec.operations) ? rec.operations as RewriteOperation[] : [];
            return {
                kind: 'v2',
                config: {
                    $schema: REWRITE_SCHEMA,
                    stage: 'outbound_provider',
                    enabled: rec.enabled !== false,
                    allow_sensitive_headers: rec.allow_sensitive_headers === true,
                    policy: rec.policy && typeof rec.policy === 'object' ? rec.policy as RewritePolicy : undefined,
                    operations,
                },
            };
        }
        if (looksLikeV2WithoutSchema(rec)) {
            return { kind: 'invalid', config: emptyConfig(), error: 'schema' };
        }
        return { kind: 'legacy', config: legacyToV2(rec), legacyFieldCount: Object.keys(rec).length };
    } catch {
        return { kind: 'invalid', config: emptyConfig(), error: 'json' };
    }
}

export function serializeConfig(config: RewriteConfig): string {
    if (!config.operations.length) return '';
    return JSON.stringify({
        $schema: REWRITE_SCHEMA,
        stage: 'outbound_provider',
        enabled: config.enabled !== false,
        ...(config.allow_sensitive_headers ? { allow_sensitive_headers: true } : {}),
        ...(config.policy ? { policy: config.policy } : {}),
        operations: config.operations,
    }, null, 2);
}

export function enabledOpCount(config: RewriteConfig): number {
    return config.operations.filter((op) => op.enabled !== false).length;
}

export function opNeedsPath(op: string): boolean {
    return [
        'set', 'set_if_absent', 'delete', 'array_append', 'array_prepend', 'array_insert', 'array_remove',
        'trim_prefix', 'trim_suffix', 'ensure_prefix', 'ensure_suffix', 'trim_space', 'to_lower', 'to_upper',
        'replace', 'regex_replace', 'prune_objects', 'sync_fields',
    ].includes(op);
}

export function opNeedsFromTo(op: string): boolean {
    return op === 'move' || op === 'copy';
}

export function opNeedsHeader(op: string): boolean {
    return ['header_set', 'header_set_if_absent', 'header_add', 'header_delete', 'sync_fields'].includes(op);
}

export function opNeedsHeaderFromTo(op: string): boolean {
    return op === 'header_copy' || op === 'header_move';
}

export function opNeedsValue(op: string): boolean {
    return [
        'set', 'set_if_absent', 'array_append', 'array_prepend', 'array_insert',
        'header_set', 'header_set_if_absent', 'header_add',
        'trim_prefix', 'trim_suffix', 'ensure_prefix', 'ensure_suffix', 'header_pass',
    ].includes(op);
}

export function opNeedsItemWhen(op: string): boolean {
    return op === 'array_remove' || op === 'prune_objects';
}

export function opNeedsSearch(op: string): boolean {
    return op === 'replace';
}

export function opNeedsPattern(op: string): boolean {
    return op === 'regex_replace' || op === 'header_pass';
}

export function isSensitiveHeader(name?: string): boolean {
    if (!name) return false;
    const lower = name.toLowerCase();
    return SENSITIVE_HEADERS.includes(lower) || lower.includes('auth') || lower.includes('api-key') || lower.includes('cookie');
}

export function touchesModel(op: RewriteOperation): boolean {
    const paths = [op.path, op.from, op.to];
    return paths.some((path) => path === '/model' || path === 'model');
}

export function emptyPredicate(): ConditionExpr {
    return { source: 'body', path: '/model', operator: 'eq', value: '' };
}

export function conditionKind(expr?: ConditionExpr): 'all' | 'any' | 'not' | 'predicate' | 'empty' {
    if (!expr) return 'empty';
    if (Array.isArray(expr.all)) return 'all';
    if (Array.isArray(expr.any)) return 'any';
    if (expr.not) return 'not';
    if (expr.source || expr.operator || expr.path) return 'predicate';
    return 'empty';
}

export function cloneOp(op: RewriteOperation, nextId: string): RewriteOperation {
    return { ...structuredClone(op), id: nextId };
}

export function changeOperationType(op: RewriteOperation, next: string): RewriteOperation {
    const base: RewriteOperation = {
        id: op.id,
        name: op.name,
        enabled: op.enabled,
        op: next,
        when: op.when,
        policy: op.policy,
        path: undefined,
        from: undefined,
        to: undefined,
        header: undefined,
        from_header: undefined,
        to_header: undefined,
        value: undefined,
        value_from: undefined,
        value_template: undefined,
        index: undefined,
        splat: undefined,
        recursive: undefined,
        search: undefined,
        pattern: undefined,
        replacement: undefined,
        item_when: undefined,
        error: undefined,
    };
    if (opNeedsPath(next)) base.path = op.path || '/temperature';
    if (opNeedsFromTo(next)) {
        base.from = op.from || '/source';
        base.to = op.to || '/target';
    }
    if (opNeedsHeader(next)) base.header = op.header || 'X-Example';
    if (opNeedsHeaderFromTo(next)) {
        base.from_header = op.from_header || 'X-Source';
        base.to_header = op.to_header || 'X-Target';
    }
    if (opNeedsValue(next)) {
        if (op.value_from) base.value_from = op.value_from;
        else if (op.value_template) base.value_template = op.value_template;
        else base.value = op.value ?? '';
    }
    if (opNeedsItemWhen(next)) base.item_when = op.item_when ?? { source: 'item', path: '/type', operator: 'eq', value: '' };
    if (next === 'array_insert') base.index = op.index ?? 0;
    if (['array_append', 'array_prepend', 'array_insert'].includes(next)) base.splat = op.splat ?? true;
    if (next === 'prune_objects') base.recursive = op.recursive ?? true;
    if (next === 'replace') {
        base.search = op.search ?? '';
        base.replacement = op.replacement ?? '';
    }
    if (next === 'regex_replace' || next === 'header_pass') base.pattern = op.pattern ?? '';
    if (next === 'regex_replace') base.replacement = op.replacement ?? '';
    if (next === 'return_error') {
        base.error = op.error ?? { status: 400, code: 'request_rewrite_blocked', type: 'invalid_request_error', message: '', retry: 'stop' };
    }
    return base;
}
