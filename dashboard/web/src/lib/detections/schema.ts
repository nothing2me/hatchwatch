import { z } from 'zod';
import type { DetectionsView } from '@/lib/types';

export const MAX_DETECTION_BYTES = 256 * 1024;
export const MAX_OBJECTS = 50;
export const MAX_TRAILS = 50;
export const MAX_TRAIL_POINTS = 60;
/** The worker clips boxes to the picture, then rounds x and w (y and h) to 0.1 px each, so a sum can pass the edge by 0.1. */
export const FIT_SLACK_PX = 0.5;

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
}).strict().superRefine((result, context) =>
{
    // Everything must fit the picture and the frame time: the camera danger measures a track's span from these points.
    const unique = (tracks: string[]) => new Set(tracks).size === tracks.length;
    if (result.objects.some(({ box: [x, y, w, h] }) => x + w > result.width + FIT_SLACK_PX || y + h > result.height + FIT_SLACK_PX))
    {
        context.addIssue({ code: 'custom', message: 'A box does not fit the picture.' });
    }
    if (result.trails.some(({ points }) => points.some(([t, x, y], index) => t > result.at || x > result.width + FIT_SLACK_PX || y > result.height + FIT_SLACK_PX || (index > 0 && t < points[index - 1][0]))))
    {
        context.addIssue({ code: 'custom', message: 'A trail point is outside the picture, after the result or out of order.' });
    }
    if (!unique(result.objects.map(object => object.track)) || !unique(result.trails.map(trail => trail.track)))
    {
        context.addIssue({ code: 'custom', message: 'A track id is repeated.' });
    }
});

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
