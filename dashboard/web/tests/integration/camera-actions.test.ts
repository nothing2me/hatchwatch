import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { createPrismaClient } from '@/lib/db';
import { onChange } from '@/lib/changes';
import { bearingBetween, destinationPoint } from '@/lib/geo';
import { addCameraPair, addCameraPairToZone, CameraEditError, deleteCamera, faceOcean, listCameras, mergeZoneInto, updateCamera } from '@/lib/cameras/manage';
import { zoneOrientation } from '@/lib/cameras/placePair';
import type { LngLat } from '@/lib/types';
import { seedDatabase } from '../../prisma/seed';
import { SEED_ZONES } from '../../prisma/seed-data';

const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
let adminId: string;

const dRing = SEED_ZONES[3].outline.coordinates[0] as LngLat[];
const dAlong = bearingBetween(dRing[1], dRing[0]);
const northOfD: LngLat = destinationPoint(dRing[0], dAlong, 150);
const angleGap = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

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
    adminId = (await prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.local' } })).id;
});
afterAll(async () => { await prisma.$disconnect(); });

const rejects = async (promise: Promise<unknown>, message: string | RegExp) =>
{
    const error = await promise.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(CameraEditError);
    if (typeof message === 'string')
    {
        expect((error as Error).message).toBe(message);
    }
    else
    {
        expect((error as Error).message).toMatch(message);
    }
};

const changes = () =>
{
    const reasons: string[] = [];
    const off = onChange(reason => reasons.push(reason));
    return { reasons, off };
};

// A legacy map-made zone just north-east of D, with one camera pair and some history.
async function makeZoneE()
{
    const ring: LngLat[] = [northOfD, destinationPoint(northOfD, dAlong + 180, 120), destinationPoint(destinationPoint(northOfD, dAlong + 180, 120), dAlong + 90, 60), destinationPoint(northOfD, dAlong + 90, 60), northOfD];
    const zone = await prisma.zone.create({ data: { code: 'E', name: 'Zone E', activityLevel: 'LOW', createdById: adminId, outline: { type: 'Polygon', coordinates: [ring] } } });
    const e1 = await prisma.camera.create({ data: { code: 'E1', zoneId: zone.id, lng: ring[0][0], lat: ring[0][1], headingDeg: 149, fovDeg: 60, rangeM: 90 } });
    const e2 = await prisma.camera.create({ data: { code: 'E2', zoneId: zone.id, lng: ring[1][0], lat: ring[1][1], headingDeg: 109, fovDeg: 60, rangeM: 90 } });
    await prisma.liveChunk.create({ data: { id: 'chunk-e', sequence: 4, zoneId: zone.id, startedAt: new Date() } });
    const video = await prisma.video.create({ data: { cameraId: e1.id, path: 'e.mp4', originalName: 'e.mp4', liveChunkId: 'chunk-e' } });
    const alert = await prisma.alert.create({ data: { videoId: video.id, cameraId: e2.id, zoneId: zone.id, kind: 'DIGGING', message: 'Digging activity detected; nesting unresolved.', startT: 0, endT: 1 } });
    return { zone, e1, e2, alert };
}

describe('adding a camera pair', () =>
{
    it('adds D3 and D4 to the nearest zone, facing the sea, without creating a zone', async () =>
    {
        const { reasons, off } = changes();
        const result = await addCameraPair(prisma, adminId, northOfD);
        off();
        expect(result).toEqual({ codes: ['D3', 'D4'], zoneCode: 'D' });
        expect(await prisma.zone.count()).toBe(4);
        const zoneD = await prisma.zone.findUniqueOrThrow({ where: { code: 'D' } });
        const added = await prisma.camera.findMany({ where: { code: { in: ['D3', 'D4'] } }, orderBy: { code: 'asc' } });
        expect(added.map(camera => [camera.code, camera.zoneId, camera.fovDeg, camera.rangeM, camera.status])).toEqual([
            ['D3', zoneD.id, 60, 90, 'ONLINE'],
            ['D4', zoneD.id, 60, 90, 'ONLINE'],
        ]);
        const { seaward } = zoneOrientation({ id: zoneD.id, code: 'D', name: '', activityLevel: 'LOW', ring: dRing });
        for (const camera of added)
        {
            expect(angleGap(camera.headingDeg, seaward)).toBeCloseTo(20, 5);
        }
        expect(await prisma.auditLog.count({ where: { action: 'camera.pair.add', targetId: zoneD.id, userId: adminId } })).toBe(1);
        expect(reasons).toContain('cameras');
        expect((await addCameraPair(prisma, adminId, northOfD)).codes).toEqual(['D5', 'D6']);
    });

    it('refuses a click far from the beach without writing anything', async () =>
    {
        await rejects(addCameraPair(prisma, adminId, destinationPoint(northOfD, 300, 5000)), 'Click closer to the beach');
        expect(await prisma.camera.count()).toBe(8);
    });

    it('adds a pair to a chosen zone, or refuses an unknown zone or a far point', async () =>
    {
        expect(await addCameraPairToZone(prisma, adminId, 'B', northOfD)).toEqual({ codes: ['B3', 'B4'], zoneCode: 'B' });
        await rejects(addCameraPairToZone(prisma, adminId, 'Q', northOfD), 'That zone no longer exists.');
        await rejects(addCameraPairToZone(prisma, adminId, 'B', destinationPoint(northOfD, 300, 5000)), /more than 2 km from Zone B/);
        expect(await prisma.camera.count()).toBe(10);
    });
});

describe('updateCamera', () =>
{
    it('saves a good patch with an audit row and a change', async () =>
    {
        await addCameraPair(prisma, adminId, northOfD);
        const { reasons, off } = changes();
        const result = await updateCamera(prisma, adminId, 'D3', { code: 'D7', lng: -97.05, lat: 27.83, headingDeg: 120, fovDeg: 50, rangeM: 120, status: 'OFFLINE' });
        off();
        expect(result).toEqual({ code: 'D7' });
        const saved = await prisma.camera.findUniqueOrThrow({ where: { code: 'D7' } });
        expect(saved).toMatchObject({ lng: -97.05, lat: 27.83, headingDeg: 120, fovDeg: 50, rangeM: 120, status: 'OFFLINE' });
        const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'camera.update', targetId: saved.id } });
        expect(audit.userId).toBe(adminId);
        expect(audit.details).toMatchObject({ code: 'D3', after: { code: 'D7', lat: 27.83 } });
        expect(reasons).toContain('cameras');
    });

    it('refuses bad values and leaves the camera unchanged', async () =>
    {
        await addCameraPair(prisma, adminId, northOfD);
        await rejects(updateCamera(prisma, adminId, 'D3', { lat: 91 }), 'Latitude must be between -90 and 90.');
        await rejects(updateCamera(prisma, adminId, 'D3', { lng: -181 }), 'Longitude must be between -180 and 180.');
        await rejects(updateCamera(prisma, adminId, 'D3', { headingDeg: 361 }), 'Heading must be between 0 and 360.');
        await rejects(updateCamera(prisma, adminId, 'D3', { fovDeg: 5 }), 'Field of view must be between 10 and 120.');
        await rejects(updateCamera(prisma, adminId, 'D3', { rangeM: 900 }), 'Range must be between 10 and 500.');
        await rejects(updateCamera(prisma, adminId, 'D3', { lat: Number.NaN }), 'Latitude must be between -90 and 90.');
        await rejects(updateCamera(prisma, adminId, 'D3', { code: 'd-3' }), 'Camera codes are a zone letter and a number from 1 to 99, like B3.');
        await rejects(updateCamera(prisma, adminId, 'D3', { code: 'D05' }), 'Camera codes are a zone letter and a number from 1 to 99, like B3.');
        await rejects(updateCamera(prisma, adminId, 'D3', { code: 'D0' }), 'Camera codes are a zone letter and a number from 1 to 99, like B3.');
        await rejects(updateCamera(prisma, adminId, 'D3', { lat: 27.9 }), 'That spot is more than 2 km from Zone D.');
        await rejects(updateCamera(prisma, adminId, 'D3', { lng: -97.2, lat: 27.83 }), 'That spot is more than 2 km from Zone D.');
        await rejects(updateCamera(prisma, adminId, 'D3', { code: 'D4' }), 'Camera code D4 is already taken.');
        await rejects(updateCamera(prisma, adminId, 'D3', { code: 'B9' }), 'Codes in Zone D start with D.');
        await rejects(updateCamera(prisma, adminId, 'D1', { code: 'D9' }), 'Live footage for Zone D arrives on D1; keep its code.');
        await rejects(updateCamera(prisma, adminId, 'Q1', { lat: 27 }), 'Camera Q1 no longer exists.');
        expect(await prisma.auditLog.count({ where: { action: 'camera.update' } })).toBe(0);
        // Live-slot cameras still move freely.
        await updateCamera(prisma, adminId, 'D1', { lat: 27.8239, lng: -97.0575 });
        expect(await prisma.camera.findUniqueOrThrow({ where: { code: 'D1' } })).toMatchObject({ lat: 27.8239, lng: -97.0575 });
    });
});

describe('deleteCamera', () =>
{
    it('removes an unused camera, audited', async () =>
    {
        await addCameraPair(prisma, adminId, northOfD);
        await deleteCamera(prisma, adminId, 'D4');
        expect(await prisma.camera.findUnique({ where: { code: 'D4' } })).toBeNull();
        expect(await prisma.auditLog.count({ where: { action: 'camera.delete', userId: adminId } })).toBe(1);
    });

    it('refuses a camera with footage or alerts, or a live-feed camera', async () =>
    {
        await addCameraPair(prisma, adminId, northOfD);
        const [d3, d4] = await prisma.camera.findMany({ where: { code: { in: ['D3', 'D4'] } }, orderBy: { code: 'asc' } });
        const zone = await prisma.zone.findUniqueOrThrow({ where: { code: 'D' } });
        const video = await prisma.video.create({ data: { cameraId: d3.id, path: 'x.mp4', originalName: 'x.mp4' } });
        await rejects(deleteCamera(prisma, adminId, 'D3'), 'Camera D3 has footage or alerts; it cannot be removed.');
        await prisma.alert.create({ data: { videoId: video.id, cameraId: d4.id, zoneId: zone.id, kind: 'DIGGING', message: 'Digging activity detected; nesting unresolved.', startT: 0, endT: 1 } });
        await rejects(deleteCamera(prisma, adminId, 'D4'), 'Camera D4 has footage or alerts; it cannot be removed.');
        await rejects(deleteCamera(prisma, adminId, 'C2'), 'Live footage for Zone C arrives on C2; it cannot be removed.');
        expect(await prisma.camera.count()).toBe(10);
    });
});

describe('faceOcean', () =>
{
    it('turns a pair to face the sea, toed in toward each other, keeping positions', async () =>
    {
        const before = await prisma.camera.findMany({ where: { code: { in: ['B1', 'B2'] } }, orderBy: { code: 'asc' } });
        expect(before.map(camera => camera.headingDeg)).toEqual([203, 56]);
        const { reasons, off } = changes();
        expect(await faceOcean(prisma, adminId, 'B2')).toEqual({ codes: ['B1', 'B2'] });
        off();
        const after = await prisma.camera.findMany({ where: { code: { in: ['B1', 'B2'] } }, orderBy: { code: 'asc' } });
        const zoneB = await prisma.zone.findUniqueOrThrow({ where: { code: 'B' } });
        const { seaward } = zoneOrientation({ id: zoneB.id, code: 'B', name: '', activityLevel: 'LOW', ring: (zoneB.outline as { coordinates: LngLat[][] }).coordinates[0] });
        for (const [i, camera] of after.entries())
        {
            expect(angleGap(camera.headingDeg, seaward)).toBeCloseTo(20, 5);
            expect([camera.lng, camera.lat]).toEqual([before[i].lng, before[i].lat]);
        }
        // B1 is the north end, so it turns south toward B2 (seaward + 20 on this beach), B2 the other way.
        expect(after[0].headingDeg).toBeCloseTo((seaward + 20) % 360, 5);
        expect(after[1].headingDeg).toBeCloseTo((seaward + 340) % 360, 5);
        expect(await prisma.auditLog.count({ where: { action: 'camera.face-ocean', userId: adminId } })).toBe(1);
        expect(reasons).toContain('cameras');
        await rejects(faceOcean(prisma, adminId, 'Q1'), 'Camera Q1 no longer exists.');
    });
});

describe('mergeZoneInto', () =>
{
    it('moves E\'s cameras to the nearest zone with new codes, reassigns its chunks and alerts, and deletes E', async () =>
    {
        const { zone, e1, e2, alert } = await makeZoneE();
        const { reasons, off } = changes();
        const result = await mergeZoneInto(prisma, adminId, 'E');
        off();
        expect(result).toEqual({ targetCode: 'D', moved: [{ from: 'E1', to: 'D3' }, { from: 'E2', to: 'D4' }] });
        const zoneD = await prisma.zone.findUniqueOrThrow({ where: { code: 'D' } });
        expect(await prisma.zone.findUnique({ where: { code: 'E' } })).toBeNull();
        expect(await prisma.camera.findUniqueOrThrow({ where: { id: e1.id } })).toMatchObject({ code: 'D3', zoneId: zoneD.id, headingDeg: 149 });
        expect(await prisma.camera.findUniqueOrThrow({ where: { id: e2.id } })).toMatchObject({ code: 'D4', zoneId: zoneD.id });
        expect((await prisma.liveChunk.findUniqueOrThrow({ where: { id: 'chunk-e' } })).zoneId).toBe(zoneD.id);
        expect((await prisma.alert.findUniqueOrThrow({ where: { id: alert.id } })).zoneId).toBe(zoneD.id);
        const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'zone.merge' } });
        expect(audit).toMatchObject({ userId: adminId, targetId: zoneD.id, details: { source: 'E', sourceId: zone.id, target: 'D', liveChunks: 1, alerts: 1 } });
        expect(reasons).toContain('cameras');
        const listed = await listCameras(prisma);
        expect(listed.zones.map(z => z.code)).toEqual(['A', 'B', 'C', 'D']);
        expect(listed.cameras.filter(camera => camera.zoneCode === 'D').map(camera => [camera.code, camera.footage, camera.alerts])).toEqual([['D1', 0, 0], ['D2', 0, 0], ['D3', 1, 0], ['D4', 0, 1]]);
        await rejects(mergeZoneInto(prisma, adminId, 'E'), 'That zone no longer exists.');
    });

    it('refuses to merge a built-in zone and changes nothing', async () =>
    {
        await makeZoneE();
        await rejects(mergeZoneInto(prisma, adminId, 'D'), 'Zone D is a built-in zone; only zones added on the map can be merged.');
        expect((await prisma.zone.findMany({ orderBy: { code: 'asc' } })).map(zone => zone.code)).toEqual(['A', 'B', 'C', 'D', 'E']);
        expect((await prisma.camera.findMany({ where: { zone: { code: 'D' } }, orderBy: { code: 'asc' } })).map(camera => camera.code)).toEqual(['D1', 'D2']);
        expect(await prisma.auditLog.count({ where: { action: 'zone.merge' } })).toBe(0);
    });

    it('refuses a merge with no other zone within 2 km', async () =>
    {
        const far: LngLat = destinationPoint(northOfD, 300, 6000);
        const ring: LngLat[] = [far, destinationPoint(far, 219, 100), destinationPoint(destinationPoint(far, 219, 100), 129, 50), destinationPoint(far, 129, 50), far];
        await prisma.zone.create({ data: { code: 'F', name: 'Zone F', activityLevel: 'LOW', createdById: adminId, outline: { type: 'Polygon', coordinates: [ring] } } });
        await rejects(mergeZoneInto(prisma, adminId, 'F'), 'No other zone lies within 2 km of Zone F; nothing was merged.');
        expect(await prisma.zone.count({ where: { code: 'F' } })).toBe(1);
    });

    it('rolls everything back when a step fails', async () =>
    {
        const { zone, e1 } = await makeZoneE();
        // Fail the final zone delete inside the transaction.
        const failing = new Proxy(prisma, {
            get(target, key, receiver)
            {
                if (key !== '$transaction')
                {
                    return Reflect.get(target, key, receiver);
                }
                return (work: (tx: unknown) => Promise<unknown>) => target.$transaction(tx => work(new Proxy(tx, {
                    get(inner, name, r)
                    {
                        if (name === 'zone')
                        {
                            return { ...inner.zone, findMany: inner.zone.findMany.bind(inner.zone), delete: async () => { throw new Error('boom'); } };
                        }
                        return Reflect.get(inner, name, r);
                    },
                })));
            },
        }) as PrismaClient;
        await expect(mergeZoneInto(failing, adminId, 'E')).rejects.toThrow('boom');
        expect(await prisma.zone.findUniqueOrThrow({ where: { code: 'E' } })).toMatchObject({ id: zone.id });
        expect(await prisma.camera.findUniqueOrThrow({ where: { id: e1.id } })).toMatchObject({ code: 'E1', zoneId: zone.id });
        expect((await prisma.liveChunk.findUniqueOrThrow({ where: { id: 'chunk-e' } })).zoneId).toBe(zone.id);
        expect(await prisma.alert.count({ where: { zoneId: zone.id } })).toBe(1);
        expect(await prisma.auditLog.count({ where: { action: 'zone.merge' } })).toBe(0);
    });
});
