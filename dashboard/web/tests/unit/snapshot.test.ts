import { describe, expect, it } from 'vitest';
import { outcomesFromStatusCounts, toMapSnapshot, type SnapshotRows } from '@/server/snapshot';
import { distanceBetween } from '@/lib/geo';

const rows: SnapshotRows = {
    zones: [{ id: 'z1', code: 'B', name: 'Holiday', activityLevel: 'HIGH',
        outline: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }],
    cameras: [
        { id: 'c1', code: 'B1', zone: { code: 'B' }, lng: 1, lat: 2, headingDeg: 203, fovDeg: 44, rangeM: 350, status: 'ONLINE', calibration: null, videos: [{ id: 'v9', source: 'SIMULATION', durationS: 61.5, pureMotionPath: 'sim/R/motion-0.mp4', simRunId: 'R' }], liveDevice: null },
        { id: 'c2', code: 'B2', zone: { code: 'B' }, lng: 3, lat: 4, headingDeg: 56, fovDeg: 44, rangeM: 350, status: 'OFFLINE', calibration: { pairs: [] }, videos: [], liveDevice: null },
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
        expect(snapshot.zones[0]).toMatchObject({ code: 'B', activityLevel: 'HIGH', ring: [[0, 0], [1, 0], [1, 1], [0, 0]] });
    });

    it('maps cameras with calibration flag and latest video', () =>
    {
        expect(snapshot.cameras[0]).toMatchObject({ code: 'B1', zoneCode: 'B', position: [1, 2], calibrated: false });
        expect(snapshot.cameras[0].video).toEqual({ id: 'v9', source: 'SIMULATION', durationS: 61.5, hasMotion: true, simRunId: 'R' });
        expect(snapshot.cameras[1]).toMatchObject({ calibrated: true, status: 'OFFLINE' });
        expect(snapshot.cameras[1].video).toBeNull();
    });

    it('places a public motion image at its declared ground scale', () =>
    {
        const frameRows: SnapshotRows = { ...rows,
            zones: [{ ...rows.zones[0], outline: { type: 'Polygon', coordinates: [[[-80, 25], [-79.999, 25], [-79.999, 25.001], [-80, 25.001], [-80, 25]]] } }],
            cameras: [{ ...rows.cameras[0], videos: [{ ...rows.cameras[0].videos[0], motionMapPath: 'live/live-000007-abc12/view-0/motion-map.png', motionFitRmseM: 0.12, liveChunk: { groundBounds: [-12, 12, -8, 8] } }] }],
        };
        const overlay = toMapSnapshot(frameRows).cameras[0].video?.motionMap;
        expect(overlay?.url).toBe('/api/media/motion-map/v9');
        expect(overlay?.fitRmseM).toBe(0.12);
        expect(distanceBetween(overlay!.corners[0], overlay!.corners[1])).toBeCloseTo(24, 1);
        expect(distanceBetween(overlay!.corners[1], overlay!.corners[2])).toBeCloseTo(16, 1);
        const shiftedRows: SnapshotRows = { ...frameRows, cameras: [{ ...frameRows.cameras[0], videos: [{ ...frameRows.cameras[0].videos[0], liveChunk: { groundBounds: [-12, 12, -8, 8], placementOffsetM: 40 } }] }] };
        const shifted = toMapSnapshot(shiftedRows).cameras[0].video?.motionMap;
        expect(distanceBetween(overlay!.corners[0], shifted!.corners[0])).toBeCloseTo(40, 1);
        expect(distanceBetween(shifted!.corners[0], shifted!.corners[1])).toBeCloseTo(24, 1);
    });

    it('counts cameras online and carries no NEW-alert count', () =>
    {
        expect(snapshot.camerasOnline).toBe(1);
        expect(snapshot.camerasTotal).toBe(2);
        expect(snapshot).not.toHaveProperty('activeAlertCount');
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

describe('outcomesFromStatusCounts', () =>
{
    it('maps cached statuses to saved, not saved and pending', () =>
    {
        expect(outcomesFromStatusCounts([
            { status: 'HATCHED', _count: 2 },
            { status: 'LOST', _count: 3 },
            { status: 'ARCHIVED', _count: 4 },
            { status: 'DISMISSED', _count: 50 },
            { status: 'NEW', _count: 5 },
            { status: 'REVIEWED', _count: 6 },
            { status: 'FIELD_CONFIRMED', _count: 7 },
        ])).toEqual({ saved: 2, notSaved: 7, pending: 18 });
        expect(outcomesFromStatusCounts([])).toEqual({ saved: 0, notSaved: 0, pending: 0 });
    });

    it('is used when supplied instead of the loaded sites', () =>
    {
        expect(toMapSnapshot({ ...rows, outcomes: { saved: 9, notSaved: 8, pending: 7 } }).outcomes).toEqual({ saved: 9, notSaved: 8, pending: 7 });
    });
});

describe('danger fields', () =>
{
    it('names who resolved a danger and stamps when the snapshot was made', () =>
    {
        const danger = { ...rows.alerts[0], id: 'd1', kind: 'DANGER' as const, status: 'REVIEWED' as const, level: 1, siteId: 'a1', events: [
            { type: 'danger', at: new Date('2026-10-09T18:01:00Z'), author: 'Camera' },
            { type: 'dangerResolved', at: new Date('2026-10-09T18:05:00Z'), author: 'Vera Volunteer' },
        ] };
        const snapshot = toMapSnapshot({ ...rows, alerts: [...rows.alerts, danger], now: new Date('2026-10-09T19:00:00Z') });
        expect(snapshot.alerts[2]).toMatchObject({ resolvedBy: 'Vera Volunteer', resolvedAt: '2026-10-09T18:05:00.000Z' });
        expect(snapshot.alerts[0]).toMatchObject({ resolvedBy: null, resolvedAt: null });
        expect(snapshot.generatedAt).toBe('2026-10-09T19:00:00.000Z');
    });
});

describe('secured sites', () =>
{
    const siteWithDanger = { ...rows.alerts[0], events: [
        { type: 'detected', at: new Date('2026-10-09T18:00:00Z'), author: 'Camera' },
        { type: 'danger', at: new Date('2026-10-09T18:01:00Z'), author: 'Camera' },
        { type: 'patrolVisit', at: new Date('2026-10-09T18:04:00Z'), author: 'Pat' },
    ] };

    it('counts a resolution logged on the site\'s danger alert', () =>
    {
        const danger = { ...rows.alerts[0], id: 'd1', kind: 'DANGER' as const, status: 'REVIEWED' as const, level: 1, siteId: 'a1', events: [
            { type: 'danger', at: new Date('2026-10-09T18:01:00Z'), author: 'Camera' },
            { type: 'dangerResolved', at: new Date('2026-10-09T18:04:00Z'), author: 'Pat' },
        ] };
        const snapshot = toMapSnapshot({ ...rows, alerts: [siteWithDanger, danger] });
        expect(snapshot.alerts[0].site.secured).toEqual({ by: 'Pat', at: '2026-10-09T18:04:00.000Z' });
        expect(snapshot.alerts[1].site.secured).toBeNull();
    });

    it('uses the separately loaded danger resolutions when given', () =>
    {
        expect(toMapSnapshot({ ...rows, alerts: [siteWithDanger] }).alerts[0].site.secured).toBeNull();
        const snapshot = toMapSnapshot({ ...rows, alerts: [siteWithDanger], dangerResolutions: [{ siteId: 'a1', at: new Date('2026-10-09T18:06:00Z'), author: 'Rae' }] });
        expect(snapshot.alerts[0].site.secured).toEqual({ by: 'Rae', at: '2026-10-09T18:06:00.000Z' });
    });
});

describe('camera-level danger', () =>
{
    it('maps a danger without a clip or site and leaves outcomes alone', () =>
    {
        const camera = { ...rows.alerts[0], id: 'cd1', kind: 'DANGER' as const, message: 'Danger · person seen on camera B1 near active nest sites — check now', level: 1, siteId: null, videoId: null, video: null, score: null, radiusM: 0, startT: 0, endT: 0, simulated: false, evidenceTier: null, events: [
            { type: 'danger', at: new Date('2026-10-09T18:01:00Z'), author: 'Camera' },
        ] };
        const now = new Date('2026-10-09T19:00:00Z');
        const snapshot = toMapSnapshot({ ...rows, alerts: [...rows.alerts, camera], now });
        expect(snapshot.alerts[2]).toMatchObject({ id: 'cd1', videoId: null, simRunId: null, siteId: null, level: 1 });
        expect(snapshot.outcomes).toEqual(toMapSnapshot({ ...rows, now }).outcomes);
    });
});
