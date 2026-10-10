import type { BoardMotion } from './frameStore';

export const MOTION_HEADER = 'x-nesttrace-motion';
const MAX_LENGTH = 160;
// schemas/esp32-frame.v1.md: fixed order, one decimal, no spaces.
const V1 = /^v1;percent=(100\.0|\d{1,2}\.\d);active=([01]);box=(\d{1,5}),(\d{1,5}),(\d{1,5}),(\d{1,5})$/;

// The board's motion reading, or null when absent, malformed or another version (the frame is still accepted).
export function parseMotionHeader(value: string | null): BoardMotion | null
{
    if (!value || value.length > MAX_LENGTH)
    {
        return null;
    }
    const match = V1.exec(value.trim());
    if (!match)
    {
        return null;
    }
    const box = match.slice(3, 7).map(Number) as [number, number, number, number];
    if (box.some(n => n > 65535))
    {
        return null;
    }
    return { percent: Number(match[1]), active: match[2] === '1', box };
}
