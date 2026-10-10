import { describe, expect, it } from 'vitest';
import { toMapSnapshot, type SnapshotRows } from '@/server/snapshot';

const rows: SnapshotRows = {
    zones: [{ id: 'z1', code: 'B', name: 'Holiday', activityLevel: 'HIGH',
        outline: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }],
    cameras: [
        { id: 'c1', code: 'B1', zone: { code: 'B' }, lng: 1, lat: 2, headingDeg: 203, fovDeg: 44, rangeM: 350, status: 'ONLINE', calibration: null, videos: [{ id: 'v9', source: 'SIMULATION', durationS: 61.5, pureMotionPath: 'sim/R/motion-0.mp4', simRunId: 'R' }] },
        { id: 'c2', code: 'B2', zone: { code: 'B' }, lng: 3, lat: 4, headingDeg: 56, fovDeg: 44, rangeM: 350, status: 'OFFLINE', calibration: { pairs: [] }, videos: [] },
    ],
    alerts: [
        { id: 'a1', kind: 'DIGGING', message: 'Digging activity detected; nesting unresolved.', status: 'NEW', zone: { code: 'B' }, camera: { code: 'B1' }, lng: 1, lat: 2, radiusM: 0.9, score: 1.6, createdAt: new Date('2026-10-09T18:00:00Z'), videoId: 'v9', video: { simRunId: 'R' }, startT: 12, endT: 30, evidenceTier: 'TWO_CAMERA', simulated: true, events: [{ type: 'detected', at: new Date('2026-10-09T18:00:00Z') }] },
        { id: 'a2', kind: 'TRACK_ONLY', message: 'Crawl tracked; digging not observed.', status: 'REVIEWED', zone: { code: 'B' }, camera: { code: 'B1' }, lng: null, lat: null, radiusM: 0.9, score: null, createdAt: new Date('2026-10-09T17:00:00Z'), videoId: 'v9', video: { simRunId: null }, startT: 0, endT: 1, evidenceTier: null, simulated: false, events: [{ type: 'detected', at: new Date('2026-10-09T17:00:00Z') }, { type: 'patrolVisit', at: new Date('2026-10-09T17:30:00Z') }] },
    ],
};

describe('toMapSnapshot', () =>
{
    const snapshot = toMapSnapshot(rows);

    it('maps zones to rings', () =>
    {
        expect(snapshot.zones[0]).toMatchObject({ code: 'B', activityLevel: 'HIGH', ring: [[0, 0], [1, 0], [1, 1], [0, 0]], custom: false });
    });

    it('flags zones an admin added on the map', () =>
    {
        const added = toMapSnapshot({ ...rows, zones: [{ ...rows.zones[0], code: 'E', createdById: 'u1' }] });
        expect(added.zones[0]).toMatchObject({ code: 'E', custom: true });
    });

    it('maps cameras with calibration flag and latest video', () =>
    {
        expect(snapshot.cameras[0]).toMatchObject({ code: 'B1', zoneCode: 'B', position: [1, 2], calibrated: false });
        expect(snapshot.cameras[0].video).toEqual({ id: 'v9', source: 'SIMULATION', durationS: 61.5, hasMotion: true, simRunId: 'R' });
        expect(snapshot.cameras[1]).toMatchObject({ calibrated: true, status: 'OFFLINE' });
        expect(snapshot.cameras[1].video).toBeNull();
    });

    it('counts cameras online and NEW alerts', () =>
    {
        expect(snapshot.camerasOnline).toBe(1);
        expect(snapshot.camerasTotal).toBe(2);
        expect(snapshot.activeAlertCount).toBe(1);
    });

    it('maps alert positions and ISO dates', () =>
    {
        expect(snapshot.alerts[0]).toMatchObject({ position: [1, 2], createdAt: '2026-10-09T18:00:00.000Z' });
        expect(snapshot.alerts[0]).toMatchObject({ videoId: 'v9', simRunId: 'R', startT: 12, endT: 30, evidenceTier: 'TWO_CAMERA', simulated: true });
        expect(snapshot.alerts[1].position).toBeNull();
    });

    it('adds site summaries, inactive count, outcomes and the fade window', () =>
    {
        expect(snapshot.alerts[0].site).toMatchObject({ nesting: 'unresolved', active: true, personActed: false });
        expect(snapshot.alerts[1].site).toMatchObject({ patrolVisited: true, personActed: true });
        expect(snapshot.inactiveCount).toBe(0);
        expect(snapshot.outcomes).toEqual({ saved: 0, notSaved: 0, pending: 2 });
        expect(snapshot.fadeMinutes).toBe(5);
    });
});
