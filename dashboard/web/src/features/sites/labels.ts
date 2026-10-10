import type { Nesting, Outcome, Protection, SiteEventType, SiteSummary } from '@/lib/types';

export interface Tone
{
    label: string;
    color: string;
}

export const PROTECTION: Record<Protection, Tone> = {
    unprotected: { label: 'Unprotected', color: '#E2581F' },
    protected: { label: 'Protected', color: '#4ADE80' },
    notNeeded: { label: 'No protection needed', color: '#8A9BA6' },
};

export const NESTING: Record<Nesting, string> = {
    unresolved: 'Nesting unresolved',
    confirmed: 'Nest confirmed by patrol',
    noNest: 'No nest found',
};

export const OUTCOME: Record<Exclude<Outcome, 'open'>, Tone> = {
    hatched: { label: 'Hatched', color: '#4ADE80' },
    lost: { label: 'Lost', color: '#E2581F' },
};

export const EVENT_LABELS: Record<SiteEventType, string> = {
    detected: 'Arrived',
    departed: 'Left',
    archived: 'Faded from live map',
    patrolVisit: 'Patrol visited',
    nestConfirmed: 'Nest confirmed',
    noNestFound: 'No nest found',
    protectionInstalled: 'Protection set up',
    hatched: 'Hatched',
    lost: 'Lost',
    note: 'Note',
};

// Why a site left the active list: its outcome, a no-nest finding, or ageing out untouched.
export function inactiveState(site: SiteSummary): Tone
{
    if (site.outcome !== 'open')
    {
        return OUTCOME[site.outcome];
    }
    if (site.nesting === 'noNest')
    {
        return { label: NESTING.noNest, color: PROTECTION.notNeeded.color };
    }
    return { label: 'Archived', color: '#8A9BA6' };
}

export function eventLabel(type: string): string
{
    return EVENT_LABELS[type as SiteEventType] ?? type;
}
