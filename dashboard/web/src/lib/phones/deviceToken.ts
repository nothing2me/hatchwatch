import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOKEN_BYTES = 32;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const HASH_SHAPE = /^[0-9a-f]{64}$/;
const NO_HASH = Buffer.alloc(32);

export function hashDeviceToken(token: string): string
{
    return createHash('sha256').update(token, 'utf8').digest('hex');
}

// A new board token; only the hash is ever stored.
export function newDeviceToken(): { token: string; hash: string }
{
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    return { token, hash: hashDeviceToken(token) };
}

// Always hashes and compares in constant time, even for a malformed token or a missing hash, so timing says nothing.
export function tokenMatches(token: string, storedHash: string | null): boolean
{
    const wellFormed = TOKEN_SHAPE.test(token) && storedHash !== null && HASH_SHAPE.test(storedHash);
    const presented = Buffer.from(hashDeviceToken(token), 'hex');
    const stored = wellFormed && storedHash ? Buffer.from(storedHash, 'hex') : NO_HASH;
    return timingSafeEqual(presented, stored) && wellFormed;
}

export function bearerToken(headers: Headers): string | null
{
    const match = /^Bearer +(\S+)\s*$/i.exec(headers.get('authorization') ?? '');
    return match ? match[1] : null;
}
