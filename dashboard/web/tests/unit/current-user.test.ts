import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUnique = vi.fn();
const get = vi.fn();
vi.mock('@/lib/db', () => ({ prisma: { user: { findUnique } } }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get }) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), forbidden: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ SESSION_COOKIE: 's', readSessionToken: vi.fn(async (token: string | undefined) => (token ? { id: 'u1', email: 'a@b.cd', name: 'A', role: 'ADMIN' } : null)) }));

const { currentUserOrNull } = await import('@/lib/auth/guard');

beforeEach(() =>
{
    vi.clearAllMocks();
    process.env.AUTH_SECRET = 'q8Zr1vK0wX9mT4bN7cH2jL6pD3sF5gA1';
    get.mockReturnValue({ value: 'token' });
});

describe('currentUserOrNull', () =>
{
    it('is null without a session', async () =>
    {
        get.mockReturnValue(undefined);
        expect(await currentUserOrNull()).toBeNull();
        expect(findUnique).not.toHaveBeenCalled();
    });
    it('is null for a missing user row and for a disabled user', async () =>
    {
        findUnique.mockResolvedValueOnce(null);
        expect(await currentUserOrNull()).toBeNull();
        findUnique.mockResolvedValueOnce({ id: 'u1', email: 'a@b.cd', name: 'A', role: 'ADMIN', disabledAt: new Date() });
        expect(await currentUserOrNull()).toBeNull();
    });
    it('reflects the role currently in the database, not the token', async () =>
    {
        findUnique.mockResolvedValueOnce({ id: 'u1', email: 'a@b.cd', name: 'A', role: 'VIEWER', disabledAt: null });
        expect(await currentUserOrNull()).toEqual({ id: 'u1', email: 'a@b.cd', name: 'A', role: 'VIEWER' });
    });
});
