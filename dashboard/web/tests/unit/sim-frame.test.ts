import { describe, expect, it } from 'vitest';
import { bearingBetween, destinationPoint } from '@/lib/geo';
import { simPointToLngLat, zoneFrame } from '@/lib/sim/frame';
import { SEED_ZONES } from '../../prisma/seed-data';

function metres(a: [number, number], b: [number, number]): number
{
    const k = Math.PI / 180;
    const x = (b[0] - a[0]) * k * Math.cos(((a[1] + b[1]) / 2) * k);
    return Math.hypot(x, (b[1] - a[1]) * k) * 6371008.8;
}

const ring = SEED_ZONES.find(zone => zone.code === 'B')!.outline.coordinates[0] as [number, number][];

describe('bearingBetween', () =>
{
    it('matches destinationPoint', () =>
    {
        const origin: [number, number] = [-97.06, 27.81];
        expect(bearingBetween(origin, destinationPoint(origin, 33, 200))).toBeCloseTo(33, 1);
        expect(bearingBetween(origin, destinationPoint(origin, 270, 200))).toBeCloseTo(270, 1);
    });
});

describe('zone frame', () =>
{
    const frame = zoneFrame(ring);

    it('puts the origin at the corner centroid', () =>
    {
        const corners = ring.slice(0, 4);
        const centroid: [number, number] = [corners.reduce((s, p) => s + p[0], 0) / 4, corners.reduce((s, p) => s + p[1], 0) / 4];
        expect(metres(frame.origin, centroid)).toBeLessThan(0.01);
        expect(simPointToLngLat(frame, [0, 0])).toEqual(frame.origin);
    });

    it('runs +x from land-south toward land-north (roughly NNE along this beach)', () =>
    {
        expect(frame.alongBearing).toBeCloseTo(bearingBetween(ring[1], ring[0]), 6);
        expect(frame.alongBearing).toBeGreaterThan(20);
        expect(frame.alongBearing).toBeLessThan(60);
    });

    it('keeps true scale and sends +y inland (away from the sea side)', () =>
    {
        const ahead = simPointToLngLat(frame, [12, 0]);
        expect(metres(frame.origin, ahead)).toBeCloseTo(12, 1);
        const inland = simPointToLngLat(frame, [0, 8]);
        expect(metres(frame.origin, inland)).toBeCloseTo(8, 1);
        const seaMid: [number, number] = [(ring[2][0] + ring[3][0]) / 2, (ring[2][1] + ring[3][1]) / 2];
        expect(metres(inland, seaMid)).toBeGreaterThan(metres(frame.origin, seaMid));
    });
});
