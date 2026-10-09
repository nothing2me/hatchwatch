import { describe, expect, it } from 'vitest';
import { hasRole } from '@/lib/auth/guard';

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
