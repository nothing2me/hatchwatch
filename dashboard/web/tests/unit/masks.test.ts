import { describe, expect, it } from 'vitest';
import { DEFAULT_CAMERA_MASK, DEFAULT_MASK, MASK_FRAME, MAX_MASK_POINTS, asCameraMask, cleanCameraMask, clampPolygon, feetInMask, feetPoint, openRing, pointInMask, polygonArea, toNormalized, toPixels, validCameraMask, validMaskPoints, type MaskPoint } from '@/lib/cameras/masks';

describe('camera mask geometry', () =>
{
    it('clamps out-of-frame points and rounds to integers', () =>
    {
        const clamped = clampPolygon([[-50, 40.3], [2000, 900], [640, 360]]);
        expect(clamped).toEqual([[0, 40], [1280, 720], [640, 360]]);
    });

    it('accepts a 3 to MAX_MASK_POINTS point in-frame polygon and rejects degenerate ones', () =>
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

describe('per-camera masks (normalised 0-1)', () =>
{
    const triangle: [number, number][] = [[0.1, 0.1], [0.9, 0.1], [0.5, 0.9]];
    const ring = (n: number): [number, number][] => Array.from({ length: n }, (_, i) =>
        [0.5 + 0.4 * Math.cos((2 * Math.PI * i) / n), 0.5 + 0.4 * Math.sin((2 * Math.PI * i) / n)] as [number, number]);

    it('allows 64 points for pixel masks too', () =>
    {
        expect(MAX_MASK_POINTS).toBe(64);
    });

    it('accepts a triangle, 64 points and a closing repeat', () =>
    {
        expect(validCameraMask(triangle)).toBe(true);
        expect(validCameraMask(ring(64))).toBe(true);
        expect(validCameraMask([...ring(64), ring(64)[0]])).toBe(true);
        expect(validCameraMask([...triangle, triangle[0]])).toBe(true);
    });

    it('refuses too few or too many points, out-of-range, NaN, zero area and non-arrays', () =>
    {
        expect(validCameraMask([[0.1, 0.1], [0.9, 0.1]])).toBe(false);
        expect(validCameraMask(ring(65))).toBe(false);
        expect(validCameraMask([[0.1, 0.1], [1.0001, 0.1], [0.5, 0.9]])).toBe(false);
        expect(validCameraMask([[0.1, 0.1], [Number.NaN, 0.1], [0.5, 0.9]])).toBe(false);
        expect(validCameraMask([[0.1, 0.1], [0.5, 0.5], [0.9, 0.9]])).toBe(false);
        expect(validCameraMask('x')).toBe(false);
        expect(validCameraMask(null)).toBe(false);
        expect(validCameraMask([[0.1, 0.1, 0.2], [0.9, 0.1], [0.5, 0.9]])).toBe(false);
    });

    it('judges the polygon as it will be stored, after rounding to 4 decimals', () =>
    {
        // 0.5 * 0.9 * 0.000224 is just above the area floor; rounded, the height is 0.0002 and the area falls below it.
        const sliver: [number, number][] = [[0.05, 0.5], [0.95, 0.5], [0.5, 0.500224]];
        expect(polygonArea(sliver)).toBeGreaterThanOrEqual(0.0001);
        expect(validCameraMask(sliver)).toBe(false);
        expect(validCameraMask(cleanCameraMask([[0.1, 0.1], [0.9, 0.1], [0.5, 0.9]]))).toBe(true);
    });

    it('drops a repeated closing point and measures the area', () =>
    {
        expect(openRing([...triangle, triangle[0]])).toEqual(triangle);
        expect(openRing(triangle)).toEqual(triangle);
        expect(polygonArea([[0, 0], [1, 0], [1, 1], [0, 1]])).toBeCloseTo(1, 9);
        expect(polygonArea([[0, 1], [1, 1], [1, 0], [0, 0]])).toBeCloseTo(1, 9);
    });

    it('rounds to 4 decimals and opens the ring when cleaning', () =>
    {
        expect(cleanCameraMask([[0.123456, 0.987654], [0.9, 0.1], [0.5, 0.900049], [0.123456, 0.987654]]))
            .toEqual([[0.1235, 0.9877], [0.9, 0.1], [0.5, 0.9]]);
    });

    it('reads a stored value as a mask or null', () =>
    {
        expect(asCameraMask('x')).toBeNull();
        expect(asCameraMask(null)).toBeNull();
        expect(asCameraMask([[0, 0], [1, 1]])).toBeNull();
        expect(asCameraMask([...triangle, triangle[0]])).toEqual(triangle);
    });

    it('defaults to the repository beach strip in normalised form', () =>
    {
        expect(DEFAULT_CAMERA_MASK).toEqual(toNormalized(DEFAULT_MASK));
        expect(validCameraMask(DEFAULT_CAMERA_MASK)).toBe(true);
    });
});

describe('watch-area test', () =>
{
    const square: MaskPoint[] = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]];

    it('tells inside from outside, counting edges and vertices as inside', () =>
    {
        expect(pointInMask([0.5, 0.5], square)).toBe(true);
        expect(pointInMask([0.1, 0.5], square)).toBe(false);
        expect(pointInMask([0.9, 0.9], square)).toBe(false);
        expect(pointInMask([0.8, 0.5], square)).toBe(true);
        expect(pointInMask([0.5, 0.2], square)).toBe(true);
        expect(pointInMask([0.2, 0.2], square)).toBe(true);
        expect(pointInMask([0.8, 0.8], square)).toBe(true);
    });

    it('leaves a concave notch outside', () =>
    {
        const ell: MaskPoint[] = [[0, 0], [0.4, 0], [0.4, 0.6], [1, 0.6], [1, 1], [0, 1]];
        expect(pointInMask([0.2, 0.3], ell)).toBe(true);
        expect(pointInMask([0.7, 0.8], ell)).toBe(true);
        expect(pointInMask([0.7, 0.3], ell)).toBe(false);
    });

    it('uses the even-odd rule on a self-intersecting bow-tie', () =>
    {
        const bowTie: MaskPoint[] = [[0, 0], [1, 1], [1, 0], [0, 1]];
        // The two lobes are the left and right triangles meeting at the centre.
        expect(pointInMask([0.2, 0.5], bowTie)).toBe(true);
        expect(pointInMask([0.8, 0.5], bowTie)).toBe(true);
        expect(pointInMask([0.5, 0.2], bowTie)).toBe(false);
        expect(pointInMask([0.5, 0.8], bowTie)).toBe(false);
    });

    it('takes the bottom-centre of a box in picture pixels', () =>
    {
        const [x, y] = feetPoint([194, 104, 31, 86], 320, 240);
        expect(x).toBeCloseTo(0.6547, 4);
        expect(y).toBeCloseTo(0.7917, 4);
    });

    it('counts the whole picture when there is no mask', () =>
    {
        expect(feetInMask([194, 104, 31, 86], 320, 240, null)).toBe(true);
        expect(feetInMask([194, 104, 31, 86], 320, 240, square)).toBe(true);
        expect(feetInMask([10, 10, 20, 20], 320, 240, square)).toBe(false);
    });
});
