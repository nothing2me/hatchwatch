import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrismaClient } from '@/lib/db';
import { importSimRun } from '@/lib/sim/importRun';
import { seedDatabase } from '../../prisma/seed';

const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
let work: string;

function makeRun(name: string, pins: unknown[] | null): string
{
    const dir = join(work, 'artifacts/public', name);
    mkdirSync(join(dir, 'view-0'), { recursive: true });
    mkdirSync(join(dir, 'view-1'), { recursive: true });
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
    if (pins)
    {
        mkdirSync(join(dir, 'pins'), { recursive: true });
        writeFileSync(join(dir, 'pins/predictions.json'), JSON.stringify({ schema_version: 1, methods: { pins } }));
    }
    return dir;
}

const pin = (id: string, tier: 'two_camera' | 'single_camera') => ({
    id, point: [2, 3], interval: [4, 9], score: 1.2, evidence_tier: tier, source_views: tier === 'two_camera' ? [0, 1] : [1],
});

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
    work = mkdtempSync(join(tmpdir(), 'nt-sim-'));
});
afterAll(async () =>
{
    await prisma.$disconnect();
});

describe('importSimRun', () =>
{
    it('imports two looping videos and one alert per pin', async () =>
    {
        const runDir = makeRun('A-swarm-demo-907', [pin('pin-1', 'two_camera'), pin('pin-2', 'single_camera')]);
        const media = join(work, 'media');
        const result = await importSimRun({ runDir, pair: 'B', mediaRoot: media, prisma });

        expect(result.alertCount).toBe(2);
        const videos = await prisma.video.findMany({ where: { simRunId: 'A-swarm-demo-907' }, include: { camera: true }, orderBy: { camera: { code: 'asc' } } });
        expect(videos.map(video => [video.camera.code, video.source, video.path, video.pureMotionPath])).toEqual([
            ['B1', 'SIMULATION', 'sim/A-swarm-demo-907/camera-0.mp4', 'sim/A-swarm-demo-907/motion-0.mp4'],
            ['B2', 'SIMULATION', 'sim/A-swarm-demo-907/camera-1.mp4', 'sim/A-swarm-demo-907/motion-1.mp4'],
        ]);
        expect(videos[0].durationS).toBeCloseTo(10.125, 3);
        expect(videos[0].fps).toBeCloseTo(8, 3);
        expect(videos[0].width).toBe(1280);
        expect(readFileSync(join(media, 'sim/A-swarm-demo-907/motion-1.mp4'), 'utf8')).toBe('video:A-swarm-demo-907:view-1/pure-motion.mp4');
        expect(existsSync(join(media, 'sim/A-swarm-demo-907/import-manifest.json'))).toBe(true);

        const alerts = await prisma.alert.findMany({ orderBy: { score: 'desc' } });
        expect(alerts.every(alert => alert.message === 'Digging activity detected; nesting unresolved.')).toBe(true);
        expect(alerts.map(alert => alert.evidenceTier).sort()).toEqual(['SINGLE_CAMERA', 'TWO_CAMERA']);
        expect(alerts[0]).toMatchObject({ kind: 'DIGGING', simulated: true, startT: 4, endT: 9, videoId: videos[0].id, status: 'NEW' });
        expect(alerts[0].lng).not.toBeNull();
    });

    it('is idempotent for the same run', async () =>
    {
        const runDir = makeRun('A-swarm-demo-907', [pin('pin-1', 'two_camera')]);
        const media = join(work, 'media');
        await importSimRun({ runDir, pair: 'B', mediaRoot: media, prisma });
        await importSimRun({ runDir, pair: 'B', mediaRoot: media, prisma });
        expect(await prisma.video.count()).toBe(2);
        expect(await prisma.alert.count()).toBe(1);
    });

    it('imports videos without alerts when there is no pins file', async () =>
    {
        const runDir = makeRun('A-swarm-night-demo-919', null);
        const result = await importSimRun({ runDir, pair: 'D', mediaRoot: join(work, 'media'), prisma });
        expect(result.alertCount).toBe(0);
        expect(await prisma.video.count()).toBe(2);
    });

    it('refuses private paths and missing files before copying anything', async () =>
    {
        const media = join(work, 'media');
        // Exercises the importer's runtime refusal of private run folders.
        const privateDir = join(work, 'artifacts', 'private', 'A-swarm-demo-907');
        mkdirSync(privateDir, { recursive: true });
        await expect(importSimRun({ runDir: privateDir, pair: 'B', mediaRoot: media, prisma })).rejects.toThrow(/private/);
        const broken = makeRun('A-broken', null);
        rmSync(join(broken, 'camera-1.mp4'));
        await expect(importSimRun({ runDir: broken, pair: 'B', mediaRoot: media, prisma })).rejects.toThrow(/camera-1\.mp4/);
        expect(existsSync(join(media, 'sim'))).toBe(false);
    });

    it('rejects a malformed pins file', async () =>
    {
        const runDir = makeRun('A-bad-pins', [{ id: 'x' }]);
        const media = join(work, 'media');
        await expect(importSimRun({ runDir, pair: 'B', mediaRoot: media, prisma })).rejects.toThrow();
        expect(await prisma.video.count()).toBe(0);
        expect(existsSync(join(media, 'sim'))).toBe(false);
    });

    it('rejects a pin whose interval runs backwards', async () =>
    {
        const runDir = makeRun('A-bad-interval', [{ ...pin('pin-1', 'two_camera'), interval: [9, 4] }]);
        await expect(importSimRun({ runDir, pair: 'B', mediaRoot: join(work, 'media'), prisma })).rejects.toThrow();
    });

    it('re-imports after an alert gained notes and status changes', async () =>
    {
        const runDir = makeRun('A-swarm-demo-907', [pin('pin-1', 'two_camera')]);
        const media = join(work, 'media');
        await importSimRun({ runDir, pair: 'B', mediaRoot: media, prisma });
        const alert = await prisma.alert.findFirstOrThrow();
        const admin = await prisma.user.findFirstOrThrow();
        await prisma.alertNote.create({ data: { alertId: alert.id, userId: admin.id, body: 'checked' } });
        await prisma.alertStatusChange.create({ data: { alertId: alert.id, userId: admin.id, from: 'NEW', to: 'REVIEWED' } });
        const result = await importSimRun({ runDir, pair: 'B', mediaRoot: media, prisma });
        expect(result.alertCount).toBe(1);
        expect(await prisma.alert.count()).toBe(1);
        expect(await prisma.alertNote.count()).toBe(0);
    });

    it('replaces a different run previously imported onto the same pair', async () =>
    {
        const media = join(work, 'media');
        await importSimRun({ runDir: makeRun('A-swarm-demo-907', [pin('pin-1', 'two_camera')]), pair: 'B', mediaRoot: media, prisma });
        const alert = await prisma.alert.findFirstOrThrow();
        const admin = await prisma.user.findFirstOrThrow();
        await prisma.alertNote.create({ data: { alertId: alert.id, userId: admin.id, body: 'checked' } });
        await prisma.alertStatusChange.create({ data: { alertId: alert.id, userId: admin.id, from: 'NEW', to: 'REVIEWED' } });
        await importSimRun({ runDir: makeRun('A-swarm-demo-911', [pin('pin-1', 'two_camera'), pin('pin-2', 'single_camera')]), pair: 'B', mediaRoot: media, prisma });

        const videos = await prisma.video.findMany();
        expect(videos.map(video => video.simRunId)).toEqual(['A-swarm-demo-911', 'A-swarm-demo-911']);
        expect(await prisma.alert.count({ where: { videoId: { in: videos.map(video => video.id) } } })).toBe(2);
        expect(await prisma.alert.count()).toBe(2);
        expect(await prisma.alertNote.count()).toBe(0);
        expect(await prisma.alertStatusChange.count()).toBe(0);
    });

    it('attaches a single-camera pin to the camera that saw it', async () =>
    {
        const runDir = makeRun('A-swarm-demo-907', [pin('pin-1', 'two_camera'), pin('pin-2', 'single_camera')]);
        await importSimRun({ runDir, pair: 'B', mediaRoot: join(work, 'media'), prisma });
        const alerts = await prisma.alert.findMany({ include: { camera: true, video: true } });
        const byTier = Object.fromEntries(alerts.map(alert => [alert.evidenceTier, alert]));
        expect(byTier.TWO_CAMERA.camera.code).toBe('B1');
        expect(byTier.SINGLE_CAMERA.camera.code).toBe('B2');
        expect(byTier.SINGLE_CAMERA.video.cameraId).toBe(byTier.SINGLE_CAMERA.cameraId);
        expect(byTier.SINGLE_CAMERA.video.simRunId).toBe('A-swarm-demo-907');
    });
});
