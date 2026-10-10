import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@/lib/db';
import { onChange } from '@/lib/changes';
import { CameraEditError, listCameras, setCameraSource } from '@/lib/cameras/manage';
import { registerDevice, removeDevice } from '@/lib/phones/devices';
import { setDisabled } from '@/lib/users/manage';
import { seedDatabase } from '../../prisma/seed';

const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
let adminId: string;
let volunteerId: string;

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
    volunteerId = (await prisma.user.create({ data: { email: 'vol@test.local', name: 'Vol', role: 'VOLUNTEER', passwordHash: 'unused' } })).id;
});
afterAll(async () => { await prisma.$disconnect(); });

const linked = async (code: string) => (await prisma.camera.findUniqueOrThrow({ where: { code } })).liveDeviceId;
const refusal = async (promise: Promise<unknown>) =>
{
    const error = await promise.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(CameraEditError);
    return (error as Error).message;
};

describe('camera source', () =>
{
    it('links a phone to a camera and back to the simulation loop, audited and published', async () =>
    {
        const { id } = await registerDevice(prisma, volunteerId, 'Dune phone');
        const reasons: string[] = [];
        const off = onChange(reason => reasons.push(reason));
        await setCameraSource(prisma, adminId, 'B1', id);
        expect(await linked('B1')).toBe(id);
        expect((await listCameras(prisma)).cameras.find(c => c.code === 'B1')).toMatchObject({ liveDeviceId: id, liveDeviceName: 'Dune phone' });
        await setCameraSource(prisma, adminId, 'B1', null);
        off();
        expect(await linked('B1')).toBeNull();
        const audits = await prisma.auditLog.findMany({ where: { action: 'camera.source' }, orderBy: { createdAt: 'asc' } });
        expect(audits.map(a => a.details)).toEqual([
            { code: 'B1', from: null, to: id, deviceName: 'Dune phone' },
            { code: 'B1', from: id, to: null, deviceName: null },
        ]);
        expect(reasons).toEqual(['cameras', 'cameras']);
    });

    it('refuses a phone that already feeds another camera, a removed phone and an unknown camera', async () =>
    {
        const { id } = await registerDevice(prisma, volunteerId, 'Dune phone');
        await setCameraSource(prisma, adminId, 'B1', id);
        expect(await refusal(setCameraSource(prisma, adminId, 'C1', id))).toBe('Dune phone already feeds camera B1; set B1 back to Simulation loop first.');
        expect(await refusal(setCameraSource(prisma, adminId, 'Z9', null))).toBe('Camera Z9 no longer exists.');
        const { id: gone } = await registerDevice(prisma, volunteerId, 'Old phone');
        await removeDevice(prisma, adminId, gone);
        expect(await refusal(setCameraSource(prisma, adminId, 'C1', gone))).toBe('That phone was removed.');
        await expect(prisma.camera.update({ where: { code: 'C1' }, data: { liveDeviceId: id } })).rejects.toThrow();
    });

    it('unlinks every phone of a user who is disabled', async () =>
    {
        const { id } = await registerDevice(prisma, volunteerId, 'Dune phone');
        await setCameraSource(prisma, adminId, 'B1', id);
        await setDisabled(prisma, adminId, volunteerId, true);
        expect(await linked('B1')).toBeNull();
        expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.disable' } })).details).toEqual({ unlinkedCameras: ['B1'] });
    });

    it('removing a phone unlinks it and frees its name', async () =>
    {
        const { id } = await registerDevice(prisma, volunteerId, 'Dune phone');
        await setCameraSource(prisma, adminId, 'B1', id);
        expect(await removeDevice(prisma, adminId, id)).toEqual({ unlinked: 'B1' });
        expect(await linked('B1')).toBeNull();
        expect((await prisma.liveDevice.findUniqueOrThrow({ where: { id } })).disabledAt).not.toBeNull();
        expect(await prisma.auditLog.count({ where: { action: 'device.remove', targetId: id } })).toBe(1);
        expect((await registerDevice(prisma, volunteerId, 'Dune phone')).id).not.toBe(id);
    });
});
