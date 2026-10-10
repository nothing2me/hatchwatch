import { describe, expect, it } from 'vitest';
import { bearingBetween, destinationPoint } from '@/lib/geo';
import { recordingOffsetM, shiftedZoneFrame, simPointToLngLat, zoneFrame } from '@/lib/sim/frame';
import { SEED_CAMERAS, SEED_ZONES } from '../../prisma/seed-data';

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

    it('runs +x from land-north toward land-south (roughly SW along this beach)', () =>
    {
        expect(frame.alongBearing).toBeCloseTo(bearingBetween(ring[0], ring[1]), 6);
        expect(frame.alongBearing).toBeGreaterThan(200);
        expect(frame.alongBearing).toBeLessThan(240);
    });

    it('places sim camera-0 (x = -28) nearer seed camera B1 than B2', () =>
    {
        const spot = simPointToLngLat(frame, [-28, 0]);
        const cam = (code: string) => SEED_CAMERAS.find(camera => camera.code === code)!;
        const dist = (code: string) => metres(spot, [cam(code).lng, cam(code).lat]);
        expect(dist('B1')).toBeLessThan(dist('B2'));
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

    it('spreads successive recordings along the zone without stretching a 24 m footprint', () =>
    {
        const offsets = Array.from({ length: 8 }, (_, visit) => recordingOffsetM(ring, visit * 4 + 1, 4, 24));
        expect(new Set(offsets.map(offset => Math.round(offset))).size).toBe(8);
        for (const offset of offsets)
        {
            const placed = shiftedZoneFrame(frame, offset);
            expect(metres(simPointToLngLat(placed, [-12, 0]), simPointToLngLat(placed, [12, 0]))).toBeCloseTo(24, 1);
            expect(Math.abs(offset) + 12).toBeLessThan(metres(ring[0], ring[1]) / 2);
        }
    });
});
