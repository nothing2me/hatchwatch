import { describe, expect, it } from 'vitest';
import { SEED_CAMERAS, SEED_ZONES, screenHeadingToBearing } from '../../prisma/seed-data';

// Rough bounding box of Mustang Island beach at Port Aransas.
const inPortAransas = ([lng, lat]: [number, number]) =>
    lng > -97.08 && lng < -97.05 && lat > 27.80 && lat < 27.83;

describe('seed data', () =>
{
    it('has zones A-D with closed 5-point rings inside Port Aransas', () =>
    {
        expect(SEED_ZONES.map(zone => zone.code)).toEqual(['A', 'B', 'C', 'D']);

        for (const zone of SEED_ZONES)
        {
            const ring = zone.outline.coordinates[0];
            expect(ring).toHaveLength(5);
            expect(ring[0]).toEqual(ring[4]);
            ring.forEach(point => expect(inPortAransas(point)).toBe(true));
        }
    });

    it('has two cameras per zone, A2 offline', () =>
    {
        expect(SEED_CAMERAS).toHaveLength(8);
        for (const code of ['A', 'B', 'C', 'D'])
        {
            expect(SEED_CAMERAS.filter(camera => camera.zoneCode === code)).toHaveLength(2);
        }
        expect(SEED_CAMERAS.find(camera => camera.code === 'A2')?.status).toBe('OFFLINE');
        SEED_CAMERAS.forEach(camera => expect(inPortAransas([camera.lng, camera.lat])).toBe(true));
    });

    it('converts screen headings to compass bearings', () =>
    {
        expect(screenHeadingToBearing(113)).toBe(203);  // down-left along beach -> SSW
        expect(screenHeadingToBearing(-34)).toBe(56);   // up-right along beach -> NE
        expect(screenHeadingToBearing(-90)).toBe(0);    // up -> north
    });
});
