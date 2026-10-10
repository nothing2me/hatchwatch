import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DANGER_MESSAGE, DANGER_RADIUS_M, findDangers, isNestSite, limitDangersPerSite, type Danger } from '@/lib/danger';
import { destinationPoint, distanceBetween } from '@/lib/geo';
import { peopleFileSchema, tracksFileSchema } from '@/lib/sim/schema';
import type { LngLat } from '@/lib/types';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../fixtures/paths/${name}`, import.meta.url), 'utf8'));

describe('tracks.v1 and people.v1 mirrors', () =>
{
    it('accept the files a seaward + humans run wrote', () =>
    {
        const tracks = tracksFileSchema.parse(fixture('tracks.json'));
        expect(tracks.tracks.length).toBeGreaterThan(0);
        expect(tracks.tracks.some(track => track.pin_id === null)).toBe(true);
        const people = peopleFileSchema.parse(fixture('people.json'));
        expect(people.people.length).toBeGreaterThan(0);
        expect(people.people[0].points[0]).toHaveLength(3);
    });

    it('reject malformed files', () =>
    {
        const tracks = fixture('tracks.json') as { tracks: { id: string; points: number[][] }[] };
        expect(tracksFileSchema.safeParse({ ...tracks, version: 2 }).success).toBe(false);
        expect(tracksFileSchema.safeParse({ ...tracks, tracks: [{ ...tracks.tracks[0], id: 'trail-1' }] }).success).toBe(false);
        expect(tracksFileSchema.safeParse({ ...tracks, tracks: [{ ...tracks.tracks[0], points: [[0, 1, 2]] }] }).success).toBe(false);
        expect(tracksFileSchema.safeParse({ ...tracks, tracks: [{ ...tracks.tracks[0], points: [[0, 1], [1, 2]] }] }).success).toBe(false);
        expect(tracksFileSchema.safeParse({ ...tracks, extra: true }).success).toBe(false);
        const people = fixture('people.json') as { people: { id: string }[] };
        expect(peopleFileSchema.safeParse({ ...people, schema: 'nesttrace.tracks' }).success).toBe(false);
        expect(peopleFileSchema.safeParse({ ...people, people: [{ ...people.people[0], max_height_m: undefined }] }).success).toBe(false);
        expect(peopleFileSchema.safeParse({ ...people, people: [{ ...people.people[0], id: 'track-1' }] }).success).toBe(false);
    });
});

describe('findDangers', () =>
{
    const site: LngLat = [-80.1, 26.5];
    // A straight walk east-west passing `offsetM` north of the site, 1 m/s, centred on time `at`.
    const walk = (id: string, offsetM: number, at: number, points = 21) => ({
        id,
        points: Array.from({ length: points }, (_, i) =>
        {
            const along = i - (points - 1) / 2;
            const north = destinationPoint(site, 0, offsetM);
            return { t: at + along, position: along === 0 ? north : destinationPoint(north, along > 0 ? 90 : 270, Math.abs(along)) };
        }),
    });
    const sites = [{ alertId: 's1', position: site, startT: 10 }];

    it('uses the documented message and radius', () =>
    {
        expect(DANGER_MESSAGE).toBe('Danger · person near an active nest site — immediate action');
        expect(DANGER_RADIUS_M).toBe(3);
    });

    it('raises one danger when a person passes within 2 m after startT − 2', () =>
    {
        const dangers = findDangers(sites, [walk('person-1', 2, 20)]);
        expect(dangers).toHaveLength(1);
        expect(dangers[0]).toMatchObject({ alertId: 's1', personId: 'person-1' });
        expect(dangers[0].at).toBeGreaterThan(17);
        expect(dangers[0].at).toBeLessThan(20);
        expect(dangers[0].startT).toBe(dangers[0].at);
        expect(dangers[0].endT).toBeGreaterThan(20);
        expect(distanceBetween(dangers[0].position, site)).toBeLessThanOrEqual(3.05);
    });

    it('raises nothing for a pass at 5 m', () =>
    {
        expect(findDangers(sites, [walk('person-1', 5, 20)])).toEqual([]);
    });

    it('raises once per person and site, even for two passes', () =>
    {
        const first = walk('person-1', 1, 20);
        const second = walk('person-1', 1, 60);
        const dangers = findDangers(sites, [{ id: 'person-1', points: [...first.points, ...second.points] }]);
        expect(dangers).toHaveLength(1);
        expect(dangers[0].at).toBeLessThan(25);
    });

    it('ignores a pass that ends before startT − 2', () =>
    {
        // Within radius only around t = 0..3; the site is watched from t = 8.
        expect(findDangers(sites, [walk('person-1', 1, 0, 7)])).toEqual([]);
    });

    it('catches a fast pass between sparse samples', () =>
    {
        const west = destinationPoint(site, 270, 10);
        const east = destinationPoint(site, 90, 10);
        expect(findDangers(sites, [{ id: 'person-9', points: [{ t: 20, position: west }, { t: 22, position: east }] }])).toHaveLength(1);
    });
});

describe('limitDangersPerSite', () =>
{
    const danger = (personId: string, at: number, alertId = 's1'): Danger => ({ alertId, personId, at, position: [0, 0], startT: at, endT: at + 1 });

    it('keeps one danger per site per minute whatever the person id', () =>
    {
        const kept = limitDangersPerSite([danger('person-2', 14), danger('person-1', 12), danger('person-3', 72), danger('person-4', 80), danger('person-1', 13, 's2')]);
        expect(kept.map(d => [d.alertId, d.personId])).toEqual([['s1', 'person-1'], ['s2', 'person-1'], ['s1', 'person-3']]);
    });
});

describe('isNestSite', () =>
{
    it('leaves danger alerts out of site counts', () =>
    {
        expect(isNestSite({ kind: 'DIGGING' })).toBe(true);
        expect(isNestSite({ kind: 'DANGER' })).toBe(false);
    });
});
