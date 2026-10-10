import { z } from 'zod';
import { currentUserOrNull, hasRole } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { addSiteEvent, SiteEventError } from '@/lib/sites/events';
import { PERSON_EVENTS } from '@/lib/sites/summary';
import type { SiteEventType } from '@/lib/types';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
    type: z.string().refine(type => PERSON_EVENTS.includes(type as SiteEventType), 'Unknown entry type'),
    note: z.string().max(1000).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ alertId: string }> }): Promise<Response>
{
    const user = await currentUserOrNull();
    if (!user)
    {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(user, 'VOLUNTEER'))
    {
        return Response.json({ error: 'Volunteers and admins only' }, { status: 403 });
    }
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
    {
        return Response.json({ error: 'Invalid entry' }, { status: 400 });
    }
    const { alertId } = await context.params;
    try
    {
        const summary = await addSiteEvent(prisma, { alertId, type: parsed.data.type as SiteEventType, note: parsed.data.note, userId: user.id, author: user.name });
        return Response.json({ summary });
    }
    catch (error)
    {
        if (error instanceof SiteEventError)
        {
            const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'NEEDS_CONFIRMED' ? 409 : 400;
            return Response.json({ error: error.message }, { status });
        }
        throw error;
    }
}
