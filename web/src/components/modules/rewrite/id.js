/**
 * @typedef {{ randomUUID?: () => string, getRandomValues: <T extends ArrayBufferView | null>(array: T) => T }} OperationIdCrypto
 */

/**
 * Generate an operation ID in both secure contexts and plain HTTP pages.
 * @param {OperationIdCrypto} [source]
 */
export function createOperationId(source = globalThis.crypto) {
    if (typeof source.randomUUID === 'function') {
        return `op-${source.randomUUID().slice(0, 8)}`;
    }

    const bytes = source.getRandomValues(new Uint8Array(4));
    const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `op-${suffix}`;
}
