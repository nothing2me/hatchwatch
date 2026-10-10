import { describe, expect, it } from 'vitest';
import { bearingBetween, destinationPoint } from '@/lib/geo';
import { distanceToZone, JOIN_DISTANCE_M, nearestZone, nextCameraCodes, nextZoneCode, partnerCode, PlacementError, placementFor, planNewZone, planPairOnZone, translateZone, zoneOrientation, zonesOverlap } from '@/lib/cameras/placePair';
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
    id: `z${i}`, code: zone.code, name: zone.name, activityLevel: zone.activityLevel, ring: zone.outline.coordinates[0],
}));
const zoneD = zones[3];
const landMid = (ring: LngLat[]): LngLat => [(ring[0][0] + ring[1][0]) / 2, (ring[0][1] + ring[1][1]) / 2];
const seaMid = (ring: LngLat[]): LngLat => [(ring[2][0] + ring[3][0]) / 2, (ring[2][1] + ring[3][1]) / 2];
const seedCodes = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2'];

describe('zoneOrientation', () =>
{
    it('gives the along-shore bearing and a seaward bearing perpendicular to it, toward the sea edge', () =>
    {
        const { along, seaward } = zoneOrientation(zoneD);
        expect(angleGap(along, bearingBetween(zoneD.ring[1], zoneD.ring[0]))).toBeLessThan(0.01);
        expect(angleGap(seaward, along)).toBeCloseTo(90, 5);
        expect(angleGap(seaward, bearingBetween(landMid(zoneD.ring), seaMid(zoneD.ring)))).toBeLessThan(90);
        // Holiday Beach: the Gulf lies to the south-east.
        expect(angleGap(seaward, 129)).toBeLessThan(15);
    });
});

describe('nearestZone', () =>
{
    it('picks the zone a click falls inside', () =>
    {
        expect(distanceToZone(landMid(zoneD.ring), zoneD)).toBeLessThan(1);
        const inside: LngLat = [(landMid(zoneD.ring)[0] + seaMid(zoneD.ring)[0]) / 2, (landMid(zoneD.ring)[1] + seaMid(zoneD.ring)[1]) / 2];
        expect(distanceToZone(inside, zoneD)).toBe(0);
        expect(nearestZone(inside, zones).code).toBe('D');
    });

    it('picks the closest zone for a click outside every zone', () =>
    {
        const northOfD = destinationPoint(zoneD.ring[0], bearingBetween(zoneD.ring[1], zoneD.ring[0]), 150);
        expect(nearestZone(northOfD, zones).code).toBe('D');
        const southOfA = destinationPoint(zones[0].ring[1], bearingBetween(zones[0].ring[0], zones[0].ring[1]), 150);
        expect(nearestZone(southOfA, zones).code).toBe('A');
    });

    it('refuses a click more than 2 km from every zone', () =>
    {
        const far = destinationPoint(zoneD.ring[0], 300, 2500);
        expect(() => nearestZone(far, zones)).toThrow('Click closer to the beach');
        expect(() => nearestZone(landMid(zoneD.ring), [])).toThrow('Click closer to the beach');
    });
});

describe('nextCameraCodes', () =>
{
    it('continues the zone\'s numbering and ignores other zones', () =>
    {
        expect(nextCameraCodes('D', seedCodes, 2)).toEqual(['D3', 'D4']);
        expect(nextCameraCodes('D', [...seedCodes, 'D7', 'E9'], 2)).toEqual(['D8', 'D9']);
        expect(nextCameraCodes('F', seedCodes, 2)).toEqual(['F1', 'F2']);
    });

    it('stops at 99', () =>
    {
        expect(() => nextCameraCodes('D', ['D98'], 2)).toThrow();
    });
});

describe('partnerCode', () =>
{
    it('pairs odd numbers with the next even one', () =>
    {
        expect(partnerCode('B1')).toBe('B2');
        expect(partnerCode('B2')).toBe('B1');
        expect(partnerCode('D3')).toBe('D4');
        expect(partnerCode('D4')).toBe('D3');
        expect(partnerCode('xyz')).toBeNull();
    });
});

describe('planPairOnZone', () =>
{
    const click = landMid(zoneD.ring);
    const plan = planPairOnZone(click, zoneD, seedCodes);
    const [north, south] = plan.cameras;
    const { along, seaward } = zoneOrientation(zoneD);

    it('names the cameras with the zone\'s next numbers', () =>
    {
        expect(plan.cameras.map(camera => camera.code)).toEqual(['D3', 'D4']);
    });

    it('places them 40 m apart along the shore, centred on the click', () =>
    {
        expect(metres(north.position, south.position)).toBeCloseTo(40, 1);
        expect(metres(click, north.position)).toBeCloseTo(20, 1);
        expect(metres(click, south.position)).toBeCloseTo(20, 1);
        expect(angleGap(bearingBetween(south.position, north.position), along)).toBeLessThan(0.5);
    });

    it('faces both out to sea, each turned 20° toward the other', () =>
    {
        for (const camera of plan.cameras)
        {
            expect(angleGap(camera.headingDeg, seaward)).toBeCloseTo(20, 5);
        }
        const toSouth = bearingBetween(north.position, south.position);
        const toNorth = bearingBetween(south.position, north.position);
        expect(angleGap(north.headingDeg, toSouth)).toBeLessThan(angleGap(seaward, toSouth));
        expect(angleGap(south.headingDeg, toNorth)).toBeLessThan(angleGap(seaward, toNorth));
        // Both cones look across the sea edge of the zone, not along the beach.
        expect(angleGap(north.headingDeg, bearingBetween(north.position, seaMid(zoneD.ring)))).toBeLessThan(60);
    });
});

describe('placementFor (150 m join rule)', () =>
{
    const along = bearingBetween(zoneD.ring[1], zoneD.ring[0]);

    it('joins a zone the click falls inside or within 150 m of', () =>
    {
        expect(placementFor(landMid(zoneD.ring), zones)).toEqual({ kind: 'join', zone: zoneD });
        expect(placementFor(destinationPoint(zoneD.ring[0], along, 140), zones)).toEqual({ kind: 'join', zone: zoneD });
    });

    it('asks for a new zone farther than 150 m from every zone, however far', () =>
    {
        expect(placementFor(destinationPoint(zoneD.ring[0], along, 300), zones)).toEqual({ kind: 'new' });
        expect(distanceToZone(destinationPoint(zoneD.ring[0], along, 300), zoneD)).toBeGreaterThan(150);
        expect(placementFor(destinationPoint(zoneD.ring[0], along, 5000), zones)).toEqual({ kind: 'new' });
        expect(placementFor(landMid(zoneD.ring), [])).toEqual({ kind: 'new' });
        expect(JOIN_DISTANCE_M).toBe(150);
    });
});

describe('nextZoneCode', () =>
{
    it('takes the letter after the highest single-letter code', () =>
    {
        expect(nextZoneCode(['A', 'B', 'C', 'D'])).toBe('E');
        expect(nextZoneCode(['A', 'D', 'F', 'NORTH'])).toBe('G');
        expect(nextZoneCode([])).toBe('A');
    });

    it('refuses when Z is taken', () =>
    {
        expect(() => nextZoneCode(['A', 'Z'])).toThrow(PlacementError);
        expect(() => nextZoneCode(['Z'])).toThrow(/Z/);
    });
});

describe('planNewZone', () =>
{
    const along = bearingBetween(zoneD.ring[1], zoneD.ring[0]);
    const { seaward } = zoneOrientation(zoneD);
    const click = destinationPoint(zoneD.ring[0], along, 1000);
    const plan = planNewZone(click, zones, seedCodes.map(code => code[0]).filter((c, i, all) => all.indexOf(c) === i), seedCodes);
    const [landNorth, landSouth, seaSouth, seaNorth, closing] = plan.ring;

    it('names the zone and its cameras with the next letter', () =>
    {
        expect(plan.code).toBe('E');
        expect(plan.cameras.map(camera => camera.code)).toEqual(['E1', 'E2']);
    });

    it('draws a closed 120 m × 60 m rectangle, land edge centred on the click, sea edge seaward', () =>
    {
        expect(plan.ring).toHaveLength(5);
        expect(closing).toEqual(landNorth);
        expect(metres(landNorth, landSouth)).toBeCloseTo(120, 1);
        expect(metres(seaSouth, seaNorth)).toBeCloseTo(120, 1);
        expect(metres(landSouth, seaSouth)).toBeCloseTo(60, 1);
        expect(metres(landNorth, seaNorth)).toBeCloseTo(60, 1);
        expect(metres(click, landMid(plan.ring))).toBeLessThan(0.01);
        expect(angleGap(bearingBetween(landSouth, landNorth), along)).toBeLessThan(0.5);
        expect(angleGap(bearingBetween(landMid(plan.ring), seaMid(plan.ring)), seaward)).toBeLessThan(0.5);
        // Same orientation rule as the seeded zones.
        const orientation = zoneOrientation({ ...zoneD, code: 'E', ring: plan.ring });
        expect(angleGap(orientation.seaward, seaward)).toBeLessThan(0.5);
    });

    it('stands the cameras on the land edge 40 m apart, facing the ocean, toed in 20°', () =>
    {
        const [north, south] = plan.cameras;
        expect(metres(north.position, south.position)).toBeCloseTo(40, 1);
        expect(metres(click, north.position)).toBeCloseTo(20, 1);
        expect(angleGap(bearingBetween(south.position, north.position), along)).toBeLessThan(0.5);
        for (const camera of plan.cameras)
        {
            expect(angleGap(camera.headingDeg, seaward)).toBeCloseTo(20, 2);
        }
        expect(angleGap(north.headingDeg, bearingBetween(north.position, south.position))).toBeLessThan(90);
        expect(angleGap(south.headingDeg, bearingBetween(south.position, north.position))).toBeLessThan(90);
    });

    it('falls back to the Holiday Beach bearing with no zone to copy', () =>
    {
        const lone = planNewZone(click, [], [], []);
        expect(lone.code).toBe('A');
        expect(angleGap(bearingBetween(lone.ring[1], lone.ring[0]), 39)).toBeLessThan(0.5);
        expect(angleGap(bearingBetween(landMid(lone.ring), seaMid(lone.ring)), 129)).toBeLessThan(0.5);
    });

    it('refuses a rectangle that would overlap an existing zone', () =>
    {
        const near = destinationPoint(zoneD.ring[0], along, 40);
        expect(() => planNewZone(near, zones, ['A', 'B', 'C', 'D'], seedCodes)).toThrow('Too close to Zone D — click inside it to join, or further away for a new zone');
        expect(() => planNewZone(landMid(zoneD.ring), zones, ['A', 'B', 'C', 'D'], seedCodes)).toThrow(/Too close to Zone D/);
    });
});

describe('translateZone', () =>
{
    it('shifts the outline and the cameras by the same offset', () =>
    {
        const from: LngLat = [-97.05, 27.83];
        const to: LngLat = [-97.049, 27.8305];
        const moved = translateZone(zoneD.ring, [[-97.058, 27.8236]], from, to);
        expect(moved.ring).toHaveLength(zoneD.ring.length);
        zoneD.ring.forEach((point, i) =>
        {
            expect(moved.ring[i][0]).toBeCloseTo(point[0] + 0.001, 9);
            expect(moved.ring[i][1]).toBeCloseTo(point[1] + 0.0005, 9);
        });
        expect(moved.points[0][0]).toBeCloseTo(-97.057, 9);
        expect(moved.points[0][1]).toBeCloseTo(27.8241, 9);
    });
});

describe('zonesOverlap', () =>
{
    it('detects crossing, containing and separate outlines', () =>
    {
        const square = (x: number, y: number, size: number): LngLat[] => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]];
        expect(zonesOverlap(square(0, 0, 2), square(1, 1, 2))).toBe(true);
        expect(zonesOverlap(square(0, 0, 4), square(1, 1, 1))).toBe(true);
        expect(zonesOverlap(square(1, 1, 1), square(0, 0, 4))).toBe(true);
        expect(zonesOverlap(square(0, 0, 1), square(3, 3, 1))).toBe(false);
    });
});
