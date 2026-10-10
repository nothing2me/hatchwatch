import { describe, expect, it } from 'vitest';
import { safeNextPath } from '@/lib/auth/nextPath';

describe('safeNextPath', () =>
{
    it('keeps same-site paths', () =>
    {
        expect(safeNextPath('/cam')).toBe('/cam');
        expect(safeNextPath('/setup/cameras')).toBe('/setup/cameras');
        expect(safeNextPath('/?zone=B')).toBe('/?zone=B');
    });

    it('falls back to the map for anything that could leave the site', () =>
    {
        for (const value of ['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', 'cam', '', '/a b', null, undefined, 42, `/${'a'.repeat(300)}`])
        {
            expect(safeNextPath(value)).toBe('/');
        }
    });
});
