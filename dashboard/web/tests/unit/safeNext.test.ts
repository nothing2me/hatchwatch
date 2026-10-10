import { describe, expect, it } from 'vitest';
import { safeNext } from '@/lib/auth/safeNext';

describe('safeNext', () =>
{
    it('allows only same-site absolute paths', () =>
    {
        expect(safeNext('/cam')).toBe('/cam');
        expect(safeNext('/live/motion?device=ck1')).toBe('/live/motion?device=ck1');
        for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'cam', '/ cam', '', null, undefined, 42, `/${'a'.repeat(300)}`])
        {
            expect(safeNext(bad)).toBeNull();
        }
    });
});
