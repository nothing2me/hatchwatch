import { describe, expect, it, vi } from 'vitest';

vi.mock('node:crypto', async importOriginal =>
{
    const real = await importOriginal<typeof import('node:crypto')>();
    return { ...real, timingSafeEqual: vi.fn(real.timingSafeEqual) };
});
const crypto = await import('node:crypto');
const { bearerToken, hashDeviceToken, newDeviceToken, tokenMatches, TOKEN_BYTES } = await import('@/lib/phones/deviceToken');

describe('device tokens', () =>
{
    it('makes 32 random bytes as base64url and stores only the SHA-256 hex', () =>
    {
        expect(TOKEN_BYTES).toBe(32);
        const { token, hash } = newDeviceToken();
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(Buffer.from(token, 'base64url')).toHaveLength(32);
        expect(hash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
        expect(newDeviceToken().token).not.toBe(token);
    });

    it('matches only the right token, always through timingSafeEqual', () =>
    {
        const { token, hash } = newDeviceToken();
        const other = newDeviceToken().token;
        const compare = vi.mocked(crypto.timingSafeEqual);
        compare.mockClear();
        expect(tokenMatches(token, hash)).toBe(true);
        expect(tokenMatches(other, hash)).toBe(false);
        expect(tokenMatches('short', hash)).toBe(false);
        expect(tokenMatches(token, null)).toBe(false);
        expect(tokenMatches(token, 'not-hex')).toBe(false);
        expect(tokenMatches(token, hash.toUpperCase())).toBe(false);
        expect(compare).toHaveBeenCalledTimes(6);
    });

    it('reads only a Bearer authorization', () =>
    {
        expect(bearerToken(new Headers({ authorization: 'Bearer abc_DEF-1' }))).toBe('abc_DEF-1');
        expect(bearerToken(new Headers({ authorization: 'bearer   abc' }))).toBe('abc');
        expect(bearerToken(new Headers({ authorization: 'Basic abc' }))).toBeNull();
        expect(bearerToken(new Headers({ authorization: 'Bearer' }))).toBeNull();
        expect(bearerToken(new Headers({ authorization: 'Bearer a b' }))).toBeNull();
        expect(bearerToken(new Headers())).toBeNull();
        expect(hashDeviceToken('a')).toHaveLength(64);
    });
});
