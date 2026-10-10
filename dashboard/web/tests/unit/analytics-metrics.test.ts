import { describe, expect, it } from 'vitest';
import { analyticsMetrics, dangerStats, percentOf } from '@/features/analytics/metrics';
import type { MapSnapshot, ZoneView } from '@/lib/types';
import { siteAlert } from './siteFixtures';

const zone = (code: string, name: string): ZoneView => ({ id: `z${code}`, code, name, activityLevel: 'LOW', ring: [] });

const alerts = [
    siteAlert('a1'),
    siteAlert('a2', { protection: 'protected', nesting: 'confirmed', personActed: true, patrolVisited: true }, { zoneCode: 'A', evidenceTier: 'SINGLE_CAMERA' }),
    siteAlert('a3', { patrolVisited: true, personActed: true }, { evidenceTier: null }),
    siteAlert('a4', { active: false, outcome: 'hatched', nesting: 'confirmed', protection: 'protected', personActed: true, patrolVisited: true }),
    siteAlert('a5', { active: false, archivedAt: '2026-10-09T00:20:00.000Z' }, { zoneCode: 'A' }),
    siteAlert('a6', { active: false, nesting: 'noNest', protection: 'notNeeded', personActed: true, patrolVisited: true }),
];

const snapshot: Pick<MapSnapshot, 'alerts' | 'zones' | 'outcomes' | 'inactiveCount'> = {
    alerts,
    zones: [zone('A', 'Sand Point access'), zone('B', 'Holiday Beach access'), zone('C', 'Pelican Condos stretch')],
    // Whole-log numbers come from the server, which may see more than the snapshot carries.
    outcomes: { saved: 4, notSaved: 2, pending: 3 },
    inactiveCount: 5,
};

describe('percentOf', () =>
{
    it('rounds and treats an empty whole as zero', () =>
    {
        expect(percentOf(1, 3)).toBe(33);
        expect(percentOf(2, 3)).toBe(67);
        expect(percentOf(0, 0)).toBe(0);
    });
});

describe('analyticsMetrics', () =>
{
    it('counts only active sites on the map scope', () =>
    {
        const m = analyticsMetrics(snapshot, 'map');
        expect(m.sites).toBe(3);
        expect(m.charted).toBe(3);
        expect(m.unprotected).toBe(2);
        expect(m.unprotectedPct).toBe(67);
        expect(m.patrolVisited).toBe(2);
        expect(m.bothCameras).toBe(1);
        expect(m.bothCamerasPct).toBe(33);
        expect(m.archived).toBe(0);
        expect(m.protection.map(bar => [bar.key, bar.count])).toEqual([['unprotected', 2], ['protected', 1], ['notNeeded', 0]]);
        expect(m.nesting.map(bar => [bar.key, bar.count])).toEqual([['unresolved', 2], ['confirmed', 1], ['noNest', 0]]);
        // Every zone is listed, empty ones included, in map order.
        expect(m.byZone.map(bar => [bar.key, bar.count])).toEqual([['A', 1], ['B', 2], ['C', 0]]);
        // Outcomes are recomputed from the active sites: all still pending.
        expect(m.outcomes).toEqual({ saved: 0, notSaved: 0, pending: 3 });
    });

    it('covers everything in the snapshot on the all scope, with whole-log totals and outcomes', () =>
    {
        const m = analyticsMetrics(snapshot, 'all');
        // Active (3) + server inactive count (5), matching the map's two tabs.
        expect(m.sites).toBe(8);
        expect(m.charted).toBe(6);
        expect(m.unprotected).toBe(3);
        expect(m.unprotectedPct).toBe(50);
        expect(m.patrolVisited).toBe(4);
        expect(m.bothCameras).toBe(4);
        expect(m.bothCamerasPct).toBe(67);
        expect(m.archived).toBe(1);
        expect(m.protection.map(bar => bar.count)).toEqual([3, 2, 1]);
        expect(m.nesting.map(bar => bar.count)).toEqual([3, 2, 1]);
        expect(m.byZone.map(bar => bar.count)).toEqual([2, 4, 0]);
        expect(m.outcomes).toEqual({ saved: 4, notSaved: 2, pending: 3 });
    });

    it('never reports fewer sites than it charts', () =>
    {
        const m = analyticsMetrics({ ...snapshot, inactiveCount: 0 }, 'all');
        expect(m.sites).toBe(6);
    });

    it('labels bars with protection colours and zone names', () =>
    {
        const m = analyticsMetrics(snapshot, 'all');
        expect(m.protection.map(bar => bar.color)).toEqual(['#E2581F', '#4ADE80', '#8A9BA6']);
        expect(m.protection.map(bar => bar.label)).toEqual(['Unprotected', 'Protected', 'Not needed']);
        expect(m.byZone[0]).toMatchObject({ key: 'A', label: 'Zone A', detail: 'Sand Point access' });
    });

    it('handles an empty snapshot', () =>
    {
        const m = analyticsMetrics({ alerts: [], zones: [], outcomes: { saved: 0, notSaved: 0, pending: 0 }, inactiveCount: 0 }, 'map');
        expect(m).toMatchObject({ sites: 0, unprotected: 0, unprotectedPct: 0, bothCamerasPct: 0, byZone: [] });
    });
});

describe('danger alerts in analytics', () =>
{
    it('are not counted as sites, in either scope', () =>
    {
        const open = siteAlert('d1', { danger: 'active' }, { kind: 'DANGER', level: 1, siteId: 'a1' });
        const resolved = siteAlert('d2', { danger: 'resolved', active: false }, { kind: 'DANGER', level: 1, siteId: 'a3', status: 'REVIEWED' });
        const base = analyticsMetrics(snapshot, 'all');
        // The server's inactive count includes the resolved danger alert; analytics takes it back out.
        const withDangers = analyticsMetrics({ ...snapshot, alerts: [...alerts, open, resolved], inactiveCount: snapshot.inactiveCount + 1, dangerCount: 1, dangerTotal: 2 }, 'all');
        expect(withDangers).toEqual(base);
        expect(analyticsMetrics({ ...snapshot, alerts: [...alerts, open] }, 'map')).toEqual(analyticsMetrics(snapshot, 'map'));
    });
});

describe('Not saved after a danger, on the client clock', () =>
{
    const generatedAt = '2026-10-09T01:00:00.000Z';
    const deadline = '2026-10-09T01:10:00.000Z';
    const before = Date.parse('2026-10-09T01:05:00.000Z');
    const after = Date.parse('2026-10-09T01:10:00.000Z');
    const site = siteAlert('s1', { danger: 'active', dangerDeadline: deadline });
    const base = { ...snapshot, alerts: [site], outcomes: { saved: 4, notSaved: 2, pending: 3 }, generatedAt };

    it('moves a site from pending to not saved on the map scope once its deadline passes', () =>
    {
        expect(analyticsMetrics(base, 'map', before).outcomes).toEqual({ saved: 0, notSaved: 0, pending: 1 });
        expect(analyticsMetrics(base, 'map', after).outcomes).toEqual({ saved: 0, notSaved: 1, pending: 0 });
    });

    it('adjusts the server whole-log outcomes for deadlines passed since the snapshot was made', () =>
    {
        expect(analyticsMetrics(base, 'all', before).outcomes).toEqual({ saved: 4, notSaved: 2, pending: 3 });
        expect(analyticsMetrics(base, 'all', after).outcomes).toEqual({ saved: 4, notSaved: 3, pending: 2 });
        // A deadline the server already counted is not moved twice.
        expect(analyticsMetrics({ ...base, generatedAt: '2026-10-09T01:20:00.000Z' }, 'all', Date.parse('2026-10-09T01:30:00.000Z')).outcomes).toEqual({ saved: 4, notSaved: 2, pending: 3 });
    });
});

describe('dangerStats', () =>
{
    it('reports open and total danger alerts from the server counts', () =>
    {
        expect(dangerStats({ dangerCount: 2, dangerTotal: 5 })).toEqual({ active: 2, total: 5 });
        expect(dangerStats({})).toEqual({ active: 0, total: 0 });
    });
});
