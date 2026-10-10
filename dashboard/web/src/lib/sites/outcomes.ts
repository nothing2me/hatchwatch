import type { SiteSummary } from '@/lib/types';

export type OutcomeClass = 'saved' | 'notSaved' | 'pending' | 'none';

export function classifyOutcome(summary: SiteSummary): OutcomeClass
{
    if (summary.nesting === 'noNest') return 'none';
    if (summary.outcome === 'hatched') return 'saved';
    if (summary.outcome === 'lost') return 'notSaved';
    if (!summary.active && summary.protection === 'unprotected') return 'notSaved';
    return 'pending';
}

export function outcomeCounts(summaries: SiteSummary[]): { saved: number; notSaved: number; pending: number }
{
    const counts = { saved: 0, notSaved: 0, pending: 0 };
    for (const summary of summaries)
    {
        const kind = classifyOutcome(summary);
        if (kind !== 'none')
        {
            counts[kind] += 1;
        }
    }
    return counts;
}
