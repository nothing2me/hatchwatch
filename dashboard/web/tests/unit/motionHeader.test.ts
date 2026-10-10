import { describe, expect, it } from 'vitest';
import { MOTION_HEADER, parseMotionHeader } from '@/lib/phones/motionHeader';

describe('X-NestTrace-Motion v1', () =>
{
    it('parses the firmware format', () =>
    {
        expect(MOTION_HEADER).toBe('x-nesttrace-motion');
        expect(parseMotionHeader('v1;percent=4.2;active=1;box=96,40,64,72')).toEqual({ percent: 4.2, active: true, box: [96, 40, 64, 72] });
        expect(parseMotionHeader('v1;percent=0.0;active=0;box=0,0,0,0')).toEqual({ percent: 0, active: false, box: [0, 0, 0, 0] });
        expect(parseMotionHeader('v1;percent=100.0;active=1;box=0,0,320,240')).toEqual({ percent: 100, active: true, box: [0, 0, 320, 240] });
        expect(parseMotionHeader(' v1;percent=1.5;active=0;box=1,2,3,4 ')?.percent).toBe(1.5);
    });

    it('ignores missing, malformed and unknown versions', () =>
    {
        for (const value of [
            null, '', 'v2;percent=4.2;active=1;box=1,2,3,4', 'V1;percent=4.2;active=1;box=1,2,3,4',
            'v1;percent=4;active=1;box=1,2,3,4', 'v1;percent=4.25;active=1;box=1,2,3,4', 'v1;percent=100.1;active=1;box=1,2,3,4',
            'v1;percent=-1.0;active=1;box=1,2,3,4', 'v1;percent=4.2;active=2;box=1,2,3,4', 'v1;percent=4.2;active=1;box=1,2,3',
            'v1;percent=4.2;active=1;box=1,2,3,65536', 'v1;percent=4.2;active=1;box=1,2,3,-4', 'v1;active=1;percent=4.2;box=1,2,3,4',
            'v1; percent=4.2;active=1;box=1,2,3,4', 'v1;percent=4.2;active=1;box=1,2,3,4;extra=1', 'v1;percent=4.2;active=1;box=1,2,3,4'.padEnd(161, ' '),
        ])
        {
            expect(parseMotionHeader(value), String(value)).toBeNull();
        }
    });
});
