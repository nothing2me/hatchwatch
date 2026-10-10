import { z } from 'zod';
import type { DetectionsView } from '@/lib/types';

export const MAX_DETECTION_BYTES = 256 * 1024;
export const MAX_OBJECTS = 50;
export const MAX_TRAILS = 50;
export const MAX_TRAIL_POINTS = 60;

const pixel = z.number().min(0).max(65535);
const box = z.tuple([pixel, pixel, pixel, pixel]);
const track = z.string().regex(/^[PT][1-9]\d{0,5}$/);
const time = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const person = z.object({ track, label: z.literal('person'), score: z.number().min(0).max(1), box }).strict();
const turtle = z.object({ track, label: z.literal('possible turtle'), box }).strict();
const trail = z.object({ track, label: z.enum(['person', 'possible turtle']), points: z.array(z.tuple([time, pixel, pixel])).min(1).max(MAX_TRAIL_POINTS) }).strict();

export const detectionsSchema = z.object({
    at: time,
    dark: z.boolean(),
    width: z.number().int().min(1).max(65535),
    height: z.number().int().min(1).max(65535),
    objects: z.array(z.discriminatedUnion('label', [person, turtle])).max(MAX_OBJECTS),
    trails: z.array(trail).max(MAX_TRAILS),
}).strict();

// The worker's result, or null. Ids and labels must agree: P = person, T = possible turtle.
export function parseDetections(value: unknown): DetectionsView | null
{
    const parsed = detectionsSchema.safeParse(value);
    if (!parsed.success)
    {
        return null;
    }
    const consistent = [...parsed.data.objects, ...parsed.data.trails].every(item => (item.track[0] === 'P') === (item.label === 'person'));
    return consistent ? parsed.data : null;
}
