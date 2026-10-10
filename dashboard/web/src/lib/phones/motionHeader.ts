import { LEGACY_MOTION_HEADER } from '@/lib/legacyNames';
import type { BoardMotion } from './frameStore';

export const MOTION_HEADER = 'x-hatchwatch-motion';
const MAX_LENGTH = 160;
// schemas/esp32-frame.v1.md: fixed order, one decimal, no spaces, no leading zeros.
const V1 = /^v1;percent=(100\.0|[1-9]?\d\.\d);active=([01]);box=(0|[1-9]\d{0,4}),(0|[1-9]\d{0,4}),(0|[1-9]\d{0,4}),(0|[1-9]\d{0,4})$/;

/** The new header wins; boards flashed before the rename keep sending the old one (schemas/esp32-frame.v1.md). */
export function motionHeaderValue(headers: Headers): string | null
{
    return headers.get(MOTION_HEADER) ?? headers.get(LEGACY_MOTION_HEADER);
}

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
