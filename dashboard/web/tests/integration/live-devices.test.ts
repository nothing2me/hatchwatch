import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@/lib/db';
import { AssignError, assignSource, listDevices, registerDevice, touchDevice } from '@/lib/live/devices';
import { toMapSnapshot } from '@/server/snapshot';
import { seedDatabase } from '../../prisma/seed';

const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);

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
});
afterAll(async () => { await prisma.$disconnect(); });

describe('live devices', () =>
{
    it('registers, heartbeats only for the owner, and lists online state', async () =>
    {
        const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
        const viewer = await prisma.user.findFirstOrThrow({ where: { role: 'VIEWER' } });
        const device = await registerDevice(prisma, viewer.id, '  Pixel 7  ');
        expect(device.name).toBe('Pixel 7');
        expect((await registerDevice(prisma, viewer.id, '   ')).name).toBe('Unnamed device');
        expect(await touchDevice(prisma, device.id, admin.id)).toBe(false);
        expect(await touchDevice(prisma, device.id, viewer.id)).toBe(true);
        expect(await touchDevice(prisma, 'missing', viewer.id)).toBe(false);
        const later = new Date(Date.now() + 60_000);
        expect((await listDevices(prisma)).find(d => d.id === device.id)?.online).toBe(true);
        expect((await listDevices(prisma, later)).find(d => d.id === device.id)?.online).toBe(false);
    });

    it('assigns a device to one camera at a time and clears it', async () =>
    {
        const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
        const device = await registerDevice(prisma, admin.id, 'Laptop');
        await assignSource(prisma, { cameraCode: 'B1', deviceId: device.id, userId: admin.id });
        expect((await prisma.camera.findUniqueOrThrow({ where: { code: 'B1' } })).liveDeviceId).toBe(device.id);
        expect((await listDevices(prisma)).find(d => d.id === device.id)?.cameraCode).toBe('B1');
        await expect(assignSource(prisma, { cameraCode: 'C1', deviceId: device.id, userId: admin.id }))
            .rejects.toMatchObject({ code: 'DEVICE_IN_USE' });
        await expect(assignSource(prisma, { cameraCode: 'Z9', deviceId: null, userId: admin.id }))
            .rejects.toBeInstanceOf(AssignError);
        await expect(assignSource(prisma, { cameraCode: 'C1', deviceId: 'gone', userId: admin.id }))
            .rejects.toMatchObject({ code: 'NO_DEVICE' });
        await assignSource(prisma, { cameraCode: 'B1', deviceId: null, userId: admin.id });
        expect((await prisma.camera.findUniqueOrThrow({ where: { code: 'B1' } })).liveDeviceId).toBeNull();
        expect(await prisma.auditLog.count({ where: { action: 'camera.source' } })).toBe(2);
        expect((await listDevices(prisma)).find(d => d.id === device.id)?.cameraCode).toBeNull();
    });

    it('frees the camera when its device is deleted, and the snapshot carries the assignment', async () =>
    {
        const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
        const device = await registerDevice(prisma, admin.id, 'Pixel');
        await assignSource(prisma, { cameraCode: 'A1', deviceId: device.id, userId: admin.id });
        const zones = await prisma.zone.findMany();
        const cameras = await prisma.camera.findMany({ include: { zone: { select: { code: true } } } });
        const snapshot = toMapSnapshot({ zones, cameras: cameras.map(camera => ({ ...camera, videos: [] })), alerts: [] });
        expect(snapshot.cameras.find(camera => camera.code === 'A1')?.liveDeviceId).toBe(device.id);
        expect(snapshot.cameras.find(camera => camera.code === 'A2')?.liveDeviceId).toBeNull();
        await prisma.liveDevice.delete({ where: { id: device.id } });
        expect((await prisma.camera.findUniqueOrThrow({ where: { code: 'A1' } })).liveDeviceId).toBeNull();
    });
});
