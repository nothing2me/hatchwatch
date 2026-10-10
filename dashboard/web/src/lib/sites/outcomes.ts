import type { SiteSummary } from '@/lib/types';

export type OutcomeClass = 'saved' | 'notSaved' | 'pending' | 'none';

// Nest sites only: callers leave DANGER alerts out (they are events about a site, not sites).
export function classifyOutcome(summary: SiteSummary, now: Date | number = Date.now()): OutcomeClass
{
    if (summary.nesting === 'noNest') return 'none';
    if (summary.outcome === 'hatched') return 'saved';
    if (summary.outcome === 'lost') return 'notSaved';
    if (!summary.active && summary.protection === 'unprotected') return 'notSaved';
    // A person came near and no protection was logged within 30 minutes of the first danger.
    if (summary.dangerDeadline !== null && new Date(summary.dangerDeadline).getTime() <= new Date(now).getTime()) return 'notSaved';
    return 'pending';
}

export function outcomeCounts(summaries: SiteSummary[], now: Date | number = Date.now()): { saved: number; notSaved: number; pending: number }
{
    const counts = { saved: 0, notSaved: 0, pending: 0 };
    for (const summary of summaries)
    {
        const kind = classifyOutcome(summary, now);
        if (kind !== 'none')
        {
            counts[kind] += 1;
        }
    }
    return counts;
}
