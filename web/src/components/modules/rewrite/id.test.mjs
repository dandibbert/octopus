import assert from 'node:assert/strict';
import test from 'node:test';
import { createOperationId } from './id.js';

test('uses randomUUID when the page is a secure context', () => {
    const id = createOperationId({
        randomUUID: () => '12345678-abcd-4000-8000-123456789abc',
        getRandomValues: (array) => array,
    });
    assert.equal(id, 'op-12345678');
});

test('falls back to getRandomValues on plain HTTP pages', () => {
    const id = createOperationId({
        getRandomValues: (array) => {
            array.set([0xde, 0xad, 0xbe, 0xef]);
            return array;
        },
    });
    assert.equal(id, 'op-deadbeef');
});
