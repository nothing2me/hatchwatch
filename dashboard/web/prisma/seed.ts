import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { hash } from '@node-rs/argon2';
import type { PrismaClient } from '../src/generated/prisma/client';
import { DEMO_VIEWER, SEED_CAMERAS, SEED_ZONES } from './seed-data';

export interface SeedOptions
{
    adminEmail: string;
    adminPassword: string;
}

// Safe to run on every container start: creates what is missing and leaves
// existing rows (including edited zones and changed passwords) untouched.
export async function seedDatabase(prisma: PrismaClient, options: SeedOptions): Promise<void>
{
    for (const zone of SEED_ZONES)
    {
        await prisma.zone.upsert({
            where: { code: zone.code },
            update: {},
            create: { code: zone.code, name: zone.name, activityLevel: zone.activityLevel, outline: zone.outline },
        });
    }

    for (const camera of SEED_CAMERAS)
    {
        const zone = await prisma.zone.findUniqueOrThrow({ where: { code: camera.zoneCode } });
        await prisma.camera.upsert({
            where: { code: camera.code },
            update: {},
            create: {
                code: camera.code,
                zoneId: zone.id,
                lng: camera.lng,
                lat: camera.lat,
                headingDeg: camera.headingDeg,
                fovDeg: camera.fovDeg,
                rangeM: camera.rangeM,
                status: camera.status,
            },
        });
    }

    await prisma.user.upsert({
        where: { email: options.adminEmail },
        update: {},
        create: { email: options.adminEmail, name: 'Admin', role: 'ADMIN', passwordHash: await hash(options.adminPassword) },
    });

    const viewerExists = await prisma.user.findUnique({ where: { email: DEMO_VIEWER.email } });
    if (!viewerExists)
    {
        const viewerPassword = randomBytes(9).toString('base64url');
        await prisma.user.create({
            data: { email: DEMO_VIEWER.email, name: DEMO_VIEWER.name, role: 'VIEWER', passwordHash: await hash(viewerPassword) },
        });
        if (process.env.NODE_ENV !== 'test')
        {
            console.log(`Seeded viewer ${DEMO_VIEWER.email} with password: ${viewerPassword}`);
        }
    }
}

// CLI entry: `tsx prisma/seed.ts`
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
{
    const { createPrismaClient } = await import('../src/lib/db');
    const adminEmail = process.env.SEED_ADMIN_EMAIL;
    const adminPassword = process.env.SEED_ADMIN_PASSWORD;
    if (!adminEmail || !adminPassword)
    {
        throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set');
    }
    const prisma = createPrismaClient();
    await seedDatabase(prisma, { adminEmail, adminPassword });
    await prisma.$disconnect();
    console.log('Seed complete');
}
