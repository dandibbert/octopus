import assert from 'node:assert/strict';
import test from 'node:test';

import {
    BUILTIN_REWRITE_TEMPLATES,
    findUneditedBuiltinPlaceholder,
} from './builtinTemplates.js';

const sensitiveHeaders = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'api-key']);

test('built-in examples declare intentional scopes instead of forcing every template into groups', () => {
    const validScopes = new Set(['channel', 'group']);
    for (const template of BUILTIN_REWRITE_TEMPLATES) {
        assert.ok(template.scopes.length > 0, `${template.key} has no scope`);
        for (const scope of template.scopes) assert.ok(validScopes.has(scope), `${template.key} has invalid scope ${scope}`);
    }
    const openRouter = BUILTIN_REWRITE_TEMPLATES.find((template) => template.key === 'openrouter-app-headers');
    const streamOptions = BUILTIN_REWRITE_TEMPLATES.find((template) => template.key === 'remove-openai-stream-options');
    const serviceTier = BUILTIN_REWRITE_TEMPLATES.find((template) => template.key === 'remove-service-tier');
    assert.deepEqual(openRouter?.scopes, ['channel']);
    assert.deepEqual(streamOptions?.scopes, ['channel']);
    assert.deepEqual(serviceTier?.scopes, ['channel']);
});

test('built-in examples have unique keys, metadata, and valid non-empty v2 configs', () => {
    const keys = new Set();
    for (const template of BUILTIN_REWRITE_TEMPLATES) {
        assert.ok(!keys.has(template.key), `duplicate key: ${template.key}`);
        keys.add(template.key);
        assert.ok(template.nameKey);
        assert.ok(template.descriptionKey);
        assert.ok(['policy', 'compatibility', 'provider', 'advanced'].includes(template.category));
        assert.ok(['low', 'medium', 'high'].includes(template.risk));
        assert.ok(template.targetFormats.length > 0);
        assert.equal(template.config.$schema, 'octopus.request-rewrite/v2');
        assert.equal(template.config.stage, 'outbound_provider');
        assert.ok(template.config.operations.length > 0);
        assert.equal(new Set(template.config.operations.map((operation) => operation.id)).size, template.config.operations.length);
    }
});

test('built-in examples never contain reusable credentials or sensitive headers', () => {
    for (const template of BUILTIN_REWRITE_TEMPLATES) {
        const serialized = JSON.stringify(template.config).toLowerCase();
        assert.ok(!serialized.includes('bearer '));
        assert.ok(!serialized.includes('sk-'));
        for (const operation of template.config.operations) {
            for (const header of [operation.header, operation.from_header, operation.to_header]) {
                if (header) assert.ok(!sensitiveHeaders.has(header.toLowerCase()), `${template.key} contains ${header}`);
            }
        }
    }
});

test('output defaults never overwrite clients or write legacy fields to reasoning Chat models', () => {
    const outputLimit = BUILTIN_REWRITE_TEMPLATES.find((template) => template.key === 'default-openai-output-limit');
    const paths = new Map(outputLimit?.config.operations.map((operation) => [operation.path, operation]));
    assert.equal(paths.get('/max_tokens')?.op, 'set_if_absent');
    assert.equal(paths.get('/max_output_tokens')?.op, 'set_if_absent');
    assert.ok(paths.get('/max_tokens')?.when?.all?.some((condition) => condition.not));
});

test('provider cleanup is split so service_tier remains an explicit high-risk choice', () => {
    const streamOptions = BUILTIN_REWRITE_TEMPLATES.find((template) => template.key === 'remove-openai-stream-options');
    const serviceTier = BUILTIN_REWRITE_TEMPLATES.find((template) => template.key === 'remove-service-tier');
    assert.deepEqual(streamOptions?.config.operations.map((operation) => operation.path), ['/stream_options']);
    assert.deepEqual(serviceTier?.config.operations.map((operation) => operation.path), ['/service_tier']);
    assert.equal(serviceTier?.risk, 'high');
});

test('o-series compatibility covers provider-prefixed model names and stays OpenAI Chat scoped', () => {
    const template = BUILTIN_REWRITE_TEMPLATES.find((item) => item.key === 'openai-o-series-sampling-compatibility');
    const predicate = template?.config.operations[0].when?.all?.find((condition) => condition.operator === 'regex');
    assert.ok(predicate?.value);
    const pattern = new RegExp(predicate.value, 'i');
    for (const model of ['o3', 'o4-mini', 'openai/o4-mini', 'router/openai/o1-preview']) assert.ok(pattern.test(model), model);
    for (const model of ['gpt-4o', 'gpt-5', 'claude-o3']) assert.ok(!pattern.test(model), model);
    assert.ok(template?.config.operations.every((operation) =>
        operation.when?.all?.some((condition) => condition.path === 'route.outbound_format' && condition.value === 'openai_chat'),
    ));
});

test('Kimi fixed sampling compatibility removes all fixed sampling knobs from constrained model families', () => {
    const template = BUILTIN_REWRITE_TEMPLATES.find((item) => item.key === 'kimi-fixed-sampling-compatibility');
    assert.ok(template);
    assert.deepEqual(template.scopes, ['channel', 'group']);
    assert.deepEqual(
        template.config.operations.map((operation) => [operation.op, operation.path]),
        [
            ['delete', '/temperature'],
            ['delete', '/top_p'],
            ['delete', '/n'],
            ['delete', '/presence_penalty'],
            ['delete', '/frequency_penalty'],
        ],
    );
    assert.ok(template.config.operations.every((operation) => operation.policy?.on_missing === 'skip'));
    const predicate = template.config.operations[0].when.all.find((condition) => condition.operator === 'regex');
    const pattern = new RegExp(predicate.value, 'i');
    for (const model of ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k2.6', 'kimi-k2.5', 'openrouter/moonshotai/kimi-k2.6']) {
        assert.ok(pattern.test(model), model);
    }
    for (const model of ['moonshot-v1-128k', 'kimi-k2-thinking', 'gpt-5', 'my-kimi-k3-copy']) {
        assert.ok(!pattern.test(model), model);
    }
});

test('web search template covers Responses without duplicating existing server tools', () => {
    const template = BUILTIN_REWRITE_TEMPLATES.find((item) => item.key === 'ensure-openai-web-search');
    assert.ok(template);
    assert.deepEqual(template.scopes, ['channel']);
    assert.deepEqual(template.targetFormats, ['openai_responses']);
    assert.equal(template.config.operations.length, 1);

    const responses = template.config.operations[0];
    assert.equal(responses.path, '/tools');
    assert.deepEqual(responses.value, { type: 'web_search' });
    const noneValues = responses.when.all
        .filter((condition) => condition.operator === 'none_eq')
        .map((condition) => condition.value)
        .sort();
    assert.deepEqual(noneValues, [
        'web_search',
        'web_search_2025_08_26',
        'web_search_preview',
        'web_search_preview_2025_03_11',
    ]);
    assert.equal(template.risk, 'high');
});

test('Anthropic web search template adds the server tool and merges the required beta header', () => {
    const template = BUILTIN_REWRITE_TEMPLATES.find((item) => item.key === 'ensure-anthropic-web-search');
    assert.ok(template);
    assert.deepEqual(template.scopes, ['channel']);
    assert.deepEqual(template.targetFormats, ['anthropic_messages']);
    assert.equal(template.risk, 'high');

    const [tool, setBeta, mergeBeta] = template.config.operations;
    assert.equal(tool.op, 'array_append');
    assert.equal(tool.path, '/tools');
    assert.deepEqual(tool.value, { type: 'web_search_20250305', name: 'web_search' });
    assert.ok(tool.when.all.some((condition) => condition.path === '/tools/*/type' && condition.operator === 'none_eq' && condition.value === 'web_search_20250305'));
    assert.ok(tool.when.all.some((condition) => condition.path === '/tools/*/name' && condition.operator === 'none_eq' && condition.value === 'web_search'));

    assert.equal(setBeta.op, 'header_set_if_absent');
    assert.equal(setBeta.header, 'Anthropic-Beta');
    assert.equal(setBeta.value, 'web-search-2025-03-05');
    assert.equal(mergeBeta.op, 'header_set');
    assert.equal(mergeBeta.header, 'Anthropic-Beta');
    assert.equal(mergeBeta.value_template, '${header:Anthropic-Beta},web-search-2025-03-05');
    assert.ok(mergeBeta.when.all.some((condition) => condition.not?.operator === 'contains' && condition.not?.value === 'web-search-2025-03-05'));
});

test('OpenRouter attribution uses current headers and blocks untouched placeholders', () => {
    const template = BUILTIN_REWRITE_TEMPLATES.find((item) => item.key === 'openrouter-app-headers');
    assert.equal(template?.requiresEdit, true);
    assert.deepEqual(template?.config.operations.map((operation) => operation.header), ['HTTP-Referer', 'X-OpenRouter-Title']);
    assert.equal(findUneditedBuiltinPlaceholder(template.config)?.header, 'HTTP-Referer');

    const edited = structuredClone(template.config);
    edited.operations[0].value = 'https://my-app.example';
    edited.operations[1].value = 'My Real App';
    assert.equal(findUneditedBuiltinPlaceholder(edited), null);
});

test('placeholder protection survives operation ID suffixes added while appending templates', () => {
    const template = BUILTIN_REWRITE_TEMPLATES.find((item) => item.key === 'openrouter-app-headers');
    const appended = structuredClone(template.config);
    appended.operations[0].id = 'openrouter-http-referer-2';
    appended.operations[1].id = 'openrouter-title-2';
    assert.equal(findUneditedBuiltinPlaceholder(appended)?.header, 'HTTP-Referer');

    appended.operations[0].value = 'https://my-app.example';
    assert.equal(findUneditedBuiltinPlaceholder(appended)?.header, 'X-OpenRouter-Title');

    appended.operations[1].value = 'My Real App';
    assert.equal(findUneditedBuiltinPlaceholder(appended), null);

    const customSuffix = structuredClone(template.config);
    customSuffix.operations[0].id = 'openrouter-http-referer-custom';
    customSuffix.operations[1].value = 'My Real App';
    assert.equal(findUneditedBuiltinPlaceholder(customSuffix), null);
});

test('placeholder protection only applies to enabled operations from the built-in OpenRouter example', () => {
    const manual = {
        $schema: 'octopus.request-rewrite/v2',
        stage: 'outbound_provider',
        enabled: true,
        operations: [{
            id: 'manual-reference',
            op: 'header_set_if_absent',
            header: 'HTTP-Referer',
            value: 'https://example.com',
        }],
    };
    assert.equal(findUneditedBuiltinPlaceholder(manual), null);

    const template = BUILTIN_REWRITE_TEMPLATES.find((item) => item.key === 'openrouter-app-headers');
    const disabledConfig = structuredClone(template.config);
    disabledConfig.enabled = false;
    assert.equal(findUneditedBuiltinPlaceholder(disabledConfig), null);

    const disabledOperation = structuredClone(template.config);
    disabledOperation.operations[0].enabled = false;
    disabledOperation.operations[1].value = 'My Real App';
    assert.equal(findUneditedBuiltinPlaceholder(disabledOperation), null);

    const wrongType = structuredClone(template.config);
    wrongType.operations[0].op = 'header_delete';
    wrongType.operations[1].value = 'My Real App';
    assert.equal(findUneditedBuiltinPlaceholder(wrongType), null);
});

test('OpenRouter attribution operations enforce every advertised target format at runtime', () => {
    const template = BUILTIN_REWRITE_TEMPLATES.find((item) => item.key === 'openrouter-app-headers');
    assert.deepEqual(template.targetFormats, ['openai_chat', 'openai_responses']);
    for (const operation of template.config.operations) {
        const formats = operation.when?.any
            ?.filter((condition) => condition.path === 'route.outbound_format' && condition.operator === 'eq')
            .map((condition) => condition.value)
            .sort();
        assert.deepEqual(formats, [...template.targetFormats].sort(), operation.id);
    }
});

test('service_tier cleanup only advertises formats where the field is meaningful', () => {
    const template = BUILTIN_REWRITE_TEMPLATES.find((item) => item.key === 'remove-service-tier');
    assert.deepEqual(template.targetFormats, ['openai_chat', 'openai_responses']);
    const formats = template.config.operations[0].when.any.map((condition) => condition.value).sort();
    assert.deepEqual(formats, [...template.targetFormats].sort());
});
