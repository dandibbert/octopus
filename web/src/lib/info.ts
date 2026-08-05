export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'v0.8.41';
export const GITHUB_REPO = process.env.NEXT_PUBLIC_GITHUB_REPO || 'https://github.com/dandibbert/octopus';

function parseVersion(value: string): number[] | null {
    const normalized = value.trim().replace(/^v/i, '').split('-', 1)[0];
    if (!/^\d+(?:\.\d+){0,2}$/.test(normalized)) return null;
    const parts = normalized.split('.').map(Number);
    while (parts.length < 3) parts.push(0);
    return parts;
}

export function compareVersions(left: string, right: string): number | null {
    const leftParts = parseVersion(left);
    const rightParts = parseVersion(right);
    if (!leftParts || !rightParts) return null;
    for (let index = 0; index < 3; index += 1) {
        if (leftParts[index] > rightParts[index]) return 1;
        if (leftParts[index] < rightParts[index]) return -1;
    }
    return 0;
}

export function versionsMatch(left: string, right: string): boolean {
    const comparison = compareVersions(left, right);
    return comparison === null ? left.trim() === right.trim() : comparison === 0;
}

export function isNewerVersion(candidate: string, current: string): boolean {
    return compareVersions(candidate, current) === 1;
}