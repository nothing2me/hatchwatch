import { currentUserOrNull } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { summarizeSite } from '@/lib/sites/summary';
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
    const summary = summarizeSite(alert.events.map(event => ({ type: event.type as SiteEventType, at: event.at, createdAt: event.createdAt })));
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
        },
        summary,
        events: [...alert.events].reverse().map(event => ({ id: event.id, type: event.type, author: event.author, note: event.note, at: event.at.toISOString() })),
    });
}
