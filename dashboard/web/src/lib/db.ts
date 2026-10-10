import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

// No `server-only` import here: the seed CLI (tsx) imports this module outside Next.
// Server-only guarding lives in the consumers (src/server/snapshot.ts, src/lib/auth/guard.ts).

// One client per server process; dev hot-reload would otherwise open new pools.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient
{
    if (!connectionString)
    {
        throw new Error('DATABASE_URL is not set');
    }

    return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production')
{
    globalForPrisma.prisma = prisma;
}
