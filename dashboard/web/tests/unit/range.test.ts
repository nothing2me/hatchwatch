import { describe, expect, it } from 'vitest';
import { parseRange } from '@/lib/range';

describe('parseRange', () =>
{
    const size = 1000;
    it('handles open-ended, bounded and suffix ranges', () =>
    {
        expect(parseRange('bytes=0-', size)).toEqual({ start: 0, end: 999 });
        expect(parseRange('bytes=100-199', size)).toEqual({ start: 100, end: 199 });
        expect(parseRange('bytes=-500', size)).toEqual({ start: 500, end: 999 });
        expect(parseRange('bytes=900-5000', size)).toEqual({ start: 900, end: 999 });
    });
    it('returns null when absent or malformed (serve whole file)', () =>
    {
        expect(parseRange(null, size)).toBeNull();
        expect(parseRange('items=0-1', size)).toBeNull();
        expect(parseRange('bytes=abc', size)).toBeNull();
        expect(parseRange('bytes=0-1,5-6', size)).toBeNull();
    });
    it('flags unsatisfiable ranges', () =>
    {
        expect(parseRange('bytes=1000-', size)).toBe('unsatisfiable');
        expect(parseRange('bytes=500-100', size)).toBe('unsatisfiable');
        expect(parseRange('bytes=-0', size)).toBe('unsatisfiable');
    });
});
