import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { PrismaClient } from '../src/generated/prisma/client';
import { statusFor, summarizeSite } from '../src/lib/sites/summary';
import type { SiteEventType } from '../src/lib/types';

// Sites created before the site log existed have no events. Give each one the `detected`
// entry the cameras would have written, then recompute its cached status from that log.
// Idempotent: only sites with no events at all are touched.
export async function backfillSiteEvents(prisma: PrismaClient): Promise<number>
{
    const bare = await prisma.alert.findMany({ where: { events: { none: {} } }, select: { id: true, detectedAt: true, createdAt: true } });
    let filled = 0;
    for (const alert of bare)
    {
        filled += await prisma.$transaction(async tx =>
        {
            await tx.$queryRaw`SELECT id FROM "Alert" WHERE id = ${alert.id} FOR UPDATE`;
            if (await tx.siteEvent.count({ where: { alertId: alert.id } }))
            {
                return 0;
            }
            const created = await tx.siteEvent.create({ data: { alertId: alert.id, type: 'detected', author: 'Camera', userId: null, at: alert.detectedAt ?? alert.createdAt } });
            const events = [{ type: created.type as SiteEventType, at: created.at, createdAt: created.createdAt }];
            await tx.alert.update({ where: { id: alert.id }, data: { status: statusFor(summarizeSite(events), events) } });
            return 1;
        });
    }
    return filled;
}

// CLI entry: `npm run db:backfill-site-events`
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
{
    const { createPrismaClient } = await import('../src/lib/db');
    const prisma = createPrismaClient();
    const count = await backfillSiteEvents(prisma);
    await prisma.$disconnect();
    console.log(`Backfilled ${count} site log(s)`);
}
