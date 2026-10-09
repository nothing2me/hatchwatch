import { afterEach, describe, expect, it } from 'vitest';
import { authSecret, hasRole } from '@/lib/auth/guard';

describe('hasRole', () =>
{
    const admin = { id: '1', email: 'a@x.y', name: 'A', role: 'ADMIN' as const };
    const viewer = { id: '2', email: 'v@x.y', name: 'V', role: 'VIEWER' as const };

    it('admin satisfies both roles', () =>
    {
        expect(hasRole(admin, 'ADMIN')).toBe(true);
        expect(hasRole(admin, 'VIEWER')).toBe(true);
    });

    it('viewer satisfies only VIEWER', () =>
    {
        expect(hasRole(viewer, 'VIEWER')).toBe(true);
        expect(hasRole(viewer, 'ADMIN')).toBe(false);
    });

    it('no session satisfies nothing', () =>
    {
        expect(hasRole(null, 'VIEWER')).toBe(false);
    });
});

describe('authSecret', () =>
{
    const original = process.env.AUTH_SECRET;
    afterEach(() =>
    {
        process.env.AUTH_SECRET = original;
    });

    it('rejects the placeholder from .env.example', () =>
    {
        process.env.AUTH_SECRET = 'change-me-to-32-plus-random-bytes';
        expect(() => authSecret()).toThrow(/placeholder/);
    });

    it('rejects short secrets and accepts a real one', () =>
    {
        process.env.AUTH_SECRET = 'short';
        expect(() => authSecret()).toThrow();
        process.env.AUTH_SECRET = 'q8Zr1vK0wX9mT4bN7cH2jL6pD3sF5gA1';
        expect(authSecret()).toBe('q8Zr1vK0wX9mT4bN7cH2jL6pD3sF5gA1');
    });
});
