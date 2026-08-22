export type OperationIdCrypto = {
    randomUUID?: () => string;
    getRandomValues: <T extends ArrayBufferView | null>(array: T) => T;
};

export function createOperationId(source?: OperationIdCrypto): string;
