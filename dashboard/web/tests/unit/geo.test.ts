import { describe, expect, it } from 'vitest';
import { boundsOf, destinationPoint, viewCone } from '@/lib/geo';

const origin: [number, number] = [-97.0628, 27.8182];

// Equirectangular distance is accurate to <0.1% at this scale.
function metres(a: [number, number], b: [number, number]): number
{
    const k = Math.PI / 180;
    const x = (b[0] - a[0]) * k * Math.cos(((a[1] + b[1]) / 2) * k);
    const y = (b[1] - a[1]) * k;
    return Math.hypot(x, y) * 6371008.8;
}

describe('geo', () =>
{
    it('destinationPoint moves the requested distance', () =>
    {
        const north = destinationPoint(origin, 0, 100);
        expect(metres(origin, north)).toBeCloseTo(100, 0);
        expect(north[1]).toBeGreaterThan(origin[1]);
        const east = destinationPoint(origin, 90, 100);
        expect(east[0]).toBeGreaterThan(origin[0]);
    });

    it('viewCone is a closed ring starting at the camera', () =>
    {
        const ring = viewCone(origin, 203, 44, 350, 8);
        expect(ring[0]).toEqual(origin);
        expect(ring[ring.length - 1]).toEqual(origin);
        expect(ring).toHaveLength(8 + 1 + 2);   // origin + arc (steps+1) + closing origin
        ring.slice(1, -1).forEach(point => expect(metres(origin, point)).toBeCloseTo(350, 0));
    });

    it('boundsOf returns min/max corners', () =>
    {
        expect(boundsOf([[1, 5], [-2, 7], [3, 4]])).toEqual([[-2, 4], [3, 7]]);
    });
});
