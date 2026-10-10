import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';

// The real removePhone action against the test database, with the session and Next.js stubbed.
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
const { removePhone } = await import('@/app/(app)/cameras/actions');
const { setCameraSource } = await import('@/lib/cameras/manage');
const { registerDevice } = await import('@/lib/phones/devices');
const { frameStore } = await import('@/lib/phones/frameStore');
const { getFrame } = await import('@/lib/phones/http');
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
});
afterAll(async () => { await prisma.$disconnect(); });

const jpeg = () => { const body = Buffer.alloc(64, 7); body[0] = 0xff; body[1] = 0xd8; return body; };
const frameStatus = (id: string) => getFrame({ user: { id: adminId, email: 'a', name: 'A', role: 'ADMIN' }, store: frameStore }, id, new Request('https://x/api/live/frame/' + id)).status;

describe('removePhone', () =>
{
    it('refuses volunteers and viewers before touching anything', async () =>
    {
        const { id } = await registerDevice(prisma, volunteerId, 'Dune phone');
        for (const [denied, userId] of [['VOLUNTEER', volunteerId], ['VIEWER', viewerId]])
        {
            role = denied;
            sessionId = userId;
            await expect(removePhone(id)).rejects.toThrow('FORBIDDEN');
        }
        expect((await prisma.liveDevice.findUniqueOrThrow({ where: { id } })).disabledAt).toBeNull();
        expect(await prisma.auditLog.count({ where: { action: 'device.remove' } })).toBe(0);
    });

    it('removes the phone, unlinks its camera, audits, and drops its frame at once', async () =>
    {
        role = 'ADMIN';
        sessionId = adminId;
        const { id } = await registerDevice(prisma, volunteerId, 'Dune phone');
        await setCameraSource(prisma, adminId, 'B1', id);
        frameStore.put(id, jpeg());
        expect(frameStatus(id)).toBe(200);
        expect(await removePhone(id)).toEqual({ ok: true });
        expect((await prisma.liveDevice.findUniqueOrThrow({ where: { id } })).disabledAt).not.toBeNull();
        expect((await prisma.camera.findUniqueOrThrow({ where: { code: 'B1' } })).liveDeviceId).toBeNull();
        expect(await prisma.auditLog.findFirstOrThrow({ where: { action: 'device.remove', targetId: id } })).toMatchObject({ userId: adminId, details: { name: 'Dune phone', unlinked: 'B1' } });
        expect(frameStatus(id)).toBe(404);
        expect(await removePhone(id)).toEqual({ ok: false, error: 'That phone was already removed.' });
        expect(await removePhone('')).toEqual({ ok: false, error: 'That phone no longer exists.' });
    });
});
