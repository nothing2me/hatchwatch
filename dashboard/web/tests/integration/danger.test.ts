import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrismaClient } from '@/lib/db';
import { importLiveChunk } from '@/lib/live/importChunk';
import { ageSites } from '@/lib/live/watcher';
import { importSimRun } from '@/lib/sim/importRun';
import { addSiteEvent } from '@/lib/sites/events';
import { loadMapSnapshot } from '@/server/snapshot';
import { seedDatabase } from '../../prisma/seed';
import { validManifest } from '../unit/live-manifest.test';

const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
let work: string;

const PINS = [
    { id: 'pin-1', point: [2, 3], interval: [4, 9], score: 1.2, evidence_tier: 'two_camera', source_views: [0, 1] },
    { id: 'pin-2', point: [-6, -2], interval: [5, 9], score: 0.9, evidence_tier: 'single_camera', source_views: [1] },
];
const TRACKS = [
    { id: 'track-1', pin_id: 'pin-2', points: [[0, -6, -7], [4, -6, -4], [8, -6, -2]] },
    { id: 'track-2', pin_id: 'pin-1', points: [[0, 2, -6], [4, 2, 0], [8, 2, 3]] },
    { id: 'track-3', pin_id: null, points: [[0, 9, -7], [3, 9, -4]] },
];
// Walk along x at y = 4, 1 m/s: within 3 m of pin-1 (2, 3) for t ≈ 4.2–9.8 s.
const walk = (id: string, t0: number, y = 4) => ({ id, max_height_m: 1.8, points: Array.from({ length: 15 }, (_, i) => [t0 + i, -5 + i, y]) });

function writePaths(dir: string, people: unknown[] | null, tracks: unknown[] | null = TRACKS)
{
    if (tracks)
    {
        mkdirSync(join(dir, 'tracks'), { recursive: true });
        writeFileSync(join(dir, 'tracks/tracks.json'), JSON.stringify({ schema: 'nesttrace.tracks', version: 1, note: 'test', tracks }));
    }
    if (people)
    {
        mkdirSync(join(dir, 'people'), { recursive: true });
        writeFileSync(join(dir, 'people/people.json'), JSON.stringify({ schema: 'nesttrace.people', version: 1, note: 'test', people }));
    }
}

function makeRun(name: string, people: unknown[] | null, tracks: unknown[] | null = TRACKS): string
{
    const dir = join(work, 'artifacts/public', name);
    for (const sub of ['view-0', 'view-1', 'pins'])
    {
        mkdirSync(join(dir, sub), { recursive: true });
    }
    for (const file of ['camera-0.mp4', 'camera-1.mp4', 'view-0/pure-motion.mp4', 'view-1/pure-motion.mp4'])
    {
        writeFileSync(join(dir, file), `video:${name}:${file}`);
    }
    for (const camera of [0, 1])
    {
        writeFileSync(join(dir, `calibration-${camera}.json`), JSON.stringify({ camera, width: 1280, height: 720, ground_bounds: [-12, 12, -8, 8] }));
    }
    writeFileSync(join(dir, 'timestamps.json'), JSON.stringify(Array.from({ length: 81 }, (_, i) => i * 0.125)));
    writeFileSync(join(dir, 'analysis.json'), JSON.stringify({ cameras: [0, 1], inference_complete: true }));
    writeFileSync(join(dir, 'pins/predictions.json'), JSON.stringify({ schema_version: 1, methods: { pins: PINS } }));
    writePaths(dir, people, tracks);
    return dir;
}

function makeChunk(people: unknown[]): string
{
    const id = 'live-000001-dng1';
    const dir = join(work, 'public', id);
    mkdirSync(join(dir, 'pins'), { recursive: true });
    for (const camera of [0, 1])
    {
        writeFileSync(join(dir, `camera-${camera}.mp4`), `video:${id}:${camera}`);
        writeFileSync(join(dir, `calibration-${camera}.json`), JSON.stringify({ camera, width: 1280, height: 720, ground_bounds: [-12, 12, -8, 8] }));
    }
    writeFileSync(join(dir, 'pins/predictions.json'), JSON.stringify({ schema_version: 1, methods: { pins: PINS } }));
    writePaths(dir, people);
    writeFileSync(join(dir, 'live-chunk.json'), JSON.stringify({ ...validManifest(), chunk_id: id, sequence: 1, recording_started_at: '2026-10-10T00:00:00.000Z' }));
    return dir;
}

const importRun = (runDir: string) => importSimRun({ runDir, pair: 'B', mediaRoot: join(work, 'media'), prisma });
const siteOf = (pinPoint: number) => prisma.alert.findFirstOrThrow({ where: { kind: 'DIGGING', startT: PINS[pinPoint].interval[0] } });
const volunteer = { userId: null, author: 'Vera' };

beforeAll(async () =>
{
    const [{ current_database: name }] = await prisma.$queryRawUnsafe<{ current_database: string }[]>('SELECT current_database()');
    if (!name.endsWith('_test'))
    {
        throw new Error(`Refusing to run against ${name}`);
    }
});
beforeEach(async () =>
{
    await prisma.$executeRawUnsafe('TRUNCATE "SiteEvent","LiveChunk","AuditLog","AlertStatusChange","AlertNote","Alert","Track","Job","Video","Camera","Zone","User" CASCADE');
    await seedDatabase(prisma, { adminEmail: 'admin@test.local', adminPassword: 'pw-for-tests' });
    work = mkdtempSync(join(tmpdir(), 'nt-danger-'));
});
afterAll(async () =>
{
    await prisma.$disconnect();
});

describe('importing trails and people', () =>
{
    it('stores trails on their pin site with pin-order colours; unmatched trails stay grey', async () =>
    {
        const result = await importRun(makeRun('A-seaward-humans-demo-1', null));
        expect(result).toMatchObject({ alertCount: 2, trackCount: 3, dangerCount: 0 });
        const [pin1, pin2] = [await siteOf(0), await siteOf(1)];
        const tracks = await prisma.track.findMany({ orderBy: { label: 'asc' } });
        expect(tracks.map(track => [track.label, track.alertId, track.colorIndex])).toEqual([
            ['track-1', pin2.id, 1],
            ['track-2', pin1.id, 0],
            ['track-3', null, null],
        ]);
        expect(tracks[0].videoId).toBe(pin2.videoId);
        expect(tracks[2].videoId).toBe(pin1.videoId);
        expect(tracks[1]).toMatchObject({ startT: 0, endT: 8, geoReferenced: true });
        const points = tracks[1].points as { t: number; lng: number; lat: number }[];
        expect(points).toHaveLength(3);
        expect(points[2]).toMatchObject({ t: 8, lng: pin1.lng, lat: pin1.lat });
    });

    it('raises one level-1 DANGER alert linked to the site, once per site per minute, with a danger entry on the site', async () =>
    {
        // person-2 is a fragment of the same walker 6 s later; person-3 walks 5 m+ from every site.
        const result = await importRun(makeRun('A-seaward-humans-demo-1', [walk('person-1', 0), walk('person-2', 6), walk('person-3', 0, 8.5)]));
        expect(result.dangerCount).toBe(1);
        const site = await siteOf(0);
        const dangers = await prisma.alert.findMany({ where: { kind: 'DANGER' }, include: { events: true } });
        expect(dangers).toHaveLength(1);
        expect(dangers[0]).toMatchObject({
            level: 1, siteId: site.id, status: 'NEW', zoneId: site.zoneId, cameraId: site.cameraId, videoId: site.videoId, simulated: true,
            message: 'Danger · person near an active nest site — immediate action',
        });
        expect(dangers[0].startT).toBeGreaterThan(4);
        expect(dangers[0].startT).toBeLessThan(5);
        expect(dangers[0].events.map(event => event.type)).toEqual(['danger']);
        const siteEvents = await prisma.siteEvent.findMany({ where: { alertId: site.id }, orderBy: { createdAt: 'asc' } });
        expect(siteEvents.map(event => event.type).sort()).toEqual(['danger', 'detected']);
        expect(siteEvents.find(event => event.type === 'danger')?.note).toMatch(/^Person within 3 m of the site at \d\d:\d\d \(person-1\)\.$/);
        expect(await prisma.alert.findUniqueOrThrow({ where: { id: site.id } })).toMatchObject({ kind: 'DIGGING', status: 'NEW', level: 0, message: 'Digging activity detected; nesting unresolved.' });
    });

    it('raises a new danger for an approach after the minute window', async () =>
    {
        const result = await importRun(makeRun('A-seaward-humans-demo-1', [walk('person-1', 0), walk('person-4', 70)]));
        expect(result.dangerCount).toBe(2);
        expect(await prisma.siteEvent.count({ where: { alertId: (await siteOf(0)).id, type: 'danger' } })).toBe(2);
    });

    it('is idempotent on re-import', async () =>
    {
        const runDir = makeRun('A-seaward-humans-demo-1', [walk('person-1', 0)]);
        await importRun(runDir);
        await importRun(runDir);
        expect(await prisma.alert.count({ where: { kind: 'DANGER' } })).toBe(1);
        expect(await prisma.alert.count()).toBe(3);
        expect(await prisma.track.count()).toBe(3);
        expect(await prisma.siteEvent.count({ where: { type: 'danger' } })).toBe(2);
    });

    it('re-imports after a danger was resolved', async () =>
    {
        const runDir = makeRun('A-seaward-humans-demo-1', [walk('person-1', 0)]);
        await importRun(runDir);
        const danger = await prisma.alert.findFirstOrThrow({ where: { kind: 'DANGER' } });
        await addSiteEvent(prisma, { alertId: danger.id, type: 'dangerResolved', ...volunteer });
        await importRun(runDir);
        expect(await prisma.alert.count({ where: { kind: 'DANGER', status: 'NEW' } })).toBe(1);
    });

    it('rejects a malformed people file before touching anything', async () =>
    {
        const runDir = makeRun('A-bad-people', [{ id: 'walker-1', points: [] }]);
        await expect(importRun(runDir)).rejects.toThrow();
        expect(await prisma.video.count()).toBe(0);
    });

    it('imports trails and dangers from a live chunk on the recording clock', async () =>
    {
        const result = await importLiveChunk(prisma, { chunkDir: makeChunk([walk('person-1', 0)]), mediaRoot: join(work, 'media') });
        expect(result).toMatchObject({ sites: 2, tracks: 3, dangers: 1 });
        const danger = await prisma.alert.findFirstOrThrow({ where: { kind: 'DANGER' } });
        expect(danger.detectedAt!.getTime()).toBeGreaterThan(new Date('2026-10-10T00:00:04Z').getTime());
        expect(danger.detectedAt!.getTime()).toBeLessThan(new Date('2026-10-10T00:00:05Z').getTime());
        expect(await prisma.track.count({ where: { alertId: { not: null } } })).toBe(2);
    });
});

describe('danger lifecycle', () =>
{
    async function imported()
    {
        await importRun(makeRun('A-seaward-humans-demo-1', [walk('person-1', 0)]));
        return { site: await siteOf(0), danger: await prisma.alert.findFirstOrThrow({ where: { kind: 'DANGER' } }) };
    }

    it('resolving the danger alert marks it REVIEWED and logs dangerResolved on its site', async () =>
    {
        const { site, danger } = await imported();
        const summary = await addSiteEvent(prisma, { alertId: danger.id, type: 'dangerResolved', note: 'walker left', ...volunteer });
        expect(summary).toMatchObject({ danger: 'resolved', active: false });
        expect((await prisma.alert.findUniqueOrThrow({ where: { id: danger.id } })).status).toBe('REVIEWED');
        const siteEvents = await prisma.siteEvent.findMany({ where: { alertId: site.id }, orderBy: [{ at: 'asc' }, { createdAt: 'asc' }] });
        expect(siteEvents.at(-1)).toMatchObject({ type: 'dangerResolved', author: 'Vera', note: 'walker left' });
        // The site keeps its own lifecycle: still open, now touched by a person.
        expect((await prisma.alert.findUniqueOrThrow({ where: { id: site.id } })).status).toBe('REVIEWED');
    });

    it('resolving an already resolved danger appends nothing', async () =>
    {
        const { danger } = await imported();
        await addSiteEvent(prisma, { alertId: danger.id, type: 'dangerResolved', ...volunteer });
        const count = () => prisma.siteEvent.count({ where: { type: 'dangerResolved' } });
        const before = await count();
        const summary = await addSiteEvent(prisma, { alertId: danger.id, type: 'dangerResolved', ...volunteer });
        expect(summary).toMatchObject({ danger: 'resolved' });
        expect(await count()).toBe(before);
    });

    it('only resolves danger alerts; other entries go on the nest site', async () =>
    {
        const { site, danger } = await imported();
        await expect(addSiteEvent(prisma, { alertId: danger.id, type: 'patrolVisit', ...volunteer })).rejects.toMatchObject({ code: 'WRONG_KIND' });
        await expect(addSiteEvent(prisma, { alertId: site.id, type: 'dangerResolved', ...volunteer })).rejects.toMatchObject({ code: 'WRONG_KIND' });
    });

    it('a patrol on the site resolves its open danger alerts', async () =>
    {
        const { site, danger } = await imported();
        expect(await addSiteEvent(prisma, { alertId: site.id, type: 'patrolVisit', ...volunteer })).toMatchObject({ danger: 'resolved' });
        expect((await prisma.alert.findUniqueOrThrow({ where: { id: danger.id } })).status).toBe('REVIEWED');
        expect(await prisma.siteEvent.count({ where: { alertId: danger.id, type: 'dangerResolved' } })).toBe(1);
    });

    it('ageSites never archives a danger alert or a site whose danger is open', async () =>
    {
        await importLiveChunk(prisma, { chunkDir: makeChunk([walk('person-1', 0)]), mediaRoot: join(work, 'media') });
        const settings = { root: join(work, 'public'), mediaRoot: join(work, 'media'), fadeMinutes: 5, archiveMinutes: 20, keep: 40 };
        expect(await ageSites(prisma, settings, new Date('2026-10-11T00:00:00Z'))).toBe(1);
        const alerts = await prisma.alert.findMany({ orderBy: { startT: 'asc' } });
        const byKind = alerts.map(alert => [alert.kind, alert.status]);
        expect(byKind).toContainEqual(['DANGER', 'NEW']);
        const site = alerts.find(alert => alert.kind === 'DIGGING' && alert.startT === 4)!;
        const other = alerts.find(alert => alert.kind === 'DIGGING' && alert.startT === 5)!;
        expect(site.status).toBe('NEW');
        expect(other.status).toBe('ARCHIVED');
    });
});

describe('snapshot', () =>
{
    it('carries trails, colours, danger counts and keeps resolved dangers in the inactive count', async () =>
    {
        await importRun(makeRun('A-seaward-humans-demo-1', [walk('person-1', 0)]));
        const site = await siteOf(0);
        let snapshot = await loadMapSnapshot(prisma);
        expect(snapshot.tracks).toHaveLength(3);
        expect(snapshot.tracks.every(track => track.key === 'A-seaward-humans-demo-1')).toBe(true);
        const trail = snapshot.tracks.find(track => track.alertId === site.id)!;
        expect(trail.colorIndex).toBe(0);
        expect(trail.points[0]).toMatchObject({ t: 0 });
        expect(trail.points[0].position).toHaveLength(2);
        expect(snapshot.alerts.find(alert => alert.id === site.id)).toMatchObject({ colorIndex: 0, level: 0, siteId: null, site: { danger: 'active' } });
        const danger = snapshot.alerts.find(alert => alert.kind === 'DANGER')!;
        expect(danger).toMatchObject({ level: 1, siteId: site.id, colorIndex: null, site: { active: true, danger: 'active' } });
        expect(snapshot).toMatchObject({ dangerCount: 1, dangerTotal: 1, inactiveCount: 0, outcomes: { saved: 0, notSaved: 0, pending: 2 } });

        await addSiteEvent(prisma, { alertId: danger.id, type: 'dangerResolved', ...volunteer });
        snapshot = await loadMapSnapshot(prisma);
        expect(snapshot).toMatchObject({ dangerCount: 0, dangerTotal: 1, inactiveCount: 1 });
        expect(snapshot.alerts.find(alert => alert.id === danger.id)?.site.active).toBe(false);
    });

    it('marks a site secured once its danger is resolved, and not while a newer danger is open', async () =>
    {
        await importRun(makeRun('A-seaward-humans-demo-1', [walk('person-1', 0)]));
        const site = await siteOf(0);
        const securedOfSite = async () => (await loadMapSnapshot(prisma)).alerts.find(alert => alert.id === site.id)?.site.secured;
        expect(await securedOfSite()).toBeNull();
        // A patrol answers the danger on the site log; the danger alert's resolution secures the site.
        await addSiteEvent(prisma, { alertId: site.id, type: 'patrolVisit', ...volunteer });
        const secured = await securedOfSite();
        expect(secured).toMatchObject({ by: 'Vera' });
        // A newer danger un-secures the site until protection (or a resolution) follows it.
        await addSiteEvent(prisma, { alertId: site.id, type: 'danger', author: 'Camera', userId: null, system: true, at: new Date(Date.parse(secured!.at) + 60_000) });
        expect(await securedOfSite()).toBeNull();
        await addSiteEvent(prisma, { alertId: site.id, type: 'protectionInstalled', ...volunteer, at: new Date(Date.parse(secured!.at) + 120_000) });
        expect(await securedOfSite()).toMatchObject({ by: 'Vera', at: new Date(Date.parse(secured!.at) + 120_000).toISOString() });
    });

    it('counts a site not saved when 30 min pass after a danger without protection (cached-status path)', async () =>
    {
        await importRun(makeRun('A-seaward-humans-demo-1', [walk('person-1', 0)]));
        const site = await siteOf(0);
        const now = new Date();
        expect((await loadMapSnapshot(prisma, now)).outcomes).toEqual({ saved: 0, notSaved: 0, pending: 2 });
        const later = new Date(now.getTime() + 31 * 60_000);
        expect((await loadMapSnapshot(prisma, later)).outcomes).toEqual({ saved: 0, notSaved: 1, pending: 1 });
        // Protection logged within the 30 min keeps it pending.
        await addSiteEvent(prisma, { alertId: site.id, type: 'protectionInstalled', ...volunteer, at: new Date(now.getTime() + 10 * 60_000) });
        expect((await loadMapSnapshot(prisma, later)).outcomes).toEqual({ saved: 0, notSaved: 0, pending: 2 });
    });
});
