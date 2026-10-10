import { currentUserOrNull } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { securedOf, summarizeSite } from '@/lib/sites/summary';
import { loadDangerResolutions } from '@/server/snapshot';
import type { SiteEventType } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ alertId: string }> }): Promise<Response>
{
    if (!(await currentUserOrNull()))
    {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { alertId } = await context.params;
    const alert = await prisma.alert.findUnique({
        where: { id: alertId },
        include: { zone: { select: { code: true } }, camera: { select: { code: true } }, events: { orderBy: [{ at: 'asc' }, { createdAt: 'asc' }] } },
    });
    if (!alert)
    {
        return Response.json({ error: 'Site not found' }, { status: 404 });
    }
    const events = alert.events.map(event => ({ type: event.type as SiteEventType, at: event.at, createdAt: event.createdAt, author: event.author }));
    const summary = summarizeSite(events, alert.kind);
    if (alert.kind !== 'DANGER')
    {
        // A resolution logged on one of the site's danger alerts also secures it.
        const resolutions = await loadDangerResolutions(prisma, [alert.id]);
        summary.secured = securedOf([...events, ...resolutions.map(row => ({ ...row, type: 'dangerResolved' as const }))]);
    }
    return Response.json({
        site: {
            id: alert.id,
            kind: alert.kind,
            message: alert.message,
            status: alert.status,
            zoneCode: alert.zone.code,
            cameraCode: alert.camera.code,
            position: alert.lng !== null && alert.lat !== null ? [alert.lng, alert.lat] : null,
            createdAt: alert.createdAt.toISOString(),
            videoId: alert.videoId,
            simulated: alert.simulated,
            level: alert.level,
            siteId: alert.siteId,
            startT: alert.startT,
            endT: alert.endT,
        },
        summary,
        events: [...alert.events].reverse().map(event => ({ id: event.id, type: event.type, author: event.author, note: event.note, at: event.at.toISOString() })),
    });
}
