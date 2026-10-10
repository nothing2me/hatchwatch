import { describe, expect, it } from 'vitest';
import { MAX_TRAIL_POINTS, parseDetections } from '@/lib/detections/schema';

const valid = {
    at: 1_760_000_000_000, dark: false, width: 320, height: 240,
    objects: [
        { track: 'P1', label: 'person', score: 0.82, box: [194, 104, 31, 86] },
        { track: 'T1', label: 'possible turtle', box: [40.5, 120, 48, 24] },
    ],
    trails: [
        { track: 'P1', label: 'person', points: [[1_759_999_998_000, 209.5, 147], [1_760_000_000_000, 210, 147]] },
        { track: 'T1', label: 'possible turtle', points: [[1_760_000_000_000, 64.5, 132]] },
    ],
};

describe('detections payload', () =>
{
    it('accepts the worker format', () =>
    {
        expect(parseDetections(valid)).toEqual(valid);
        expect(parseDetections({ ...valid, dark: true, objects: [], trails: [] })?.dark).toBe(true);
        // Edges are inside; equal times are in order.
        const edge = { ...valid, objects: [{ ...valid.objects[0], box: [289, 154, 31, 86] }], trails: [{ ...valid.trails[0], points: [[valid.at, 320, 240], [valid.at, 0, 0]] }] };
        expect(parseDetections(edge)).toEqual(edge);
        // The worker's 0.1 px rounding of a clipped edge box.
        const rounded = { ...valid, objects: [{ ...valid.objects[0], box: [100.1, 154.1, 220, 86] }] };
        expect(parseDetections(rounded)).toEqual(rounded);
    });

    it('refuses anything else', () =>
    {
        const bad: unknown[] = [
            null, 'x', { ...valid, extra: 1 },
            { ...valid, at: -1 }, { ...valid, at: 1.5 }, { ...valid, width: 0 },
            { ...valid, objects: [{ ...valid.objects[0], score: 1.2 }] },
            { ...valid, objects: [{ ...valid.objects[0], score: undefined }] },
            { ...valid, objects: [{ ...valid.objects[1], score: 0.5 }] },
            { ...valid, objects: [{ ...valid.objects[0], label: 'turtle' }] },
            { ...valid, objects: [{ ...valid.objects[0], track: 'T2' }] },
            { ...valid, objects: [{ ...valid.objects[1], track: 'P2' }] },
            { ...valid, objects: [{ ...valid.objects[0], track: 'P0' }] },
            { ...valid, objects: [{ ...valid.objects[0], box: [1, 2, 3] }] },
            { ...valid, objects: [{ ...valid.objects[0], box: [-1, 2, 3, 4] }] },
            { ...valid, objects: Array.from({ length: 51 }, (_, i) => ({ ...valid.objects[0], track: `P${i + 1}` })) },
            { ...valid, trails: [{ ...valid.trails[0], points: [] }] },
            { ...valid, trails: [{ ...valid.trails[0], points: Array.from({ length: MAX_TRAIL_POINTS + 1 }, (_, i) => [i, 1, 1]) }] },
            { ...valid, trails: [{ ...valid.trails[0], label: 'possible turtle' }] },
            // Boxes inside the picture: x + w <= width, y + h <= height (plus 0.5 px for the worker's rounding).
            { ...valid, objects: [{ ...valid.objects[0], box: [290, 104, 31, 86] }] },
            { ...valid, objects: [{ ...valid.objects[0], box: [194, 155, 31, 86] }] },
            { ...valid, objects: [{ ...valid.objects[0], box: [400, 10, 0, 0] }] },
            // Trail points inside the picture, in time order, never after the result.
            { ...valid, trails: [{ ...valid.trails[0], points: [[valid.at, 321, 1]] }] },
            { ...valid, trails: [{ ...valid.trails[0], points: [[valid.at, 1, 241]] }] },
            { ...valid, trails: [{ ...valid.trails[0], points: [[valid.at, 1, 1], [valid.at - 2_000, 1, 1]] }] },
            { ...valid, trails: [{ ...valid.trails[0], points: [[valid.at - 2_000, 1, 1], [valid.at + 1, 1, 1]] }] },
            // Track ids unique within objects and within trails.
            { ...valid, objects: [valid.objects[0], { ...valid.objects[0], box: [1, 1, 2, 2] }] },
            { ...valid, trails: [valid.trails[0], valid.trails[0]] },
        ];
        for (const value of bad)
        {
            expect(parseDetections(value), JSON.stringify(value)?.slice(0, 120)).toBeNull();
        }
    });
});
