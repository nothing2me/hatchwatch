import type { PrismaClient } from '@/generated/prisma/client';
import { publishChange } from '@/lib/changes';
import type { SiteEventType, SiteSummary } from '@/lib/types';
import { PERSON_EVENTS, statusFor, summarizeSite } from './summary';

export class SiteEventError extends Error
{
    constructor(public code: 'NOT_FOUND' | 'NEEDS_CONFIRMED' | 'NOT_PERSON_EVENT', message: string) { super(message); }
}

export async function addSiteEvent(prisma: PrismaClient, input: { alertId: string; type: SiteEventType; note?: string; userId: string | null; author: string; at?: Date; system?: boolean }): Promise<SiteSummary>
{
    if (!input.system && !PERSON_EVENTS.includes(input.type))
    {
        throw new SiteEventError('NOT_PERSON_EVENT', `${input.type} entries come from the cameras, not people.`);
    }
    const summary = await prisma.$transaction(async tx =>
    {
        const alert = await tx.alert.findUnique({ where: { id: input.alertId }, include: { events: { select: { type: true, at: true } } } });
        if (!alert)
        {
            throw new SiteEventError('NOT_FOUND', 'Site not found.');
        }
        const before = summarizeSite(alert.events as { type: SiteEventType; at: Date }[]);
        if (input.type === 'hatched' && before.nesting !== 'confirmed')
        {
            throw new SiteEventError('NEEDS_CONFIRMED', 'Confirm the nest before marking it hatched.');
        }
        const created = await tx.siteEvent.create({ data: { alertId: alert.id, type: input.type, author: input.author, userId: input.userId, note: input.note?.slice(0, 1000) || null, at: input.at ?? new Date() } });
        const events = [...alert.events, { type: created.type, at: created.at }] as { type: SiteEventType; at: Date }[];
        const after = summarizeSite(events);
        await tx.alert.update({ where: { id: alert.id }, data: { status: statusFor(after, events) } });
        return after;
    });
    publishChange('site-event');
    return summary;
}
