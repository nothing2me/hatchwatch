import { describe, expect, it } from 'vitest';
import { BACKGROUND_RATE, DEFAULT_THRESHOLD, isSameFrame, paintDifference, toBlurredGray, updateBackground } from '@/features/phones/motion';

const rgba = (values: number[]) => new Uint8ClampedArray(values.flatMap(v => [v, v, v, 255]));
const flat = (value: number, n = 9) => new Float32Array(n).fill(value);

describe('motion maths', () =>
{
    it('converts to grey and softens with a 3×3 box blur', () =>
    {
        expect([...toBlurredGray(rgba(Array(9).fill(100)), 3, 3)]).toEqual(Array(9).fill(100));
        const spot = toBlurredGray(rgba([0, 0, 0, 0, 255, 0, 0, 0, 0]), 3, 3);
        expect(spot[4]).toBeCloseTo(255 / 9, 3);
        expect(spot[0]).toBeCloseTo(255 / 4, 3);
    });

    it('paints black below the threshold, amber at it and white at four times it', () =>
    {
        const out = new Uint8ClampedArray(3 * 4);
        const share = paintDifference(new Float32Array([19, 20, 80]), new Float32Array(3), out, 20);
        expect(share).toBeCloseTo(2 / 3, 5);
        expect([...out.slice(0, 4)]).toEqual([0, 0, 0, 255]);
        expect([...out.slice(4, 8)]).toEqual([255, 120, 0, 255]);
        expect([...out.slice(8, 12)]).toEqual([255, 255, 255, 255]);
    });

    it('against background: a still object fades below the default threshold after 16 frames (about 3 s at 5 fps)', () =>
    {
        expect(BACKGROUND_RATE).toBe(0.1);
        const background = flat(0);
        const object = flat(100);
        const out = new Uint8ClampedArray(9 * 4);
        updateBackground(background, object);
        expect(paintDifference(object, background, out, DEFAULT_THRESHOLD)).toBe(1);
        for (let i = 1; i < 15; i++)
        {
            updateBackground(background, object);
        }
        expect(paintDifference(object, background, out, DEFAULT_THRESHOLD)).toBe(1);
        updateBackground(background, object);
        expect(paintDifference(object, background, out, DEFAULT_THRESHOLD)).toBe(0);
    });

    it('since last frame: an unchanged picture shows no motion, and repeated frames are detected', () =>
    {
        const out = new Uint8ClampedArray(9 * 4);
        expect(paintDifference(flat(50), flat(50), out, DEFAULT_THRESHOLD)).toBe(0);
        expect(isSameFrame(null, flat(1))).toBe(false);
        expect(isSameFrame(flat(1), flat(1))).toBe(true);
        expect(isSameFrame(flat(1), flat(2))).toBe(false);
    });
});
