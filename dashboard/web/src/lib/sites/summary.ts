import type { AlertKind, AlertStatus, Secured, SiteEventType, SiteSummary } from '@/lib/types';

export const PERSON_EVENTS: SiteEventType[] = ['patrolVisit', 'nestConfirmed', 'noNestFound', 'nestDamaged', 'protectionInstalled', 'hatched', 'lost', 'note', 'dangerResolved'];
const ON_SITE: SiteEventType[] = ['patrolVisit', 'nestConfirmed', 'noNestFound', 'nestDamaged', 'protectionInstalled', 'hatched', 'lost'];
/** Person entries that answer an active danger on a nest site. */
export const RESOLVES_DANGER: SiteEventType[] = ['dangerResolved', 'protectionInstalled', 'patrolVisit', 'nestDamaged', 'note'];
/** Entry types a person may add to a DANGER alert itself. */
export const DANGER_ALERT_EVENTS: SiteEventType[] = ['dangerResolved'];
/** Minutes after the first danger within which protection must be logged, or the site counts as Not saved. */
export const DANGER_PROTECT_MINUTES = 30;

type Ev = { type: SiteEventType; at: Date | string; createdAt?: Date | string; author?: string };
const time = (at: Date | string) => (at instanceof Date ? at : new Date(at));
/** Entries that secure a nest site: protection set up, or a danger resolved (on the site or any of its danger alerts). */
export const SECURES_SITE: SiteEventType[] = ['protectionInstalled', 'dangerResolved'];

const byTime = (a: Ev, b: Ev) => time(a.at).getTime() - time(b.at).getTime()
    || (a.createdAt && b.createdAt ? time(a.createdAt).getTime() - time(b.createdAt).getTime() : 0);

// Who secured a site and when: the first securing entry after its latest danger (or, with no danger, the first
// protection). A newer danger un-secures the site until it is resolved or protected again. Pass the site's own log,
// plus the `dangerResolved` entries of its danger alerts.
export function securedOf(events: Ev[]): Secured | null
{
    let secured: Secured | null = null;
    for (const event of [...events].sort(byTime))
    {
        if (event.type === 'danger')
        {
            secured = null;
        }
        else if (SECURES_SITE.includes(event.type))
        {
            secured ??= { by: event.author || 'A volunteer', at: time(event.at).toISOString() };
        }
    }
    return secured;
}

// Reads a site's log oldest-first; later entries win so a patrol can correct an earlier finding.
// A DANGER alert's own log (`kind: 'DANGER'`) is active until its danger is resolved and never carries a deadline.
export function summarizeSite(events: Ev[], kind?: AlertKind): SiteSummary
{
    // Ties on `at` fall back to creation order, then to input order (Array.sort is stable).
    const ordered = [...events].sort(byTime);
    const summary: SiteSummary = { protection: 'unprotected', nesting: 'unresolved', outcome: 'open', active: true, personActed: false, patrolVisited: false, detectedAt: null, archivedAt: null, damaged: false, danger: 'none', dangerDeadline: null, secured: null };
    let archivedWithoutFollowUp = false;
    let firstDanger: number | null = null;
    let protectedAt: number | null = null;

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
        if (event.type === 'danger')
        {
            summary.danger = 'active';
            firstDanger ??= time(event.at).getTime();
        }
        else if (summary.danger === 'active' && RESOLVES_DANGER.includes(event.type))
        {
            summary.danger = 'resolved';
        }
        switch (event.type)
        {
            case 'detected': summary.detectedAt ??= iso; break;
            case 'archived': summary.archivedAt = iso; archivedWithoutFollowUp = true; break;
            case 'nestConfirmed': summary.nesting = 'confirmed'; if (summary.protection === 'notNeeded') summary.protection = 'unprotected'; break;
            case 'noNestFound': summary.nesting = 'noNest'; summary.protection = 'notNeeded'; break;
            // A damaged nest is still a nest: it stays active so the patrol can protect what's left or log it lost.
            case 'nestDamaged': summary.damaged = true; summary.nesting = 'confirmed'; if (summary.protection === 'notNeeded') summary.protection = 'unprotected'; break;
            case 'protectionInstalled': summary.protection = 'protected'; protectedAt ??= time(event.at).getTime(); break;
            case 'hatched': summary.outcome = 'hatched'; break;
            case 'lost': summary.outcome = 'lost'; break;
            default: break;
        }
    }

    if (kind === 'DANGER')
    {
        summary.active = summary.danger !== 'resolved';
        return summary;
    }
    summary.active = summary.outcome === 'open' && summary.nesting !== 'noNest' && !archivedWithoutFollowUp;
    summary.secured = securedOf(ordered);
    // Not-saved rule: protection must be logged by the first danger + 30 min (protection logged earlier also counts).
    if (firstDanger !== null)
    {
        const deadline = firstDanger + DANGER_PROTECT_MINUTES * 60_000;
        if (protectedAt === null || protectedAt > deadline)
        {
            summary.dangerDeadline = new Date(deadline).toISOString();
        }
    }
    return summary;
}

export function statusFor(summary: SiteSummary, events: { type: SiteEventType }[], kind?: AlertKind): AlertStatus
{
    // A resolved danger alert is cached as REVIEWED and listed under Inactive.
    if (kind === 'DANGER') return summary.danger === 'resolved' ? 'REVIEWED' : 'NEW';
    if (summary.outcome === 'hatched') return 'HATCHED';
    if (summary.outcome === 'lost') return 'LOST';
    if (summary.nesting === 'noNest') return 'DISMISSED';
    if (!summary.active) return 'ARCHIVED';
    if (summary.nesting === 'confirmed') return 'FIELD_CONFIRMED';
    return events.some(event => PERSON_EVENTS.includes(event.type)) ? 'REVIEWED' : 'NEW';
}
