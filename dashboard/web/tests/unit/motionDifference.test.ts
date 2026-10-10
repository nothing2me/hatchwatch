import { describe, expect, it } from 'vitest';
import { isSameFrame, paintDifference, toBlurredGray, updateBackground } from '@/features/live/motionDifference';

const rgba = (values: number[]) => new Uint8ClampedArray(values.flatMap(v => [v, v, v, 255]));

describe('motion difference', () =>
{
    it('converts to gray and blurs over the 3x3 neighbourhood', () =>
    {
        expect(Array.from(toBlurredGray(rgba([90, 90, 90, 90]), 2, 2)).map(Math.round)).toEqual([90, 90, 90, 90]);
        // One bright pixel in a 3x3 frame spreads evenly to its neighbours.
        const blurred = toBlurredGray(rgba([0, 0, 0, 0, 255, 0, 0, 0, 0]), 3, 3);
        expect(blurred[4]).toBeCloseTo(255 / 9);
        expect(blurred[0]).toBeCloseTo(255 / 4);
    });

    it('spots repeated frames', () =>
    {
        const frame = new Float32Array([1, 2, 3]);
        expect(isSameFrame(null, frame)).toBe(false);
        expect(isSameFrame(frame.slice(), frame)).toBe(true);
        expect(isSameFrame(new Float32Array([9, 2, 3]), frame)).toBe(false);
        expect(isSameFrame(new Float32Array([1, 2]), frame)).toBe(false);
    });

    it('lets the background drift toward the frame', () =>
    {
        const background = new Float32Array([0, 100]);
        updateBackground(background, new Float32Array([100, 100]), 0.25);
        expect(Array.from(background)).toEqual([25, 100]);
    });

    it('paints only changes past the threshold and reports their share', () =>
    {
        const output = new Uint8ClampedArray(4 * 4);
        const share = paintDifference(new Float32Array([0, 10, 50, 200]), new Float32Array([0, 0, 0, 0]), output, 20);
        expect(share).toBe(0.5);
        expect(Array.from(output.slice(0, 8))).toEqual([0, 0, 0, 255, 0, 0, 0, 255]);
        expect(output[8]).toBe(255);
        expect(Array.from(output.slice(12, 16))).toEqual([255, 255, 255, 255]);
    });
});
