import { describe, expect, it } from 'vitest';
import { bearingBetween, destinationPoint } from '@/lib/geo';
import { distanceToZone, nearestZone, nextCameraCodes, partnerCode, planPairOnZone, zoneOrientation } from '@/lib/cameras/placePair';
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
