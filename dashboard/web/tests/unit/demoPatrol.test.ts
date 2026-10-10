import { describe, expect, it } from 'vitest';
import { DEMO_OUTCOME_WEIGHTS, dueSteps, outcomeFor, planFor } from '@/lib/live/demoPatrol';
import { summarizeSite } from '@/lib/sites/summary';
import { classifyOutcome } from '@/lib/sites/outcomes';

const ids = Array.from({ length: 4000 }, (_, i) => `cm${i.toString(36).padStart(6, '0')}site`);

describe('demo patrol', () =>
{
    it('picks the same outcome for a site every time', () =>
    {
        expect(ids.slice(0, 50).map(outcomeFor)).toEqual(ids.slice(0, 50).map(outcomeFor));
    });

    it('spreads outcomes close to the declared weights', () =>
    {
        const counts = new Map<string, number>();
        for (const id of ids)
        {
            counts.set(outcomeFor(id), (counts.get(outcomeFor(id)) ?? 0) + 1);
        }
        for (const [outcome, weight] of DEMO_OUTCOME_WEIGHTS)
        {
            expect((counts.get(outcome) ?? 0) / ids.length).toBeCloseTo(weight, 1);
        }
    });

    it('ends each outcome in the matching site state', () =>
    {
        const at = (minutes: number) => new Date(Date.UTC(2026, 9, 10, 20, 0) + minutes * 60_000);
        const seen = new Set<string>();
        for (const id of ids.slice(0, 200))
        {
            const plan = planFor(id);
            seen.add(plan.outcome);
            const events = [{ type: 'detected' as const, at: at(0) }, ...plan.steps.map(step => ({ type: step.type, at: at(step.afterMinutes) }))];
            const summary = summarizeSite(events);
            const expected = {
                protect: { protection: 'protected', nesting: 'confirmed' },
                damaged: { protection: 'protected', nesting: 'confirmed' },
                noEggs: { protection: 'notNeeded', nesting: 'noNest' },
                forgot: { protection: 'unprotected', nesting: 'confirmed' },
                unseen: { protection: 'unprotected', nesting: 'unresolved' },
            }[plan.outcome];
            expect({ protection: summary.protection, nesting: summary.nesting }).toEqual(expected);
            expect(summary.damaged).toBe(plan.outcome === 'damaged');
            // Never-seen sites end up Not saved once they age off the map.
            if (plan.outcome === 'unseen')
            {
                expect(classifyOutcome(summarizeSite([...events, { type: 'archived', at: at(20) }]))).toBe('notSaved');
            }
            // Every step lands after the alert can exist and well before the 20 min archive age.
            expect(plan.steps.every(step => step.afterMinutes >= 3 && step.afterMinutes < 12)).toBe(true);
        }
        expect(seen).toEqual(new Set(['protect', 'damaged', 'noEggs', 'forgot', 'unseen']));
    });

    it('releases steps only when due, and never repeats logged ones', () =>
    {
        const id = ids.find(candidate => outcomeFor(candidate) === 'protect')!;
        const plan = planFor(id);
        const detected = new Date(Date.UTC(2026, 9, 10, 20, 0));
        const after = (minutes: number) => new Date(detected.getTime() + Math.round(minutes * 60_000));

        expect(dueSteps(plan, detected, after(2.9), 0)).toEqual([]);
        expect(dueSteps(plan, detected, after(plan.steps[0].afterMinutes), 0).map(step => step.type)).toEqual(['patrolVisit']);
        expect(dueSteps(plan, detected, after(30), 0).map(step => step.type)).toEqual(['patrolVisit', 'nestConfirmed', 'protectionInstalled']);
        expect(dueSteps(plan, detected, after(30), 2).map(step => step.type)).toEqual(['protectionInstalled']);
        expect(dueSteps(plan, detected, after(30), 3)).toEqual([]);
    });
});
