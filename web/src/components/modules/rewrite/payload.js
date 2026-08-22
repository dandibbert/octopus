export function parseRewritePayload(serialized) {
    return serialized.trim() ? JSON.parse(serialized) : {};
}
