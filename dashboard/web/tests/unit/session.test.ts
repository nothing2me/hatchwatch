import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { createSessionToken, readSessionToken, sessionCookieOptions, type SessionUser } from '@/lib/auth/session';

const secret = 'test-secret-that-is-long-enough-0123456789';
const user: SessionUser = { id: 'u1', email: 'a@b.c', name: 'A', role: 'ADMIN' };

describe('session tokens', () =>
{
    it('round-trips a user', async () =>
    {
        const token = await createSessionToken(user, secret);
        expect(await readSessionToken(token, secret)).toEqual(user);
    });

    it('round-trips a volunteer', async () =>
    {
        const volunteer: SessionUser = { ...user, role: 'VOLUNTEER' };
        expect(await readSessionToken(await createSessionToken(volunteer, secret), secret)).toEqual(volunteer);
    });

    it('rejects a token signed with another secret', async () =>
    {
        const token = await createSessionToken(user, 'another-secret-another-secret-0123456789');
        expect(await readSessionToken(token, secret)).toBeNull();
    });

    it('rejects a tampered token', async () =>
    {
        const token = await createSessionToken(user, secret);
        const [header, body, signature] = token.split('.');
        const middle = Math.floor(signature.length / 2);
        const flipped = signature[middle] === 'A' ? 'B' : 'A';
        const tampered = [header, body, signature.slice(0, middle) + flipped + signature.slice(middle + 1)].join('.');
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

    it('rejects a token without an expiry', async () =>
    {
        const token = await new SignJWT({ email: user.email, name: user.name, role: user.role })
            .setProtectedHeader({ alg: 'HS256' })
            .setSubject(user.id)
            .setIssuedAt()
            .sign(new TextEncoder().encode(secret));
        expect(await readSessionToken(token, secret)).toBeNull();
    });

    it('rejects a payload with an unknown role', async () =>
    {
        const token = await createSessionToken({ ...user, role: 'ROOT' as never }, secret);
        expect(await readSessionToken(token, secret)).toBeNull();
    });
});

describe('sessionCookieOptions', () =>
{
    it('forces Secure for HTTPS requests even with INSECURE_COOKIES', () =>
    {
        const previous = process.env.INSECURE_COOKIES;
        process.env.INSECURE_COOKIES = '1';
        try
        {
            expect(sessionCookieOptions({ secure: true }).secure).toBe(true);
            expect(sessionCookieOptions().secure).toBe(false);
        }
        finally
        {
            if (previous === undefined) delete process.env.INSECURE_COOKIES; else process.env.INSECURE_COOKIES = previous;
        }
    });
});
