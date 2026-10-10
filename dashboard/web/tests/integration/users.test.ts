import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@/lib/db';
import { onChange } from '@/lib/changes';
import { verifyPassword } from '@/lib/auth/password';
import { createUser, listUsers, setDisabled, setRole, UserError } from '@/lib/users/manage';
import { seedDatabase } from '../../prisma/seed';

const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
let adminId: string;

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

const rejects = async (promise: Promise<unknown>, code: string) =>
{
    const error = await promise.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(UserError);
    expect((error as UserError).code).toBe(code);
};

describe('user management', () =>
{
    it('creates a volunteer with a verifiable one-time password, audit row and change', async () =>
    {
        const reasons: string[] = [];
        const off = onChange(reason => reasons.push(reason));
        const { user, temporaryPassword } = await createUser(prisma, adminId, { name: ' Test Volunteer ', email: ' Volunteer@NestTrace.Local ', role: 'VOLUNTEER' });
        off();
        expect(temporaryPassword).toMatch(/^[A-Za-z0-9_-]{12}$/);
        expect(user).toMatchObject({ name: 'Test Volunteer', email: 'volunteer@nesttrace.local', role: 'VOLUNTEER', disabledAt: null });
        expect(user).not.toHaveProperty('passwordHash');
        const row = await prisma.user.findUniqueOrThrow({ where: { email: 'volunteer@nesttrace.local' } });
        expect(await verifyPassword(row.passwordHash, temporaryPassword)).toBe(true);
        expect(await prisma.auditLog.count({ where: { action: 'user.create', targetId: row.id, userId: adminId } })).toBe(1);
        expect(reasons).toContain('users');
        expect((await listUsers(prisma)).map(u => u.email)).toContain('volunteer@nesttrace.local');
    });

    it('rejects a duplicate email in any case and a blank name or bad email', async () =>
    {
        await createUser(prisma, adminId, { name: 'A', email: 'a@x.org', role: 'VIEWER' });
        await rejects(createUser(prisma, adminId, { name: 'B', email: 'A@X.ORG', role: 'VOLUNTEER' }), 'EMAIL_TAKEN');
        await rejects(createUser(prisma, adminId, { name: '  ', email: 'c@x.org', role: 'VOLUNTEER' }), 'INVALID');
        await rejects(createUser(prisma, adminId, { name: 'C', email: 'not-an-email', role: 'VOLUNTEER' }), 'INVALID');
    });

    it('changes roles, audited, but never your own', async () =>
    {
        const { user } = await createUser(prisma, adminId, { name: 'V', email: 'v@x.org', role: 'VOLUNTEER' });
        await setRole(prisma, adminId, user.id, 'VIEWER');
        expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe('VIEWER');
        expect(await prisma.auditLog.count({ where: { action: 'user.role', targetId: user.id } })).toBe(1);
        await rejects(setRole(prisma, adminId, adminId, 'VIEWER'), 'SELF');
        await rejects(setRole(prisma, adminId, 'nope', 'VIEWER'), 'NOT_FOUND');
    });

    it('disables and re-enables, but never yourself', async () =>
    {
        const { user } = await createUser(prisma, adminId, { name: 'V', email: 'v@x.org', role: 'VOLUNTEER' });
        await setDisabled(prisma, adminId, user.id, true);
        expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).disabledAt).not.toBeNull();
        expect(await prisma.auditLog.count({ where: { action: 'user.disable', targetId: user.id } })).toBe(1);
        await setDisabled(prisma, adminId, user.id, false);
        expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).disabledAt).toBeNull();
        expect(await prisma.auditLog.count({ where: { action: 'user.enable', targetId: user.id } })).toBe(1);
        await rejects(setDisabled(prisma, adminId, adminId, true), 'SELF');
    });
});
