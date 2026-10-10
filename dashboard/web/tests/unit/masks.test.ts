import { describe, expect, it } from 'vitest';
import { MASK_FRAME, MAX_MASK_POINTS, clampPolygon, toNormalized, toPixels, validMaskPoints } from '@/lib/cameras/masks';

describe('camera mask geometry', () =>
{
    it('clamps out-of-frame points and rounds to integers', () =>
    {
        const clamped = clampPolygon([[-50, 40.3], [2000, 900], [640, 360]]);
        expect(clamped).toEqual([[0, 40], [1280, 720], [640, 360]]);
    });

    it('accepts a 3-32 point in-frame polygon and rejects degenerate ones', () =>
    {
        expect(validMaskPoints([[0, 0], [1280, 0], [1280, 720]])).toBe(true);
        expect(validMaskPoints([[0, 0], [1280, 0]])).toBe(false);
        expect(validMaskPoints([[0, 0], [1280, 0], [1280, 720], [2000, 720]])).toBe(false);
        expect(validMaskPoints(Array.from({ length: MAX_MASK_POINTS + 1 }, (_, i) => [i * 40, 360]))).toBe(false);
    });

    it('round-trips pixel <-> normalized coordinates', () =>
    {
        const pixels: [number, number][] = [[70, 320], [1210, 330], [1210, 705], [70, 705]];
        const normalized = toNormalized(pixels);
        expect(normalized[0][0]).toBeCloseTo(70 / MASK_FRAME[0], 6);
        expect(toPixels(normalized)).toEqual(pixels);
    });
});
