import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';

// The real addBoardCamera and rotateDeviceToken actions against the test database, with the session and Next.js stubbed.
let role = 'ADMIN';
let sessionId = '';
vi.mock('@/lib/db', async importOriginal =>
{
    const real = await importOriginal<typeof import('@/lib/db')>();
    return { ...real, prisma: real.createPrismaClient(process.env.TEST_DATABASE_URL) };
});
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'token' }) }) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('REDIRECT'); }), forbidden: vi.fn(() => { throw new Error('FORBIDDEN'); }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ SESSION_COOKIE: 's', readSessionToken: vi.fn(async () => ({ id: sessionId, email: 'x@test.local', name: 'X', role })) }));

const { prisma } = await import('@/lib/db') as { prisma: PrismaClient };
const { addBoardCamera, rotateDeviceToken, removePhone } = await import('@/app/(app)/cameras/actions');
const { registerDevice } = await import('@/lib/phones/devices');
const { hashDeviceToken } = await import('@/lib/phones/deviceToken');
const { FrameStore, frameStore } = await import('@/lib/phones/frameStore');
const { setCameraSource } = await import('@/lib/cameras/manage');
const { setDisabled } = await import('@/lib/users/manage');
const { postFrame } = await import('@/lib/phones/http');
const { seedDatabase } = await import('../../prisma/seed');

let adminId: string;
let volunteerId: string;
let viewerId: string;

beforeAll(async () =>
{
    const [{ current_database: name }] = await prisma.$queryRawUnsafe<{ current_database: string }[]>('SELECT current_database()');
    if (!name.endsWith('_test'))
    {
        throw new Error(`Refusing to run against ${name}`);
    }
    process.env.AUTH_SECRET = 'q8Zr1vK0wX9mT4bN7cH2jL6pD3sF5gA1';
});
beforeEach(async () =>
{
    await prisma.$executeRawUnsafe('TRUNCATE "LiveDevice","SiteEvent","LiveChunk","AuditLog","AlertStatusChange","AlertNote","Alert","Track","Job","Video","Camera","Zone","User" CASCADE');
    await seedDatabase(prisma, { adminEmail: 'admin@test.local', adminPassword: 'pw-for-tests' });
    adminId = (await prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.local' } })).id;
    volunteerId = (await prisma.user.create({ data: { email: 'vol@test.local', name: 'Vol', role: 'VOLUNTEER', passwordHash: 'unused' } })).id;
    viewerId = (await prisma.user.create({ data: { email: 'view@test.local', name: 'View', role: 'VIEWER', passwordHash: 'unused' } })).id;
    role = 'ADMIN';
    sessionId = adminId;
    process.env.LAN_HOST = '10.47.138.152';
});
afterAll(async () => { await prisma.$disconnect(); });

const jpeg = () => { const body = Buffer.alloc(64, 7); body[0] = 0xff; body[1] = 0xd8; return body; };
const send = (id: string, token: string) => postFrame({ prisma, user: null, store: new FrameStore() }, id, new Request('https://x', { method: 'POST', body: jpeg(), headers: { authorization: `Bearer ${token}`, 'content-type': 'image/jpeg' } }));

describe('addBoardCamera', () =>
{
    it('refuses volunteers and viewers before creating anything', async () =>
    {
        for (const [denied, userId] of [['VOLUNTEER', volunteerId], ['VIEWER', viewerId]])
        {
            role = denied;
            sessionId = userId;
            await expect(addBoardCamera('Dune board')).rejects.toThrow('FORBIDDEN');
        }
        expect(await prisma.liveDevice.count()).toBe(0);
        expect(await prisma.auditLog.count({ where: { action: 'device.create' } })).toBe(0);
    });

    it('creates a BOARD owned by the admin, stores only the hash, and audits without the token', async () =>
    {
        const result = await addBoardCamera('  Dune   board ');
        if (!result.ok) throw new Error(result.error);
        expect(result.name).toBe('Dune board');
        expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(result.dashboardUrl).toBe('https://10.47.138.152:3443');
        expect(result.secrets).toContain(`#define DEVICE_TOKEN "${result.token}"`);
        expect(result.secrets).toContain(`#define DEVICE_ID "${result.deviceId}"`);
        const row = await prisma.liveDevice.findUniqueOrThrow({ where: { id: result.deviceId } });
        expect(row).toMatchObject({ kind: 'BOARD', ownerId: adminId, name: 'Dune board', tokenHash: hashDeviceToken(result.token) });
        const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'device.create' } });
        expect(audit).toMatchObject({ userId: adminId, targetType: 'LiveDevice', targetId: result.deviceId, details: { name: 'Dune board', kind: 'BOARD' } });
        const everything = JSON.stringify(await prisma.auditLog.findMany());
        expect(everything).not.toContain(result.token);
        expect(everything).not.toContain(row.tokenHash!);
        expect((await send(result.deviceId, result.token)).status).toBe(200);
    });

    it('refuses an empty or too long name', async () =>
    {
        expect(await addBoardCamera('   ')).toEqual({ ok: false, error: 'Give the board a name of 1 to 60 characters.' });
        expect(await addBoardCamera('x'.repeat(61))).toEqual({ ok: false, error: 'Give the board a name of 1 to 60 characters.' });
        expect(await prisma.liveDevice.count()).toBe(0);
    });
});

describe('rotateDeviceToken', () =>
{
    it('replaces the token: the old one gets 401, the new one works, and it is audited without either', async () =>
    {
        const added = await addBoardCamera('Dune board');
        if (!added.ok) throw new Error(added.error);
        const rotated = await rotateDeviceToken(added.deviceId);
        if (!rotated.ok) throw new Error(rotated.error);
        expect(rotated.token).not.toBe(added.token);
        expect((await send(added.deviceId, added.token)).status).toBe(401);
        expect((await send(added.deviceId, rotated.token)).status).toBe(200);
        const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'device.rotate' } });
        expect(audit).toMatchObject({ userId: adminId, targetId: added.deviceId, details: { name: 'Dune board' } });
        const everything = JSON.stringify(await prisma.auditLog.findMany());
        for (const secret of [added.token, rotated.token, hashDeviceToken(added.token), hashDeviceToken(rotated.token)])
        {
            expect(everything).not.toContain(secret);
        }
    });

    it('forgets the board\'s last frame so an old-token frame does not linger', async () =>
    {
        const added = await addBoardCamera('Dune board');
        if (!added.ok) throw new Error(added.error);
        const forget = vi.spyOn(frameStore, 'forget');
        const rotated = await rotateDeviceToken(added.deviceId);
        expect(rotated.ok).toBe(true);
        expect(forget).toHaveBeenCalledWith(added.deviceId);
        forget.mockClear();
        await rotateDeviceToken('no-such-device');
        expect(forget).not.toHaveBeenCalled();
        forget.mockRestore();
    });

    it('is admin only and refuses phones, removed boards and unknown ids', async () =>
    {
        const added = await addBoardCamera('Dune board');
        if (!added.ok) throw new Error(added.error);
        const phone = await registerDevice(prisma, volunteerId, 'Pixel');
        expect(await rotateDeviceToken(phone.id)).toEqual({ ok: false, error: 'Only camera boards have a token.' });
        expect(await rotateDeviceToken('no-such-device')).toEqual({ ok: false, error: 'That board was removed.' });
        expect(await removePhone(added.deviceId)).toEqual({ ok: true });
        expect(await rotateDeviceToken(added.deviceId)).toEqual({ ok: false, error: 'That board was removed.' });
        role = 'VOLUNTEER';
        sessionId = volunteerId;
        await expect(rotateDeviceToken(added.deviceId)).rejects.toThrow('FORBIDDEN');
        expect(await prisma.auditLog.count({ where: { action: 'device.rotate' } })).toBe(0);
    });
});

describe('disabling the admin who added a board', () =>
{
    it('keeps the board linked and sending, but still unlinks that user\'s phones', async () =>
    {
        const added = await addBoardCamera('Dune board');
        if (!added.ok) throw new Error(added.error);
        const phone = await registerDevice(prisma, adminId, 'Admin phone');
        await setCameraSource(prisma, adminId, 'B1', added.deviceId);
        await setCameraSource(prisma, adminId, 'C1', phone.id);
        const otherAdmin = await prisma.user.create({ data: { email: 'admin2@test.local', name: 'Admin Two', role: 'ADMIN', passwordHash: 'unused' } });
        await setDisabled(prisma, otherAdmin.id, adminId, true);
        const linked = async (code: string) => (await prisma.camera.findUniqueOrThrow({ where: { code } })).liveDeviceId;
        expect(await linked('B1')).toBe(added.deviceId);
        expect(await linked('C1')).toBeNull();
        expect((await send(added.deviceId, added.token)).status).toBe(200);
        expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.disable' } })).details).toEqual({ unlinkedCameras: ['C1'] });
    });
});
