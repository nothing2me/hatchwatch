import type { AlertKind, PrismaClient, Prisma } from '@/generated/prisma/client';
import { publishChange } from '@/lib/changes';
import type { SiteEventType, SiteSummary } from '@/lib/types';
import { DANGER_ALERT_EVENTS, PERSON_EVENTS, RESOLVES_DANGER, statusFor, summarizeSite } from './summary';

export class SiteEventError extends Error
{
    constructor(public code: 'NOT_FOUND' | 'NEEDS_CONFIRMED' | 'NOT_PERSON_EVENT' | 'WRONG_KIND', message: string) { super(message); }
}

type EventInput = { alertId: string; type: SiteEventType; note?: string; userId: string | null; author: string; at?: Date; system?: boolean };
type Ev = { type: SiteEventType; at: Date; createdAt: Date };

const lock = (tx: Prisma.TransactionClient, id: string) => tx.$queryRaw`SELECT id FROM "Alert" WHERE id = ${id} FOR UPDATE`;

async function loadLocked(tx: Prisma.TransactionClient, id: string)
{
    return tx.alert.findUnique({ where: { id }, include: { events: { select: { type: true, at: true, createdAt: true }, orderBy: [{ at: 'asc' }, { createdAt: 'asc' }] } } });
}

// Appends one entry to an already locked alert and refreshes its cached status.
async function append(tx: Prisma.TransactionClient, alert: { id: string; kind: AlertKind; events: { type: string; at: Date; createdAt: Date }[] }, entry: { type: SiteEventType; author: string; userId: string | null; note?: string | null; at: Date }): Promise<{ before: SiteSummary; after: SiteSummary }>
{
    const before = summarizeSite(alert.events as Ev[], alert.kind);
    const created = await tx.siteEvent.create({ data: { alertId: alert.id, type: entry.type, author: entry.author, userId: entry.userId, note: entry.note?.slice(0, 1000) || null, at: entry.at } });
    const events = [...alert.events, { type: created.type, at: created.at, createdAt: created.createdAt }] as Ev[];
    const after = summarizeSite(events, alert.kind);
    await tx.alert.update({ where: { id: alert.id }, data: { status: statusFor(after, events, alert.kind) } });
    return { before, after };
}

// Marks every still-active DANGER alert of a nest site resolved. Caller holds the site's row lock (site first, then its dangers).
async function resolveSiteDangers(tx: Prisma.TransactionClient, siteId: string, entry: { author: string; userId: string | null; at: Date; note: string }, skip?: string)
{
    const dangers = await tx.alert.findMany({ where: { siteId, kind: 'DANGER', status: 'NEW' }, select: { id: true }, orderBy: { id: 'asc' } });
    for (const { id } of dangers)
    {
        if (id === skip)
        {
            continue;
        }
        await lock(tx, id);
        const danger = await loadLocked(tx, id);
        if (danger && summarizeSite(danger.events as Ev[], 'DANGER').danger !== 'resolved')
        {
            await append(tx, danger, { type: 'dangerResolved', ...entry });
        }
    }
}

export async function addSiteEvent(prisma: PrismaClient, input: EventInput & { onlyIfUntouched: true }): Promise<SiteSummary | null>;
export async function addSiteEvent(prisma: PrismaClient, input: EventInput): Promise<SiteSummary>;
export async function addSiteEvent(prisma: PrismaClient, input: EventInput & { onlyIfUntouched?: boolean }): Promise<SiteSummary | null>
{
    if (!input.system && !PERSON_EVENTS.includes(input.type))
    {
        throw new SiteEventError('NOT_PERSON_EVENT', `${input.type} entries come from the cameras, not people.`);
    }
    const summary = await prisma.$transaction(async tx =>
    {
        // Lock order is always nest site first, then its danger alerts, so a volunteer on the site and one on its
        // danger alert (or the watcher) never deadlock. A DANGER alert's site never changes, so reading it unlocked is safe.
        const target = await tx.alert.findUnique({ where: { id: input.alertId }, select: { kind: true, siteId: true } });
        if (!target)
        {
            throw new SiteEventError('NOT_FOUND', 'Site not found.');
        }
        if (target.siteId)
        {
            await lock(tx, target.siteId);
        }
        // Row lock first: concurrent events on one site (watcher plus volunteers) run one at a time.
        await lock(tx, input.alertId);
        const alert = await loadLocked(tx, input.alertId);
        if (!alert)
        {
            throw new SiteEventError('NOT_FOUND', 'Site not found.');
        }
        if (input.onlyIfUntouched && (alert.kind === 'DANGER' || alert.events.some(event => PERSON_EVENTS.includes(event.type as SiteEventType) || event.type === 'danger')))
        {
            // Danger alerts and sites with a danger are never aged out without a person.
            return null;
        }
        const isDanger = alert.kind === 'DANGER';
        if (!input.system && isDanger && !DANGER_ALERT_EVENTS.includes(input.type))
        {
            throw new SiteEventError('WRONG_KIND', 'A danger alert can only be resolved; log other entries on its nest site.');
        }
        if (!input.system && !isDanger && input.type === 'dangerResolved')
        {
            throw new SiteEventError('WRONG_KIND', 'Resolve the danger alert itself, or log a patrol, protection or note on this site.');
        }
        if (input.type === 'hatched' && summarizeSite(alert.events as Ev[], alert.kind).nesting !== 'confirmed')
        {
            throw new SiteEventError('NEEDS_CONFIRMED', 'Confirm the nest before marking it hatched.');
        }
        const at = input.at ?? new Date();
        const { before, after } = await append(tx, alert, { type: input.type, author: input.author, userId: input.userId, note: input.note, at });

        if (isDanger && input.type === 'dangerResolved' && before.danger !== 'resolved' && alert.siteId)
        {
            // Resolving a danger alert resolves its site's danger, and with it the site's other open danger alerts.
            const site = await loadLocked(tx, alert.siteId);
            if (site && summarizeSite(site.events as Ev[], site.kind).danger === 'active')
            {
                await append(tx, site, { type: 'dangerResolved', author: input.author, userId: input.userId, note: input.note, at });
            }
            await resolveSiteDangers(tx, alert.siteId, { author: input.author, userId: input.userId, at, note: 'Resolved with another danger alert of this site.' }, alert.id);
        }
        else if (!isDanger && before.danger === 'active' && after.danger === 'resolved')
        {
            await resolveSiteDangers(tx, alert.id, { author: input.author, userId: input.userId, at, note: `Resolved on the site log (${input.type}).` });
        }
        return after;
    });
    if (summary)
    {
        publishChange('site-event');
    }
    return summary;
}
