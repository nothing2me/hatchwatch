import { describe, expect, it, vi } from 'vitest';
import { authenticate } from '@/lib/auth/authenticate';

const row = { id: 'u1', email: 'admin@x.y', name: 'Admin', role: 'ADMIN' as const, passwordHash: 'h' };

describe('authenticate', () =>
{
    it('returns the session user for a correct password', async () =>
    {
        const user = await authenticate('ADMIN@x.y ', 'pw', {
            findUser: vi.fn().mockResolvedValue(row),
            verify: vi.fn().mockResolvedValue(true),
        });
        expect(user).toEqual({ id: 'u1', email: 'admin@x.y', name: 'Admin', role: 'ADMIN' });
    });

    it('rejects disabled users after a dummy verification', async () =>
    {
        const verify = vi.fn().mockResolvedValue(true);
        expect(await authenticate('admin@x.y', 'pw', { findUser: vi.fn().mockResolvedValue({ ...row, disabledAt: new Date() }), verify })).toBeNull();
        expect(verify).toHaveBeenCalledTimes(1);
    });

    it('normalises email before lookup', async () =>
    {
        const findUser = vi.fn().mockResolvedValue(null);
        await authenticate('  ADMIN@X.Y ', 'pw', { findUser, verify: vi.fn() });
        expect(findUser).toHaveBeenCalledWith('admin@x.y');
    });

    it('returns null for wrong password or unknown user', async () =>
    {
        expect(await authenticate('admin@x.y', 'bad', { findUser: vi.fn().mockResolvedValue(row), verify: vi.fn().mockResolvedValue(false) })).toBeNull();
        expect(await authenticate('nobody@x.y', 'pw', { findUser: vi.fn().mockResolvedValue(null), verify: vi.fn() })).toBeNull();
    });

    it('still runs a password verification against the dummy hash for an unknown user', async () =>
    {
        const verify = vi.fn().mockResolvedValue(false);
        expect(await authenticate('nobody@x.y', 'pw', { findUser: vi.fn().mockResolvedValue(null), verify })).toBeNull();
        expect(verify).toHaveBeenCalledWith(expect.stringMatching(/^\$argon2id\$/), 'pw');
    });
});
