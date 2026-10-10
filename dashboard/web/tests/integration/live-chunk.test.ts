import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrismaClient } from '@/lib/db';
import { importLiveChunk } from '@/lib/live/importChunk';
import { ageSites, pruneMedia, scanOnce, type LiveSettings } from '@/lib/live/watcher';
import { addSiteEvent } from '@/lib/sites/events';
import { importSimRun } from '@/lib/sim/importRun';
import { seedDatabase } from '../../prisma/seed';
import { loadMapSnapshot } from '@/server/snapshot';
import { validManifest } from '../unit/live-manifest.test';

const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
let work: string;
let settings: LiveSettings;

const START = '2026-10-10T00:00:00.000Z';

function makeChunk(sequence: number, { pins = true, motion = false, started = START, tag = `abc${sequence}` }: { pins?: boolean; motion?: boolean; started?: string; tag?: string } = {}): string
{
    const id = `live-${String(sequence).padStart(6, '0')}-${tag}`;
    const dir = join(settings.root, id);
    mkdirSync(join(dir, 'pins'), { recursive: true });
    for (const camera of [0, 1])
    {
        writeFileSync(join(dir, `camera-${camera}.mp4`), `video:${id}:${camera}`);
        writeFileSync(join(dir, `calibration-${camera}.json`), JSON.stringify({ camera, width: 1280, height: 720, ground_bounds: [-12, 12, -8, 8] }));
        if (motion)
        {
            mkdirSync(join(dir, `view-${camera}/detection`), { recursive: true });
            writeFileSync(join(dir, `view-${camera}/motion-map.png`), 'png');
            writeFileSync(join(dir, `view-${camera}/pure-motion.mp4`), 'motion-video');
            writeFileSync(join(dir, `view-${camera}/metadata.json`), JSON.stringify({ calibration_fit_rmse_m: 0.12 }));
            writeFileSync(join(dir, `view-${camera}/detection/predictions.json`), JSON.stringify({ methods: { frozen: [{ id: 'frozen-1', point: [camera ? 3 : -3, 2], interval: [5, 10], radius_m: 0.9, score: 0.8 }] } }));
        }
    }
    const list = pins ? [
        { id: 'pin-1', point: [2, 3], interval: [4, 9], score: 1.2, evidence_tier: 'two_camera', source_views: [0, 1] },
        { id: 'pin-2', point: [-3, 1], interval: [10, 20], score: 0.8, evidence_tier: 'single_camera', source_views: [1] },
    ] : [];
    writeFileSync(join(dir, 'pins/predictions.json'), JSON.stringify({ schema_version: 1, methods: { pins: list } }));
    const manifest = validManifest();
    if (motion) manifest.cameras.forEach((camera, index) => Object.assign(camera, { motion_map: `view-${index}/motion-map.png`, motion_metadata: `view-${index}/metadata.json`, motion_candidates: `view-${index}/detection/predictions.json`, pure_motion: `view-${index}/pure-motion.mp4` }));
    writeFileSync(join(dir, 'live-chunk.json'), JSON.stringify({ ...manifest, chunk_id: id, sequence, recording_started_at: started }));
    return dir;
}

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
    work = mkdtempSync(join(tmpdir(), 'nt-live-'));
    settings = { root: join(work, 'public'), mediaRoot: join(work, 'media'), fadeMinutes: 5, archiveMinutes: 20, keep: 40 };
    mkdirSync(settings.root, { recursive: true });
});
afterAll(async () =>
{
    await prisma.$disconnect();
});

describe('importLiveChunk', () =>
{
    it('imports measured motion maps and unclassified pins at true ground scale', async () =>
    {
        const dir = makeChunk(0, { pins: false, motion: true });
        await importLiveChunk(prisma, { chunkDir: dir, mediaRoot: settings.mediaRoot });
        const videos = await prisma.video.findMany({ orderBy: { path: 'asc' } });
        expect(videos.map(video => [video.motionMapPath, video.motionFitRmseM])).toEqual([
            ['live/live-000000-abc0/view-0/motion-map.png', 0.12],
            ['live/live-000000-abc0/view-1/motion-map.png', 0.12],
        ]);
        expect(existsSync(join(settings.mediaRoot, videos[0].motionMapPath!))).toBe(true);
        expect(existsSync(join(settings.mediaRoot, videos[0].pureMotionPath!))).toBe(true);
        const snapshot = await loadMapSnapshot(prisma);
        expect(snapshot.alerts).toHaveLength(0);
        expect(snapshot.motionCandidates).toHaveLength(2);
        expect(snapshot.cameras.filter(camera => camera.video?.motionMap)).toHaveLength(2);
        expect(snapshot.cameras.filter(camera => camera.video?.hasMotion)).toHaveLength(2);
    });
    it('places the chunk on zone sequence % count and maps cameras by end', async () =>
    {
        const dir = makeChunk(7);
        const result = await importLiveChunk(prisma, { chunkDir: dir, mediaRoot: settings.mediaRoot });
        expect(result).toEqual({ chunkId: 'live-000007-abc7', zoneCode: 'D', sites: 2 });
        expect(await prisma.liveChunk.findUniqueOrThrow({ where: { id: 'live-000007-abc7' } })).toMatchObject({ sequence: 7 });
        const videos = await prisma.video.findMany({ include: { camera: true }, orderBy: { path: 'asc' } });
        expect(videos.map(video => [video.camera.code, video.source, video.simRunId, video.liveChunkId, video.pureMotionPath, video.path])).toEqual([
            ['D1', 'SIMULATION', 'live-000007-abc7', 'live-000007-abc7', null, 'live/live-000007-abc7/camera-0.mp4'],
            ['D2', 'SIMULATION', 'live-000007-abc7', 'live-000007-abc7', null, 'live/live-000007-abc7/camera-1.mp4'],
        ]);
        expect(existsSync(join(settings.mediaRoot, 'live/live-000007-abc7/camera-1.mp4'))).toBe(true);
        const alerts = await prisma.alert.findMany({ include: { camera: true, events: { orderBy: { at: 'asc' } } }, orderBy: { score: 'desc' } });
        expect(alerts).toHaveLength(2);
        expect(alerts.every(alert => alert.message === 'Digging activity detected; nesting unresolved.')).toBe(true);
        expect(alerts[0].camera.code).toBe('D1');
        expect(alerts[1].camera.code).toBe('D2');
        expect(alerts[0].detectedAt?.toISOString()).toBe('2026-10-10T00:00:04.000Z');
        expect(alerts[0].events.map(event => [event.type, event.author])).toEqual([['detected', 'Camera'], ['departed', 'Camera']]);
        expect(alerts[0].status).toBe('NEW');
    });

    it('returns null and creates nothing on a second import', async () =>
    {
        const dir = makeChunk(0);
        await importLiveChunk(prisma, { chunkDir: dir, mediaRoot: settings.mediaRoot });
        expect(await importLiveChunk(prisma, { chunkDir: dir, mediaRoot: settings.mediaRoot })).toBeNull();
        expect(await prisma.video.count()).toBe(2);
        expect(await prisma.alert.count()).toBe(2);
    });

    it('refuses private paths and leaves nothing behind when a file is missing', async () =>
    {
        const privateDir = join(work, 'private', 'live-000001-abc1');
        mkdirSync(privateDir, { recursive: true });
        await expect(importLiveChunk(prisma, { chunkDir: privateDir, mediaRoot: settings.mediaRoot })).rejects.toThrow(/private/);
        const dir = makeChunk(2);
        rmSync(join(dir, 'camera-1.mp4'));
        await expect(importLiveChunk(prisma, { chunkDir: dir, mediaRoot: settings.mediaRoot })).rejects.toThrow(/camera-1\.mp4/);
        expect(existsSync(join(settings.mediaRoot, 'live'))).toBe(false);
        expect(await prisma.liveChunk.count()).toBe(0);
    });

    it('gives a re-detection a new alert and never reuses an archived one', async () =>
    {
        await importLiveChunk(prisma, { chunkDir: makeChunk(0), mediaRoot: settings.mediaRoot });
        const first = await prisma.alert.findFirstOrThrow();
        await addSiteEvent(prisma, { alertId: first.id, type: 'archived', userId: null, author: 'Live feed', system: true });
        await importLiveChunk(prisma, { chunkDir: makeChunk(4), mediaRoot: settings.mediaRoot });
        expect(await prisma.alert.count()).toBe(4);
        expect((await prisma.alert.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('ARCHIVED');
    });
});

describe('concurrency and retries', () =>
{
    it('two simultaneous imports of one chunk yield one result and keep the media', async () =>
    {
        const dir = makeChunk(3);
        const results = await Promise.all([
            importLiveChunk(prisma, { chunkDir: dir, mediaRoot: settings.mediaRoot }),
            importLiveChunk(prisma, { chunkDir: dir, mediaRoot: settings.mediaRoot }),
        ]);
        expect(results.filter(result => result !== null)).toHaveLength(1);
        for (const camera of [0, 1])
        {
            expect(existsSync(join(settings.mediaRoot, `live/live-000003-abc3/camera-${camera}.mp4`))).toBe(true);
        }
        expect(readdirSync(join(settings.mediaRoot, 'live'))).toEqual(['live-000003-abc3']);
        expect(await prisma.alert.count()).toBe(2);
    });

    it('imports a chunk whose sequence another chunk already used', async () =>
    {
        await importLiveChunk(prisma, { chunkDir: makeChunk(5), mediaRoot: settings.mediaRoot });
        const dir = makeChunk(6);
        const manifestPath = join(dir, 'live-chunk.json');
        writeFileSync(manifestPath, JSON.stringify({ ...JSON.parse(readFileSync(manifestPath, 'utf8')), sequence: 5 }));
        expect(await scanOnce(prisma, settings)).toBe(1);
        expect(await prisma.liveChunk.count({ where: { sequence: 5 } })).toBe(2);
    });

    it('attempts a failing chunk once until its manifest changes', async () =>
    {
        const dir = makeChunk(8);
        rmSync(join(dir, 'camera-1.mp4'));
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await scanOnce(prisma, settings);
        await scanOnce(prisma, settings);
        await scanOnce(prisma, settings);
        expect(error).toHaveBeenCalledTimes(1);
        writeFileSync(join(dir, 'camera-1.mp4'), 'video');
        const later = new Date(Date.now() + 5000);
        utimesSync(join(dir, 'live-chunk.json'), later, later);
        expect(await scanOnce(prisma, settings)).toBe(1);
        error.mockRestore();
    });
});

describe('scanOnce', () =>
{
    it('imports new chunks once, ignoring folders without a manifest', async () =>
    {
        makeChunk(0);
        rmSync(join(makeChunk(1), 'live-chunk.json'));
        expect(await scanOnce(prisma, settings)).toBe(1);
        expect(await scanOnce(prisma, settings)).toBe(0);
        expect(await prisma.liveChunk.count()).toBe(1);
    });

    it('keeps going when one chunk is malformed', async () =>
    {
        const bad = makeChunk(0);
        writeFileSync(join(bad, 'live-chunk.json'), '{"nope":1}');
        makeChunk(1);
        expect(await scanOnce(prisma, settings)).toBe(1);
    });
});

describe('ageSites', () =>
{
    it('archives untouched sites older than the limit and keeps person-touched ones', async () =>
    {
        await importLiveChunk(prisma, { chunkDir: makeChunk(0), mediaRoot: settings.mediaRoot });
        const [a, b] = await prisma.alert.findMany({ orderBy: { score: 'desc' } });
        const admin = await prisma.user.findFirstOrThrow();
        await addSiteEvent(prisma, { alertId: b.id, type: 'patrolVisit', userId: admin.id, author: 'Admin' });
        const soon = new Date('2026-10-10T00:10:00.000Z');
        expect(await ageSites(prisma, settings, soon)).toBe(0);
        const later = new Date('2026-10-10T00:30:00.000Z');
        expect(await ageSites(prisma, settings, later)).toBe(1);
        expect(await ageSites(prisma, settings, later)).toBe(0);
        expect((await prisma.alert.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('ARCHIVED');
        expect((await prisma.alert.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('REVIEWED');
        const event = await prisma.siteEvent.findFirstOrThrow({ where: { alertId: a.id, type: 'archived' } });
        expect(event).toMatchObject({ author: 'Live feed', note: 'Older than 20 min; removed from the live map. The log is kept.' });
    });
});

describe('ageSites guards', () =>
{
    it('never archives sim-import demo sites', async () =>
    {
        const dir = join(work, 'run/A-demo-1');
        mkdirSync(join(dir, 'view-0'), { recursive: true });
        mkdirSync(join(dir, 'view-1'), { recursive: true });
        mkdirSync(join(dir, 'pins'), { recursive: true });
        for (const file of ['camera-0.mp4', 'camera-1.mp4', 'view-0/pure-motion.mp4', 'view-1/pure-motion.mp4']) writeFileSync(join(dir, file), 'v');
        for (const camera of [0, 1]) writeFileSync(join(dir, `calibration-${camera}.json`), JSON.stringify({ camera, width: 1280, height: 720, ground_bounds: [-12, 12, -8, 8] }));
        writeFileSync(join(dir, 'timestamps.json'), JSON.stringify([0, 0.125, 0.25]));
        writeFileSync(join(dir, 'analysis.json'), '{}');
        writeFileSync(join(dir, 'pins/predictions.json'), JSON.stringify({ schema_version: 1, methods: { pins: [{ id: 'p', point: [1, 1], interval: [1, 2], score: 1, evidence_tier: 'two_camera', source_views: [0, 1] }] } }));
        await importSimRun({ runDir: dir, pair: 'B', mediaRoot: settings.mediaRoot, prisma });
        expect(await ageSites(prisma, settings, new Date(Date.now() + 3_600_000))).toBe(0);
    });

    it('skips a site a person touched after the candidate query (re-checked under the lock)', async () =>
    {
        await importLiveChunk(prisma, { chunkDir: makeChunk(0), mediaRoot: settings.mediaRoot });
        const alert = await prisma.alert.findFirstOrThrow();
        const admin = await prisma.user.findFirstOrThrow();
        await addSiteEvent(prisma, { alertId: alert.id, type: 'note', note: 'seen', userId: admin.id, author: 'Admin' });
        const result = await addSiteEvent(prisma, { alertId: alert.id, type: 'archived', userId: null, author: 'Live feed', system: true, onlyIfUntouched: true });
        expect(result).toBeNull();
        expect(await prisma.siteEvent.count({ where: { alertId: alert.id, type: 'archived' } })).toBe(0);
    });
});

describe('pruneMedia', () =>
{
    it('deletes media of older chunks but keeps rows', async () =>
    {
        settings.keep = 2;
        for (const sequence of [0, 1, 2])
        {
            await importLiveChunk(prisma, { chunkDir: makeChunk(sequence), mediaRoot: settings.mediaRoot });
        }
        expect(await pruneMedia(prisma, settings)).toBe(1);
        expect(await pruneMedia(prisma, settings)).toBe(0);
        expect(existsSync(join(settings.mediaRoot, 'live/live-000000-abc0'))).toBe(false);
        expect(existsSync(join(settings.mediaRoot, 'live/live-000002-abc2'))).toBe(true);
        expect((await prisma.liveChunk.findUniqueOrThrow({ where: { id: 'live-000000-abc0' } })).mediaPruned).toBe(true);
        expect(await prisma.video.count()).toBe(6);
    });

    it('keeps the newest imports when sequences restart after an artifacts reset', async () =>
    {
        settings.keep = 2;
        await importLiveChunk(prisma, { chunkDir: makeChunk(9, { tag: 'old' }), mediaRoot: settings.mediaRoot });
        await prisma.liveChunk.update({ where: { id: 'live-000009-old' }, data: { importedAt: new Date('2026-10-01T00:00:00Z') } });
        // The runner restarted: low sequences again, imported later than the high one.
        await importLiveChunk(prisma, { chunkDir: makeChunk(0, { tag: 'newa' }), mediaRoot: settings.mediaRoot });
        await prisma.liveChunk.update({ where: { id: 'live-000000-newa' }, data: { importedAt: new Date('2026-10-02T00:00:00Z') } });
        await importLiveChunk(prisma, { chunkDir: makeChunk(0, { tag: 'newb' }), mediaRoot: settings.mediaRoot });
        await prisma.liveChunk.update({ where: { id: 'live-000000-newb' }, data: { importedAt: new Date('2026-10-03T00:00:00Z') } });
        expect(await pruneMedia(prisma, settings)).toBe(1);
        const pruned = await prisma.liveChunk.findMany({ where: { mediaPruned: true }, select: { id: true } });
        expect(pruned.map(row => row.id)).toEqual(['live-000009-old']);
        expect(existsSync(join(settings.mediaRoot, 'live/live-000000-newa'))).toBe(true);
        expect(existsSync(join(settings.mediaRoot, 'live/live-000000-newb'))).toBe(true);
    });
});
