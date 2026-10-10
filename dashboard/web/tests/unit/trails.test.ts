import { describe, expect, it } from 'vitest';
import type { TrackView } from '@/lib/types';
import { clipTrail, TRAIL_PALETTE, trailColor, trailFeatures, UNMATCHED_TRAIL } from '@/features/map/trails';
import { siteAlert } from './siteFixtures';

const track = (id: string, alertId: string | null, colorIndex: number | null, key = 'R1'): TrackView => ({
    id, alertId, colorIndex, key,
    points: [0, 1, 2, 3, 4].map(step => ({ t: 10 + step, position: [step, step * 2] as [number, number] })),
});

describe('trail colours', () =>
{
    it('uses the six-colour palette in pin order and grey for unmatched trails', () =>
    {
        expect(TRAIL_PALETTE).toEqual(['#4FC3F7', '#F06292', '#AED581', '#BA68C8', '#4DB6AC', '#FFF176']);
        expect(trailColor(0)).toBe('#4FC3F7');
        expect(trailColor(5)).toBe('#FFF176');
        expect(trailColor(7)).toBe('#F06292');
        expect(trailColor(null)).toBe(UNMATCHED_TRAIL);
        expect(UNMATCHED_TRAIL).toBe('#8A9BA6');
    });
});

describe('clipTrail', () =>
{
    const points = track('t', null, null).points;

    it('keeps points up to the clock and nothing after it', () =>
    {
        expect(clipTrail(points, 12.5).map(point => point.t)).toEqual([10, 11, 12]);
        expect(clipTrail(points, 12).map(point => point.t)).toEqual([10, 11, 12]);
    });

    it('is empty before the first point and whole after the last', () =>
    {
        expect(clipTrail(points, 9.9)).toEqual([]);
        expect(clipTrail(points, -Infinity)).toEqual([]);
        expect(clipTrail(points, 99)).toHaveLength(5);
    });
});

describe('trailFeatures', () =>
{
    const alerts = [siteAlert('s1'), siteAlert('s2', { active: false })];
    const tracks = [track('t1', 's1', 2), track('t2', 's2', 1), track('t3', null, null), track('t4', 's1', 2, 'R2')];

    it('while a feed plays, grows only that clip\'s trails to the clock with a head dot', () =>
    {
        const { lines, heads } = trailFeatures(tracks, alerts, { key: 'R1', t: 12.4 });
        expect(lines.map(line => line.properties.id)).toEqual(['t1', 't2', 't3']);
        expect(lines[0].geometry.coordinates).toEqual([[0, 0], [1, 2], [2, 4]]);
        expect(lines.map(line => line.properties.color)).toEqual(['#AED581', '#F06292', '#8A9BA6']);
        expect(lines.every(line => line.properties.opacity === 1)).toBe(true);
        expect(heads.map(head => head.geometry.coordinates)).toEqual([[2, 4], [2, 4], [2, 4]]);
        expect(heads[0].properties.color).toBe('#AED581');
    });

    it('draws nothing before the clip reaches a trail, and only a head dot after its first point', () =>
    {
        expect(trailFeatures(tracks, alerts, { key: 'R1', t: -Infinity })).toEqual({ lines: [], heads: [] });
        const { lines, heads } = trailFeatures(tracks, alerts, { key: 'R1', t: 10.2 });
        expect(lines).toEqual([]);
        expect(heads).toHaveLength(3);
    });

    it('with no feed playing, shows whole trails of active sites at 60 % and no heads', () =>
    {
        const { lines, heads } = trailFeatures(tracks, alerts, null);
        expect(lines.map(line => line.properties.id)).toEqual(['t1', 't4']);
        expect(lines[0].geometry.coordinates).toHaveLength(5);
        expect(lines.every(line => line.properties.opacity === 0.6)).toBe(true);
        expect(heads).toEqual([]);
    });
});
