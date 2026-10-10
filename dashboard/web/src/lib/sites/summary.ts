import type { AlertStatus, SiteEventType, SiteSummary } from '@/lib/types';

export const PERSON_EVENTS: SiteEventType[] = ['patrolVisit', 'nestConfirmed', 'noNestFound', 'protectionInstalled', 'hatched', 'lost', 'note'];
const ON_SITE: SiteEventType[] = ['patrolVisit', 'nestConfirmed', 'noNestFound', 'protectionInstalled', 'hatched', 'lost'];

type Ev = { type: SiteEventType; at: Date | string };
const time = (at: Date | string) => (at instanceof Date ? at : new Date(at));

// Reads a site's log oldest-first; later entries win so a patrol can correct an earlier finding.
export function summarizeSite(events: Ev[]): SiteSummary
{
    const ordered = [...events].sort((a, b) => time(a.at).getTime() - time(b.at).getTime());
    const summary: SiteSummary = { protection: 'unprotected', nesting: 'unresolved', outcome: 'open', active: true, personActed: false, patrolVisited: false, detectedAt: null, archivedAt: null };
    let archivedWithoutFollowUp = false;

    for (const event of ordered)
    {
        const iso = time(event.at).toISOString();
        if (PERSON_EVENTS.includes(event.type))
        {
            summary.personActed = true;
            archivedWithoutFollowUp = false;
        }
        if (ON_SITE.includes(event.type))
        {
            summary.patrolVisited = true;
        }
        switch (event.type)
        {
            case 'detected': summary.detectedAt ??= iso; break;
            case 'archived': summary.archivedAt = iso; archivedWithoutFollowUp = true; break;
            case 'nestConfirmed': summary.nesting = 'confirmed'; if (summary.protection === 'notNeeded') summary.protection = 'unprotected'; break;
            case 'noNestFound': summary.nesting = 'noNest'; summary.protection = 'notNeeded'; break;
            case 'protectionInstalled': summary.protection = 'protected'; break;
            case 'hatched': summary.outcome = 'hatched'; break;
            case 'lost': summary.outcome = 'lost'; break;
            default: break;
        }
    }

    summary.active = summary.outcome === 'open' && summary.nesting !== 'noNest' && !archivedWithoutFollowUp;
    return summary;
}

export function statusFor(summary: SiteSummary, events: { type: SiteEventType }[]): AlertStatus
{
    if (summary.outcome === 'hatched') return 'HATCHED';
    if (summary.outcome === 'lost') return 'LOST';
    if (summary.nesting === 'noNest') return 'DISMISSED';
    if (!summary.active) return 'ARCHIVED';
    if (summary.nesting === 'confirmed') return 'FIELD_CONFIRMED';
    return events.some(event => PERSON_EVENTS.includes(event.type)) ? 'REVIEWED' : 'NEW';
}
