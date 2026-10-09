import { describe, expect, it } from 'vitest';
import { createSessionToken, readSessionToken, type SessionUser } from '@/lib/auth/session';

const secret = 'test-secret-that-is-long-enough-0123456789';
const user: SessionUser = { id: 'u1', email: 'a@b.c', name: 'A', role: 'ADMIN' };

describe('session tokens', () =>
{
    it('round-trips a user', async () =>
    {
        const token = await createSessionToken(user, secret);
        expect(await readSessionToken(token, secret)).toEqual(user);
    });

    it('rejects a token signed with another secret', async () =>
    {
        const token = await createSessionToken(user, 'another-secret-another-secret-0123456789');
        expect(await readSessionToken(token, secret)).toBeNull();
    });

    it('rejects a tampered token', async () =>
    {
        const token = await createSessionToken(user, secret);
        const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
        expect(await readSessionToken(tampered, secret)).toBeNull();
    });

    it('rejects an expired token', async () =>
    {
        const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000);
        const token = await createSessionToken(user, secret, eightDaysAgo);
        expect(await readSessionToken(token, secret)).toBeNull();
    });

    it('returns null for missing or garbage input', async () =>
    {
        expect(await readSessionToken(undefined, secret)).toBeNull();
        expect(await readSessionToken('not-a-jwt', secret)).toBeNull();
    });

    it('rejects a payload with an unknown role', async () =>
    {
        const token = await createSessionToken({ ...user, role: 'ROOT' as never }, secret);
        expect(await readSessionToken(token, secret)).toBeNull();
    });
});
