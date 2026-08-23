const baseConfig = (operations) => ({
    $schema: 'octopus.request-rewrite/v2',
    stage: 'outbound_provider',
    enabled: true,
    operations,
});

const outboundFormatIs = (value) => ({
    source: 'context',
    path: 'route.outbound_format',
    operator: 'eq',
    value,
});

const modelMatches = (value) => ({
    source: 'body',
    path: '/model',
    operator: 'regex',
    value,
    case_sensitive: false,
});

// Keep policy defaults away from model families that may reject Chat
// Completions sampling parameters or use max_completion_tokens instead.
const OPENAI_REASONING_MODEL_PATTERN = '(^|.*/)(o1|o3|o4|gpt-5)([-_.].*)?$';
const OPENAI_O_SERIES_MODEL_PATTERN = '(^|.*/)(o1|o3|o4)([-_.].*)?$';
const KIMI_FIXED_SAMPLING_PATTERN = '(^|.*/)(kimi-k3|kimi-k2\\.7-code(?:-highspeed)?|kimi-k2\\.6|kimi-k2\\.5)$';

const kimiFixedSamplingWhen = () => ({
    all: [
        outboundFormatIs('openai_chat'),
        modelMatches(KIMI_FIXED_SAMPLING_PATTERN),
    ],
});

const nonReasoningOpenAIChat = () => ({
    all: [
        outboundFormatIs('openai_chat'),
        { not: modelMatches(OPENAI_REASONING_MODEL_PATTERN) },
    ],
});

export const BUILTIN_REWRITE_TEMPLATES = [
    {
        key: 'kimi-fixed-sampling-compatibility',
        nameKey: 'builtinTemplateKimiSamplingName',
        descriptionKey: 'builtinTemplateKimiSamplingDescription',
        category: 'compatibility',
        risk: 'low',
        scopes: ['channel', 'group'],
        targetFormats: ['openai_chat'],
        providerHint: 'Kimi',
        config: baseConfig([
            {
                id: 'kimi-remove-temperature',
                op: 'delete',
                path: '/temperature',
                when: kimiFixedSamplingWhen(),
                policy: { on_missing: 'skip' },
            },
            {
                id: 'kimi-remove-top-p',
                op: 'delete',
                path: '/top_p',
                when: kimiFixedSamplingWhen(),
                policy: { on_missing: 'skip' },
            },
            {
                id: 'kimi-remove-n',
                op: 'delete',
                path: '/n',
                when: kimiFixedSamplingWhen(),
                policy: { on_missing: 'skip' },
            },
            {
                id: 'kimi-remove-presence-penalty',
                op: 'delete',
                path: '/presence_penalty',
                when: kimiFixedSamplingWhen(),
                policy: { on_missing: 'skip' },
            },
            {
                id: 'kimi-remove-frequency-penalty',
                op: 'delete',
                path: '/frequency_penalty',
                when: kimiFixedSamplingWhen(),
                policy: { on_missing: 'skip' },
            },
        ]),
    },
    {
        key: 'default-openai-output-limit',
        nameKey: 'builtinTemplateDefaultOutputLimitName',
        descriptionKey: 'builtinTemplateDefaultOutputLimitDescription',
        category: 'policy',
        risk: 'medium',
        scopes: ['channel', 'group'],
        targetFormats: ['openai_chat', 'openai_responses'],
        config: baseConfig([
            {
                id: 'default-openai-chat-max-tokens',
                op: 'set_if_absent',
                path: '/max_tokens',
                value: 4096,
                when: nonReasoningOpenAIChat(),
            },
            {
                id: 'default-openai-responses-max-output-tokens',
                op: 'set_if_absent',
                path: '/max_output_tokens',
                value: 4096,
                when: outboundFormatIs('openai_responses'),
            },
        ]),
    },
    {
        key: 'ensure-openai-web-search',
        nameKey: 'builtinTemplateEnsureWebSearchName',
        descriptionKey: 'builtinTemplateEnsureWebSearchDescription',
        category: 'provider',
        risk: 'high',
        scopes: ['channel'],
        targetFormats: ['openai_responses'],
        providerHint: 'OpenAI',
        config: baseConfig([
            {
                id: 'ensure-openai-responses-web-search',
                op: 'array_append',
                path: '/tools',
                value: { type: 'web_search' },
                splat: false,
                when: {
                    all: [
                        outboundFormatIs('openai_responses'),
                        { source: 'body', path: '/tools/*/type', operator: 'none_eq', value: 'web_search' },
                        { source: 'body', path: '/tools/*/type', operator: 'none_eq', value: 'web_search_preview' },
                        { source: 'body', path: '/tools/*/type', operator: 'none_eq', value: 'web_search_2025_08_26' },
                        { source: 'body', path: '/tools/*/type', operator: 'none_eq', value: 'web_search_preview_2025_03_11' },
                    ],
                },
            },
        ]),
    },
    {
        key: 'ensure-anthropic-web-search',
        nameKey: 'builtinTemplateEnsureAnthropicWebSearchName',
        descriptionKey: 'builtinTemplateEnsureAnthropicWebSearchDescription',
        category: 'provider',
        risk: 'high',
        scopes: ['channel'],
        targetFormats: ['anthropic_messages'],
        providerHint: 'Anthropic / Kimi',
        config: baseConfig([
            {
                id: 'ensure-anthropic-web-search-tool',
                op: 'array_append',
                path: '/tools',
                value: { type: 'web_search_20250305', name: 'web_search' },
                splat: false,
                when: {
                    all: [
                        outboundFormatIs('anthropic_messages'),
                        { source: 'body', path: '/tools/*/type', operator: 'none_eq', value: 'web_search_20250305' },
                        { source: 'body', path: '/tools/*/name', operator: 'none_eq', value: 'web_search' },
                    ],
                },
            },
            {
                id: 'ensure-anthropic-web-search-beta',
                op: 'header_set_if_absent',
                header: 'Anthropic-Beta',
                value: 'web-search-2025-03-05',
                when: outboundFormatIs('anthropic_messages'),
            },
            {
                id: 'merge-anthropic-web-search-beta',
                op: 'header_set',
                header: 'Anthropic-Beta',
                value_template: '${header:Anthropic-Beta},web-search-2025-03-05',
                when: {
                    all: [
                        outboundFormatIs('anthropic_messages'),
                        { source: 'header', path: 'Anthropic-Beta', operator: 'exists' },
                        {
                            not: {
                                source: 'header',
                                path: 'Anthropic-Beta',
                                operator: 'contains',
                                value: 'web-search-2025-03-05',
                                case_sensitive: false,
                            },
                        },
                    ],
                },
            },
        ]),
    },
    {
        key: 'remove-openai-stream-options',
        nameKey: 'builtinTemplateRemoveStreamOptionsName',
        descriptionKey: 'builtinTemplateRemoveStreamOptionsDescription',
        category: 'compatibility',
        risk: 'medium',
        scopes: ['channel'],
        targetFormats: ['openai_chat'],
        config: baseConfig([
            {
                id: 'remove-openai-stream-options',
                op: 'delete',
                path: '/stream_options',
                when: outboundFormatIs('openai_chat'),
                policy: { on_missing: 'skip' },
            },
        ]),
    },
    {
        key: 'remove-service-tier',
        nameKey: 'builtinTemplateRemoveServiceTierName',
        descriptionKey: 'builtinTemplateRemoveServiceTierDescription',
        category: 'advanced',
        risk: 'high',
        scopes: ['channel'],
        targetFormats: ['openai_chat', 'openai_responses'],
        config: baseConfig([
            {
                id: 'remove-service-tier',
                op: 'delete',
                path: '/service_tier',
                when: {
                    any: [
                        outboundFormatIs('openai_chat'),
                        outboundFormatIs('openai_responses'),
                    ],
                },
                policy: { on_missing: 'skip' },
            },
        ]),
    },
    {
        key: 'openai-o-series-sampling-compatibility',
        nameKey: 'builtinTemplateReasoningCompatibilityName',
        descriptionKey: 'builtinTemplateReasoningCompatibilityDescription',
        category: 'compatibility',
        risk: 'low',
        scopes: ['channel', 'group'],
        targetFormats: ['openai_chat'],
        config: baseConfig([
            {
                id: 'reasoning-remove-temperature',
                op: 'delete',
                path: '/temperature',
                when: {
                    all: [
                        outboundFormatIs('openai_chat'),
                        modelMatches(OPENAI_O_SERIES_MODEL_PATTERN),
                    ],
                },
                policy: { on_missing: 'skip' },
            },
            {
                id: 'reasoning-remove-top-p',
                op: 'delete',
                path: '/top_p',
                when: {
                    all: [
                        outboundFormatIs('openai_chat'),
                        modelMatches(OPENAI_O_SERIES_MODEL_PATTERN),
                    ],
                },
                policy: { on_missing: 'skip' },
            },
        ]),
    },
    {
        key: 'openrouter-app-headers',
        nameKey: 'builtinTemplateOpenRouterHeadersName',
        descriptionKey: 'builtinTemplateOpenRouterHeadersDescription',
        category: 'provider',
        risk: 'medium',
        scopes: ['channel'],
        targetFormats: ['openai_chat', 'openai_responses'],
        providerHint: 'OpenRouter',
        requiresEdit: true,
        config: baseConfig([
            {
                id: 'openrouter-http-referer',
                op: 'header_set_if_absent',
                header: 'HTTP-Referer',
                value: 'https://example.com',
                when: {
                    any: [
                        outboundFormatIs('openai_chat'),
                        outboundFormatIs('openai_responses'),
                    ],
                },
            },
            {
                id: 'openrouter-title',
                op: 'header_set_if_absent',
                header: 'X-OpenRouter-Title',
                value: 'My App',
                when: {
                    any: [
                        outboundFormatIs('openai_chat'),
                        outboundFormatIs('openai_responses'),
                    ],
                },
            },
        ]),
    },
];

const REQUIRED_EDIT_VALUES = [
    { operationId: 'openrouter-http-referer', op: 'header_set_if_absent', header: 'HTTP-Referer', value: 'https://example.com' },
    { operationId: 'openrouter-title', op: 'header_set_if_absent', header: 'X-OpenRouter-Title', value: 'My App' },
];

export function builtinTemplatesForScope(scope) {
    return BUILTIN_REWRITE_TEMPLATES.filter((template) => template.scopes.includes(scope));
}

function matchesBuiltinOperationId(operationId, builtinId) {
    return operationId === builtinId || new RegExp(`^${builtinId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`).test(operationId);
}

export function findUneditedBuiltinPlaceholder(config) {
    if (config.enabled === false) return null;
    for (const operation of config.operations ?? []) {
        if (operation.enabled === false) continue;
        for (const placeholder of REQUIRED_EDIT_VALUES) {
            if (
                matchesBuiltinOperationId(operation.id, placeholder.operationId) &&
                operation.op === placeholder.op &&
                typeof operation.header === 'string' &&
                operation.header.toLowerCase() === placeholder.header.toLowerCase() &&
                operation.value === placeholder.value
            ) {
                return { operationId: operation.id, header: placeholder.header };
            }
        }
    }
    return null;
}
