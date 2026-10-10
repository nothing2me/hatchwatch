import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@/generated/prisma/client';
import { createPrismaClient } from '@/lib/db';
import { CameraDangerThrottle } from '@/lib/detections/cameraDanger';
import { postInternalDetections } from '@/lib/detections/http';
import { registerDevice } from '@/lib/phones/devices';
import { FrameStore } from '@/lib/phones/frameStore';
import { addSiteEvent } from '@/lib/sites/events';
import { loadMapSnapshot } from '@/server/snapshot';
import { seedDatabase } from '../../prisma/seed';

const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
const TOKEN = 'b'.repeat(64);
const T0 = Date.UTC(2026, 9, 10, 20, 0, 0);
const MESSAGE = 'Danger · person seen on camera A1 near active nest sites — check now';
let deviceId: string;
let adminId: string;
let cameraA1: { id: string; zoneId: string; lng: number; lat: number };
let store: FrameStore;
let throttle: CameraDangerThrottle;
let clock: number;

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
    await prisma.$executeRawUnsafe('TRUNCATE "LiveDevice","SiteEvent","LiveChunk","AuditLog","AlertStatusChange","AlertNote","Alert","Track","Job","Video","Camera","Zone","User" CASCADE');
    await seedDatabase(prisma, { adminEmail: 'admin@test.local', adminPassword: 'pw-for-tests' });
    adminId = (await prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.local' } })).id;
    deviceId = (await registerDevice(prisma, adminId, 'Dune phone')).id;
    cameraA1 = await prisma.camera.update({ where: { code: 'A1' }, data: { liveDeviceId: deviceId }, select: { id: true, zoneId: true, lng: true, lat: true } });
    store = new FrameStore();
    throttle = new CameraDangerThrottle();
    clock = T0;
});
afterAll(async () => { await prisma.$disconnect(); });

const jpeg = () => { const body = Buffer.alloc(64, 7); body[0] = 0xff; body[1] = 0xd8; return body; };

// A nest site in camera A1's zone, logged as detected; `extra` adds person entries (protection, no nest).
async function site(extra: ('protectionInstalled' | 'noNestFound')[] = []): Promise<string>
{
    const video = await prisma.video.create({ data: { cameraId: cameraA1.id, source: 'SIMULATION', path: 'x.mp4', originalName: 'x.mp4' } });
    const alert = await prisma.alert.create({ data: { videoId: video.id, cameraId: cameraA1.id, zoneId: cameraA1.zoneId, kind: 'DIGGING', message: 'Digging activity detected; nesting unresolved.', startT: 1, endT: 2, lng: cameraA1.lng, lat: cameraA1.lat } });
    await prisma.siteEvent.create({ data: { alertId: alert.id, type: 'detected', author: 'Camera', at: new Date(T0 - 60_000) } });
    for (const type of extra)
    {
        await addSiteEvent(prisma, { alertId: alert.id, type, userId: adminId, author: 'Ad', at: new Date(T0 - 30_000) });
    }
    return alert.id;
}

// One worker result at `clock`, after a fresh frame from the device.
async function seen({ spanMs = 2_500, score = 0.82, track = 'P1', device = deviceId } = {}): Promise<string>
{
    store.put(device, jpeg(), clock);
    const body = { at: clock, dark: false, width: 320, height: 240, objects: [{ track, label: 'person', score, box: [194, 104, 31, 86] }], trails: [{ track, label: 'person', points: [[clock - spanMs, 209, 147], [clock, 210, 147]] }] };
    const response = await postInternalDetections({ prisma, store, token: TOKEN, now: () => clock, dangerThrottle: throttle }, device, new Request(`http://web:3000/api/internal/detections/${device}`, { method: 'POST', body: JSON.stringify(body), headers: { authorization: `Bearer ${TOKEN}` } }));
    expect(response.status).toBe(200);
    return ((await response.json()) as { danger: string }).danger;
}

const cameraDangers = () => prisma.alert.findMany({ where: { kind: 'DANGER', siteId: null }, include: { events: { orderBy: [{ at: 'asc' }, { createdAt: 'asc' }] } }, orderBy: { createdAt: 'asc' } });

describe('camera-level danger', () =>
{
    it('raises exactly one alert for a linked camera with an active unprotected site', async () =>
    {
        await site();
        expect(await seen()).toBe('raised');
        const [alert] = await cameraDangers();
        expect(alert).toMatchObject({ message: MESSAGE, level: 1, kind: 'DANGER', siteId: null, videoId: null, cameraId: cameraA1.id, zoneId: cameraA1.zoneId, lng: cameraA1.lng, lat: cameraA1.lat, status: 'NEW', simulated: false, score: null });
        expect(alert.events.map(event => [event.type, event.author, event.note, event.at.getTime()])).toEqual([['danger', 'Camera', 'Person on camera A1 (track P1), 1 active unprotected site(s) in zone A', T0]]);
    });

    it('raises nothing when the device is not linked to a map camera', async () =>
    {
        await site();
        await prisma.camera.update({ where: { id: cameraA1.id }, data: { liveDeviceId: null } });
        expect(await seen()).toBe('none');
        expect(await cameraDangers()).toEqual([]);
    });

    it('raises nothing without an active unprotected site in the zone', async () =>
    {
        expect(await seen()).toBe('none');
        await site(['protectionInstalled']);
        clock += 5_000;
        expect(await seen()).toBe('none');
        await site(['noNestFound']);
        clock += 5_000;
        expect(await seen()).toBe('none');
        expect(await cameraDangers()).toEqual([]);
    });

    it('raises nothing for a track under 2 s or a score under 0.50', async () =>
    {
        await site();
        expect(await seen({ spanMs: 1_999 })).toBe('none');
        clock += 1_000;
        expect(await seen({ score: 0.49 })).toBe('none');
        expect(await cameraDangers()).toEqual([]);
    });

    it('appends repeat sightings to the open alert at most once a minute', async () =>
    {
        await site();
        expect(await seen()).toBe('raised');
        clock += 30_000;
        expect(await seen({ track: 'P2' })).toBe('none');
        clock += 30_000;
        expect(await seen({ track: 'P2' })).toBe('logged');
        clock += 59_999;
        expect(await seen()).toBe('none');
        const [alert, ...more] = await cameraDangers();
        expect(more).toEqual([]);
        expect(alert.events.map(event => event.note)).toEqual([
            'Person on camera A1 (track P1), 1 active unprotected site(s) in zone A',
            'Person on camera A1 (track P2), 1 active unprotected site(s) in zone A',
        ]);
    });

    it('raises a new alert only after the previous one is resolved and 10 minutes have passed', async () =>
    {
        await site();
        expect(await seen()).toBe('raised');
        const [first] = await cameraDangers();
        clock += 120_000;
        await addSiteEvent(prisma, { alertId: first.id, type: 'dangerResolved', userId: adminId, author: 'Ad', at: new Date(clock) });
        const resolvedAt = clock;
        clock = resolvedAt + 5 * 60_000;
        expect(await seen()).toBe('none');
        clock = resolvedAt + 10 * 60_000 - 1;
        expect(await seen()).toBe('none');
        clock = resolvedAt + 10 * 60_000;
        // The 5 s throttle would hide this 1 ms boundary; it has its own test.
        throttle = new CameraDangerThrottle();
        expect(await seen()).toBe('raised');
        expect((await cameraDangers()).map(alert => alert.status)).toEqual(['REVIEWED', 'NEW']);
    });

    it('never creates two open alerts from concurrent results', async () =>
    {
        await site();
        store.put(deviceId, jpeg(), clock);
        const post = (at: number) =>
        {
            const body = { at, dark: false, width: 320, height: 240, objects: [{ track: 'P1', label: 'person', score: 0.9, box: [1, 2, 3, 4] }], trails: [{ track: 'P1', label: 'person', points: [[at - 3_000, 1, 1], [at, 2, 1]] }] };
            // No throttle here: the camera row lock alone must keep concurrent checks to one alert.
            return postInternalDetections({ prisma, store, token: TOKEN, now: () => clock, dangerThrottle: new CameraDangerThrottle(0) }, deviceId, new Request('http://web:3000/x', { method: 'POST', body: JSON.stringify(body), headers: { authorization: `Bearer ${TOKEN}` } }));
        };
        const results = await Promise.all([post(clock - 2), post(clock - 1), post(clock)]);
        expect(results.every(response => response.status === 200 || response.status === 409)).toBe(true);
        expect(await cameraDangers()).toHaveLength(1);
    });

    it('measures the 2 s span only on validated trails (a future or unordered point is refused)', async () =>
    {
        await site();
        store.put(deviceId, jpeg(), clock);
        const post = (points: number[][]) =>
        {
            const body = { at: clock, dark: false, width: 320, height: 240, objects: [{ track: 'P1', label: 'person', score: 0.9, box: [1, 2, 3, 4] }], trails: [{ track: 'P1', label: 'person', points }] };
            return postInternalDetections({ prisma, store, token: TOKEN, now: () => clock, dangerThrottle: new CameraDangerThrottle(0) }, deviceId, new Request('http://web:3000/x', { method: 'POST', body: JSON.stringify(body), headers: { authorization: `Bearer ${TOKEN}` } }));
        };
        // Seen for 1 s only, padded with a point after the result or out of order.
        expect((await post([[clock - 1_000, 1, 1], [clock, 2, 1], [clock + 5_000, 3, 1]])).status).toBe(400);
        expect((await post([[clock - 1_000, 1, 1], [clock - 5_000, 2, 1], [clock, 3, 1]])).status).toBe(400);
        expect(await cameraDangers()).toEqual([]);
    });

    it('runs the locked check at most once per camera every 5 s', async () =>
    {
        expect(await seen()).toBe('none');
        await site();
        clock += 4_999;
        expect(await seen()).toBe('none');
        expect(await cameraDangers()).toEqual([]);
        clock += 1;
        expect(await seen()).toBe('raised');
    });

    it('leaves outcomes and sites alone, shows in the snapshot, and resolving it touches no site', async () =>
    {
        const siteId = await site();
        const before = await loadMapSnapshot(prisma, new Date(T0));
        expect(await seen()).toBe('raised');
        const after = await loadMapSnapshot(prisma, new Date(T0));
        expect(after.outcomes).toEqual(before.outcomes);
        expect(after.dangerCount).toBe(before.dangerCount + 1);
        const camera = after.alerts.find(alert => alert.kind === 'DANGER' && alert.siteId === null)!;
        expect(camera).toMatchObject({ message: MESSAGE, videoId: null, simRunId: null, cameraCode: 'A1', zoneCode: 'A', level: 1, siteId: null });
        expect(after.alerts.find(alert => alert.id === siteId)?.site).toEqual(before.alerts.find(alert => alert.id === siteId)?.site);
        const siteEvents = await prisma.siteEvent.count({ where: { alertId: siteId } });
        await addSiteEvent(prisma, { alertId: camera.id, type: 'dangerResolved', userId: adminId, author: 'Ad', at: new Date(T0 + 1_000) });
        expect(await prisma.siteEvent.count({ where: { alertId: siteId } })).toBe(siteEvents);
        expect((await prisma.alert.findUniqueOrThrow({ where: { id: camera.id } })).status).toBe('REVIEWED');
    });

    it('refuses a video-less alert that is not a camera-level danger (database CHECK)', async () =>
    {
        await expect(prisma.alert.create({ data: { cameraId: cameraA1.id, zoneId: cameraA1.zoneId, kind: 'DIGGING', message: 'x', startT: 0, endT: 0 } })).rejects.toThrow();
    });
});

describe('watch mask', () =>
{
    // The person box [194, 104, 31, 86] in 320x240 has its feet at (0.65, 0.79).
    const INSIDE = [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 1]];
    const OUTSIDE = [[0, 0], [0.4, 0], [0.4, 0.4], [0, 0.4]];
    const setMask = (mask: number[][] | null) => prisma.camera.update({ where: { code: 'A1' }, data: { maskPolygon: mask === null ? Prisma.DbNull : mask, maskUpdatedAt: new Date() } });

    it('raises for a person whose feet are inside the mask', async () =>
    {
        await setMask(INSIDE);
        await site();
        expect(await seen()).toBe('raised');
    });

    it('never raises for a person outside the mask, however often seen', async () =>
    {
        await setMask(OUTSIDE);
        await site();
        expect(await seen()).toBe('none');
        for (let i = 0; i < 3; i++)
        {
            clock += 70_000;
            expect(await seen()).toBe('none');
        }
        expect(await cameraDangers()).toEqual([]);
    });

    it('never appends an outside sighting to an open alert', async () =>
    {
        await site();
        expect(await seen()).toBe('raised');
        await setMask(OUTSIDE);
        clock += 70_000;
        expect(await seen()).toBe('none');
        clock += 70_000;
        expect(await seen()).toBe('none');
        const [alert] = await cameraDangers();
        expect(alert.events.filter(event => event.type === 'danger')).toHaveLength(1);
    });

    it('counts the whole picture when there is no mask', async () =>
    {
        await site();
        expect(await seen()).toBe('raised');
    });

    it('uses no throttle slot for an outside person', async () =>
    {
        await setMask(OUTSIDE);
        await site();
        expect(await seen()).toBe('none');
        await setMask(null);
        clock += 6_000;
        expect(await seen()).toBe('raised');
    });

    it('reads an invalid stored mask as no mask and says so once', async () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        try
        {
            await setMask([[0, 0], [1, 1]]);
            await site();
            expect(await seen()).toBe('raised');
            clock += 70_000;
            expect(await seen()).toBe('logged');
            expect(warn.mock.calls.filter(call => String(call[0]).includes('A1'))).toHaveLength(1);
        }
        finally
        {
            warn.mockRestore();
        }
    });
});
