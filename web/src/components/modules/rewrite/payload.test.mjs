import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRewritePayload } from './payload.js';

test('treats an empty serialized rewrite as an empty config', () => {
    assert.deepEqual(parseRewritePayload(''), {});
    assert.deepEqual(parseRewritePayload('   '), {});
});

test('parses a serialized rewrite object', () => {
    assert.deepEqual(parseRewritePayload('{"operations":[]}'), { operations: [] });
});
