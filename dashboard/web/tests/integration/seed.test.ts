import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verify } from '@node-rs/argon2';
import { createPrismaClient } from '@/lib/db';
import { seedDatabase } from '../../prisma/seed';

// Requires `docker compose up -d db` and a migrated database (Task 2 Step 2).
const prisma = createPrismaClient(process.env.DATABASE_URL);

describe('seedDatabase', () =>
{
    beforeAll(async () =>
    {
        await prisma.$executeRawUnsafe('TRUNCATE "AuditLog","AlertStatusChange","AlertNote","Alert","Track","Job","Video","Camera","Zone","User" CASCADE');
    });

    afterAll(async () =>
    {
        await prisma.$disconnect();
    });

    it('is idempotent and never overwrites an existing admin password', async () =>
    {
        await seedDatabase(prisma, { adminEmail: 'admin@test.local', adminPassword: 'first-password' });
        await seedDatabase(prisma, { adminEmail: 'admin@test.local', adminPassword: 'second-password' });

        expect(await prisma.zone.count()).toBe(4);
        expect(await prisma.camera.count()).toBe(8);
        expect(await prisma.user.count()).toBe(2);

        const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.local' } });
        expect(admin.role).toBe('ADMIN');
        expect(await verify(admin.passwordHash, 'first-password')).toBe(true);
    });
});
