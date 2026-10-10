import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@/lib/db';
import { onChange } from '@/lib/changes';
import { bearingBetween, destinationPoint } from '@/lib/geo';
import { addCameraPair, CameraEditError, deleteZone } from '@/lib/cameras/manage';
import type { LngLat } from '@/lib/types';
import { seedDatabase } from '../../prisma/seed';
import { SEED_ZONES } from '../../prisma/seed-data';

const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
let adminId: string;

const dRing = SEED_ZONES[3].outline.coordinates[0];
const northOfD: LngLat = destinationPoint(dRing[0], bearingBetween(dRing[1], dRing[0]), 150);

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

const rejects = async (promise: Promise<unknown>, message: string) =>
{
    const error = await promise.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(CameraEditError);
    expect((error as Error).message).toBe(message);
};

describe('camera pair editing', () =>
{
    it('adds zone E with two online cameras, an audit row and a change', async () =>
    {
        const reasons: string[] = [];
        const off = onChange(reason => reasons.push(reason));
        const { code } = await addCameraPair(prisma, adminId, northOfD);
        off();
        expect(code).toBe('E');
        const zone = await prisma.zone.findUniqueOrThrow({ where: { code: 'E' }, include: { cameras: { orderBy: { code: 'asc' } } } });
        expect(zone).toMatchObject({ activityLevel: 'LOW', createdById: adminId });
        expect((zone.outline as { coordinates: LngLat[][] }).coordinates[0]).toHaveLength(5);
        expect(zone.cameras.map(camera => [camera.code, camera.fovDeg, camera.rangeM, camera.status])).toEqual([
            ['E1', 60, 90, 'ONLINE'],
            ['E2', 60, 90, 'ONLINE'],
        ]);
        expect(await prisma.auditLog.count({ where: { action: 'zone.create', targetId: zone.id, userId: adminId } })).toBe(1);
        expect(reasons).toContain('cameras');
        expect((await addCameraPair(prisma, adminId, destinationPoint(northOfD, 39, 200))).code).toBe('F');
    });

    it('refuses a click far from the beach without writing anything', async () =>
    {
        await rejects(addCameraPair(prisma, adminId, destinationPoint(northOfD, 300, 5000)), 'Click closer to the beach');
        expect(await prisma.zone.count()).toBe(4);
    });

    it('deletes an admin-created zone and its cameras, audited', async () =>
    {
        await addCameraPair(prisma, adminId, northOfD);
        const reasons: string[] = [];
        const off = onChange(reason => reasons.push(reason));
        await deleteZone(prisma, adminId, 'E');
        off();
        expect(await prisma.zone.findUnique({ where: { code: 'E' } })).toBeNull();
        expect(await prisma.camera.count({ where: { code: { in: ['E1', 'E2'] } } })).toBe(0);
        expect(await prisma.auditLog.count({ where: { action: 'zone.delete', userId: adminId } })).toBe(1);
        expect(reasons).toContain('cameras');
        // The letter is free again.
        expect((await addCameraPair(prisma, adminId, northOfD)).code).toBe('E');
    });

    it('never deletes a seeded zone or an unknown one', async () =>
    {
        await rejects(deleteZone(prisma, adminId, 'A'), 'Only zones added on the map can be removed.');
        await rejects(deleteZone(prisma, adminId, 'Q'), 'That zone no longer exists.');
        expect(await prisma.zone.count()).toBe(4);
    });

    it('refuses a zone with footage, alerts or live chunks', async () =>
    {
        const blocked = 'This zone has footage or alerts; it cannot be removed.';
        await addCameraPair(prisma, adminId, northOfD);
        const zone = await prisma.zone.findUniqueOrThrow({ where: { code: 'E' }, include: { cameras: true } });

        await prisma.liveChunk.create({ data: { id: 'chunk-1', sequence: 1, zoneId: zone.id, startedAt: new Date() } });
        await rejects(deleteZone(prisma, adminId, 'E'), blocked);
        await prisma.liveChunk.deleteMany();

        const video = await prisma.video.create({ data: { cameraId: zone.cameras[0].id, path: 'x.mp4', originalName: 'x.mp4' } });
        await rejects(deleteZone(prisma, adminId, 'E'), blocked);

        await prisma.alert.create({ data: { videoId: video.id, cameraId: zone.cameras[1].id, zoneId: zone.id, kind: 'DIGGING', message: 'Digging activity detected; nesting unresolved.', startT: 0, endT: 1 } });
        await prisma.video.update({ where: { id: video.id }, data: { cameraId: zone.cameras[1].id } });
        await rejects(deleteZone(prisma, adminId, 'E'), blocked);
        expect(await prisma.zone.count({ where: { code: 'E' } })).toBe(1);
    });
});
