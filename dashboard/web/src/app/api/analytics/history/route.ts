import { Prisma } from '@/generated/prisma/client';
import { currentUserOrNull } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { DEMO_PATROL_AUTHOR } from '@/lib/live/demoPatrol';

export const dynamic = 'force-dynamic';

type Range = '24h' | '7d' | '30d' | 'all';
type HistoryRow = { window: Date; videos: number; digging: number; crawl: number; danger: number; patrol: number; protected: number; noNest: number };

export async function GET(request: Request): Promise<Response>
{
    if (!(await currentUserOrNull())) return new Response('Unauthorized', { status: 401 });
    const requested = new URL(request.url).searchParams.get('range');
    const range: Range = requested === '24h' || requested === '7d' || requested === '30d' ? requested : 'all';
    const now = new Date();
    const earliest = await prisma.$queryRaw<{ at: Date | null }[]>`
        SELECT MIN(at) AS at FROM (
            SELECT MIN("createdAt") AS at FROM "Alert"
            UNION ALL SELECT MIN("createdAt") FROM "Video"
            UNION ALL SELECT MIN("createdAt") FROM "SiteEvent"
        ) entries`;
    const firstLoggedAt = earliest[0]?.at ?? null;
    const periods: Record<Exclude<Range, 'all'>, number> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 };
    const from = range === 'all' ? (firstLoggedAt ?? now) : new Date(now.getTime() - periods[range]);
    const bucket = range === '24h' ? 'hour' : range === 'all' ? 'month' : 'day';
    const rows = await prisma.$queryRaw<HistoryRow[]>(Prisma.sql`
        WITH logged AS (
            SELECT "createdAt" AS at, CASE "kind"::text
                WHEN 'DIGGING' THEN 'digging' WHEN 'TRACK_ONLY' THEN 'crawl'
                WHEN 'DANGER' THEN 'danger' ELSE 'other' END AS category
            FROM "Alert" WHERE "createdAt" >= ${from} AND "createdAt" <= ${now}
            UNION ALL SELECT "createdAt", 'video' FROM "Video" WHERE "createdAt" >= ${from} AND "createdAt" <= ${now}
            UNION ALL SELECT "createdAt", CASE "type"
                WHEN 'patrolVisit' THEN 'patrol' WHEN 'protectionInstalled' THEN 'protected'
                WHEN 'noNestFound' THEN 'noNest' ELSE 'other' END
            FROM "SiteEvent" WHERE "createdAt" >= ${from} AND "createdAt" <= ${now}
        )
        SELECT date_trunc(${bucket}, at) AT TIME ZONE 'UTC' AS window,
            COUNT(*) FILTER (WHERE category = 'video')::int AS videos,
            COUNT(*) FILTER (WHERE category = 'digging')::int AS digging,
            COUNT(*) FILTER (WHERE category = 'crawl')::int AS crawl,
            COUNT(*) FILTER (WHERE category = 'danger')::int AS danger,
            COUNT(*) FILTER (WHERE category = 'patrol')::int AS patrol,
            COUNT(*) FILTER (WHERE category = 'protected')::int AS protected,
            COUNT(*) FILTER (WHERE category = 'noNest')::int AS "noNest"
        FROM logged GROUP BY 1 ORDER BY 1 DESC`);
    const demo = await prisma.siteEvent.count({ where: { author: DEMO_PATROL_AUTHOR, createdAt: { gte: from, lte: now } } });
    return Response.json({ range, includesDemoPatrol: demo > 0, bucket, from: from.toISOString(), to: now.toISOString(), firstLoggedAt: firstLoggedAt?.toISOString() ?? null,
        rows: rows.map(row => ({ ...row, window: row.window.toISOString() })) }, { headers: { 'Cache-Control': 'no-store' } });
}
