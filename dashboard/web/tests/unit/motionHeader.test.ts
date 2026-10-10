import { describe, expect, it } from 'vitest';
import { MOTION_HEADER, motionHeaderValue, parseMotionHeader } from '@/lib/phones/motionHeader';

describe('X-HatchWatch-Motion v1', () =>
{
    it('reads the new header, falls back to the one boards flashed before the rename send, and prefers the new one', () =>
    {
        expect(MOTION_HEADER).toBe('x-hatchwatch-motion');
        expect(motionHeaderValue(new Headers({ 'X-HatchWatch-Motion': 'new' }))).toBe('new');
        expect(motionHeaderValue(new Headers({ 'X-NestTrace-Motion': 'old' }))).toBe('old');
        expect(motionHeaderValue(new Headers({ 'X-NestTrace-Motion': 'old', 'X-HatchWatch-Motion': 'new' }))).toBe('new');
        expect(motionHeaderValue(new Headers())).toBeNull();
    });

    it('parses the firmware format', () =>
    {
        expect(parseMotionHeader('v1;percent=4.2;active=1;box=96,40,64,72')).toEqual({ percent: 4.2, active: true, box: [96, 40, 64, 72] });
        expect(parseMotionHeader('v1;percent=0.0;active=0;box=0,0,0,0')).toEqual({ percent: 0, active: false, box: [0, 0, 0, 0] });
        expect(parseMotionHeader('v1;percent=100.0;active=1;box=0,0,320,240')).toEqual({ percent: 100, active: true, box: [0, 0, 320, 240] });
        for (const [percent, value] of [['0.0', 0], ['9.5', 9.5], ['100.0', 100]] as const)
        {
            expect(parseMotionHeader(`v1;percent=${percent};active=1;box=0,0,0,0`)?.percent).toBe(value);
        }
        expect(parseMotionHeader('v1;percent=4.2;active=1;box=10,0,65535,9')?.box).toEqual([10, 0, 65535, 9]);
        expect(parseMotionHeader(' v1;percent=1.5;active=0;box=1,2,3,4 ')?.percent).toBe(1.5);
    });

    it('ignores missing, malformed and unknown versions', () =>
    {
        for (const value of [
            null, '', 'v2;percent=4.2;active=1;box=1,2,3,4', 'V1;percent=4.2;active=1;box=1,2,3,4',
            'v1;percent=4;active=1;box=1,2,3,4', 'v1;percent=4.25;active=1;box=1,2,3,4', 'v1;percent=100.1;active=1;box=1,2,3,4',
            'v1;percent=-1.0;active=1;box=1,2,3,4', 'v1;percent=4.2;active=2;box=1,2,3,4', 'v1;percent=4.2;active=1;box=1,2,3',
            'v1;percent=4.2;active=1;box=1,2,3,65536', 'v1;percent=4.2;active=1;box=1,2,3,-4', 'v1;active=1;percent=4.2;box=1,2,3,4',
            'v1;percent=05.0;active=1;box=0,0,0,0', 'v1;percent=00.0;active=0;box=0,0,0,0', 'v1;percent=4.2;active=1;box=01,0,0,0',
            'v1;percent=4.2;active=1;box=0,0,0096,4', 'v1; percent=4.2;active=1;box=1,2,3,4', 'v1;percent=4.2;active=1;box=1,2,3,4;extra=1', 'v1;percent=4.2;active=1;box=1,2,3,4'.padEnd(161, ' '),
        ])
        {
            expect(parseMotionHeader(value), String(value)).toBeNull();
        }
    });
});
