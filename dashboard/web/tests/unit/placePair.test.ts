import { describe, expect, it } from 'vitest';
import { bearingBetween, destinationPoint } from '@/lib/geo';
import { nextZoneCode, planCameraPair } from '@/lib/cameras/placePair';
import type { LngLat, ZoneView } from '@/lib/types';
import { SEED_ZONES } from '../../prisma/seed-data';

function metres(a: LngLat, b: LngLat): number
{
    const k = Math.PI / 180;
    const x = (b[0] - a[0]) * k * Math.cos(((a[1] + b[1]) / 2) * k);
    const y = (b[1] - a[1]) * k;
    return Math.hypot(x, y) * 6371008.8;
}

const angleGap = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

const zones: ZoneView[] = SEED_ZONES.map((zone, i) => ({
    id: `z${i}`, code: zone.code, name: zone.name, activityLevel: zone.activityLevel, ring: zone.outline.coordinates[0], custom: false,
}));
const codes = zones.map(zone => zone.code);
const zoneD = zones[3];
// A point on the dune line about 150 m north-east of zone D's land edge.
const click = destinationPoint(zoneD.ring[0], bearingBetween(zoneD.ring[1], zoneD.ring[0]), 150);
const seaMid = (ring: LngLat[]): LngLat => [(ring[2][0] + ring[3][0]) / 2, (ring[2][1] + ring[3][1]) / 2];

describe('nextZoneCode', () =>
{
    it('continues after the highest letter', () =>
    {
        expect(nextZoneCode(['A', 'B', 'C', 'D'])).toBe('E');
        expect(nextZoneCode(['D', 'A', 'F'])).toBe('G');
        expect(nextZoneCode([])).toBe('A');
    });

    it('ignores codes that are not single letters', () =>
    {
        expect(nextZoneCode(['A', 'TEST', 'B2'])).toBe('B');
    });

    it('throws once Z is taken', () =>
    {
        expect(() => nextZoneCode(['A', 'Z'])).toThrow();
    });
});

describe('planCameraPair', () =>
{
    const plan = planCameraPair(click, zones, codes);
    const [landNorth, landSouth, seaSouth, seaNorth, closing] = plan.ring;

    it('names the zone and its cameras after the highest code', () =>
    {
        expect(plan.code).toBe('E');
        expect(plan.cameras.map(camera => camera.code)).toEqual(['E1', 'E2']);
    });

    it('builds a closed 120 m by 60 m ring in land-north, land-south, sea-south, sea-north order', () =>
    {
        expect(plan.ring).toHaveLength(5);
        expect(closing).toEqual(landNorth);
        expect(metres(landNorth, landSouth)).toBeCloseTo(120, 0);
        expect(metres(seaNorth, seaSouth)).toBeCloseTo(120, 0);
        expect(metres(landSouth, seaSouth)).toBeCloseTo(60, 0);
        expect(metres(landNorth, seaNorth)).toBeCloseTo(60, 0);
        // Land edge is centred on the click.
        expect(metres(click, landNorth)).toBeCloseTo(60, 0);
        expect(metres(click, landSouth)).toBeCloseTo(60, 0);
        // North really is the along-beach end matching zone D's ring order.
        const along = bearingBetween(zoneD.ring[1], zoneD.ring[0]);
        expect(angleGap(bearingBetween(landSouth, landNorth), along)).toBeLessThan(1);
        // Sea corners lie towards zone D's sea edge.
        expect(metres(seaNorth, seaMid(zoneD.ring))).toBeLessThan(metres(landNorth, seaMid(zoneD.ring)));
    });

    it('puts cameras at the land-edge ends, both facing the sea', () =>
    {
        const [north, south] = plan.cameras;
        expect(north.position).toEqual(landNorth);
        expect(south.position).toEqual(landSouth);
        const seaward = bearingBetween(landNorth, seaNorth);
        // Facing the centroid of a 120 x 60 m zone from a land corner sits atan(60/30) ≈ 63.4° off
        // straight seaward, so the brief's 45° bound cannot hold; check the sea half-plane and the exact angle.
        for (const camera of plan.cameras)
        {
            expect(angleGap(camera.headingDeg, seaward)).toBeLessThan(90);
            expect(angleGap(camera.headingDeg, seaward)).toBeCloseTo(63.4, 0);
        }
        // The pair look inward at each other's half of the zone, not along the beach.
        expect(angleGap(north.headingDeg, bearingBetween(landNorth, landSouth))).toBeLessThan(90);
        expect(angleGap(south.headingDeg, bearingBetween(landSouth, landNorth))).toBeLessThan(90);
        expect(angleGap(seaward, 129)).toBeLessThan(15);
    });

    it('refuses a click far from every zone', () =>
    {
        expect(() => planCameraPair(destinationPoint(click, 300, 2500), zones, codes)).toThrow('Click closer to the beach');
    });

    it('defaults to a 39° beach with the sea to the south-east when there are no zones', () =>
    {
        const lone = planCameraPair(click, [], []);
        expect(lone.code).toBe('A');
        expect(angleGap(bearingBetween(lone.ring[1], lone.ring[0]), 39)).toBeLessThan(0.5);
        expect(angleGap(bearingBetween(lone.ring[0], lone.ring[3]), 129)).toBeLessThan(0.5);
    });

    it('propagates code overflow', () =>
    {
        expect(() => planCameraPair(click, zones, [...codes, 'Z'])).toThrow();
    });
});
