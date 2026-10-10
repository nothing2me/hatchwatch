import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import type { PrismaClient } from '../src/generated/prisma/client';
import { backfillSiteEvents } from './backfill-site-events';
import { DEMO_VIEWER, SEED_CAMERAS, SEED_ZONES } from './seed-data';

export interface SeedOptions
{
    adminEmail: string;
    adminPassword: string;
    viewerPassword?: string;
}

export function assertNotPlaceholder(name: string, value: string): void
{
    if (value.startsWith('change-me'))
    {
        throw new Error(`${name} is still the .env.example placeholder; set a real value`);
    }
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

    const adminEmail = options.adminEmail.trim().toLowerCase();
    await prisma.user.upsert({
        where: { email: adminEmail },
        update: {},
        create: { email: adminEmail, name: 'Admin', role: 'ADMIN', passwordHash: await hash(options.adminPassword) },
    });

    const viewerExists = await prisma.user.findUnique({ where: { email: DEMO_VIEWER.email } });
    if (!viewerExists)
    {
        const viewerPassword = options.viewerPassword || randomBytes(9).toString('base64url');
        await prisma.user.create({
            data: { email: DEMO_VIEWER.email, name: DEMO_VIEWER.name, role: 'VIEWER', passwordHash: await hash(viewerPassword) },
        });
        if (!options.viewerPassword && process.env.NODE_ENV !== 'production')
        {
            console.log(`Seeded viewer ${DEMO_VIEWER.email} with password: ${viewerPassword}`);
        }
    }

    // Sites from before the site log get their `detected` entry; a no-op once every site has a log.
    const backfilled = await backfillSiteEvents(prisma);
    if (backfilled)
    {
        console.log(`Backfilled ${backfilled} site log(s)`);
    }
}

// CLI entry: `tsx prisma/seed.ts`
if (process.argv[1] && /(?:^|[\\/])seed\.ts$/.test(process.argv[1]))
{
    const { createPrismaClient } = await import('../src/lib/db');
    const adminEmail = process.env.SEED_ADMIN_EMAIL;
    const adminPassword = process.env.SEED_ADMIN_PASSWORD;
    if (!adminEmail || !adminPassword)
    {
        throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set');
    }
    assertNotPlaceholder('SEED_ADMIN_PASSWORD', adminPassword);
    const viewerPassword = process.env.SEED_VIEWER_PASSWORD || undefined;
    if (viewerPassword)
    {
        assertNotPlaceholder('SEED_VIEWER_PASSWORD', viewerPassword);
    }
    const prisma = createPrismaClient();
    await seedDatabase(prisma, { adminEmail, adminPassword, viewerPassword });
    await prisma.$disconnect();
    console.log('Seed complete');
}
