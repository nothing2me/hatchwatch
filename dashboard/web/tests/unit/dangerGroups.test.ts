import { describe, expect, it } from 'vitest';
import { groupDangers, siteLabel } from '@/features/alerts/dangerGroups';
import type { AlertView } from '@/lib/types';
import { siteAlert } from './siteFixtures';

const danger = (id: string, siteId: string, createdAt: string, extra: Partial<AlertView> = {}) =>
    siteAlert(id, { danger: 'active' }, { kind: 'DANGER', level: 1, siteId, createdAt, simRunId: 'R1', message: 'Danger · person near an active nest site — immediate action', ...extra });

describe('groupDangers', () =>
{
    it('groups one zone and clip within 60 s, newest group first', () =>
    {
        const groups = groupDangers([
            danger('d1', 's1', '2026-10-09T01:00:00.000Z'),
            danger('d2', 's2', '2026-10-09T01:00:40.000Z'),
            danger('d3', 's3', '2026-10-09T01:00:59.000Z'),
            danger('d4', 's4', '2026-10-09T01:02:30.000Z'),
        ]);
        expect(groups.map(group => group.dangers.map(alert => alert.id))).toEqual([['d4'], ['d1', 'd2', 'd3']]);
        expect(groups[1].at).toBe('2026-10-09T01:00:00.000Z');
    });

    it('keeps zones and clips apart even at the same time', () =>
    {
        const groups = groupDangers([
            danger('d1', 's1', '2026-10-09T01:00:00.000Z'),
            danger('d2', 's2', '2026-10-09T01:00:00.000Z', { zoneCode: 'C' }),
            danger('d3', 's3', '2026-10-09T01:00:00.000Z', { simRunId: 'R2' }),
        ]);
        expect(groups).toHaveLength(3);
        expect(new Set(groups.map(group => group.key)).size).toBe(3);
    });

    it('starts a new group when the window from the group start passes', () =>
    {
        const groups = groupDangers([
            danger('d1', 's1', '2026-10-09T01:00:00.000Z'),
            danger('d2', 's2', '2026-10-09T01:00:50.000Z'),
            danger('d3', 's3', '2026-10-09T01:01:20.000Z'),
        ]);
        expect(groups.map(group => group.dangers.length)).toEqual([1, 2]);
    });
});

describe('siteLabel', () =>
{
    it('names a site by its trail colour (or camera) and clip time', () =>
    {
        expect(siteLabel(siteAlert('s', {}, { startT: 12.34, endT: 40 }))).toBe('Zone B · B1 · dug at 12.3 s');
        expect(siteLabel(siteAlert('s', {}, { startT: 9.4, colorIndex: 3 }))).toBe('Zone B · violet trail · dug at 9.4 s');
        expect(siteLabel(siteAlert('s', {}, { startT: 2, colorIndex: null, kind: 'TRACK_ONLY' }))).toBe('Zone B · B1 · seen at 2.0 s');
    });
});
