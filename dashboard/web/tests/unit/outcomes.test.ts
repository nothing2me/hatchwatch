import { describe, expect, it } from 'vitest';
import { classifyOutcome, outcomeCounts } from '@/lib/sites/outcomes';
import { summarizeSite } from '@/lib/sites/summary';

const site = (...types: string[]) => summarizeSite(types.map((type, i) => ({ type: type as never, at: new Date(Date.UTC(2026, 9, 9, 20, i)) })));

describe('classifyOutcome', () =>
{
    it('hatched is saved with or without logged protection', () =>
    {
        expect(classifyOutcome(site('detected', 'nestConfirmed', 'hatched'))).toBe('saved');
        expect(classifyOutcome(site('detected', 'nestConfirmed', 'protectionInstalled', 'hatched'))).toBe('saved');
    });
    it('lost is not saved', () =>
    {
        expect(classifyOutcome(site('detected', 'lost'))).toBe('notSaved');
    });
    it('archived with no person entry is not saved', () =>
    {
        expect(classifyOutcome(site('detected', 'archived'))).toBe('notSaved');
    });
    it('archived with protection installed stays pending', () =>
    {
        expect(classifyOutcome(site('detected', 'protectionInstalled', 'archived'))).toBe('pending');
    });
    it('a fresh detection is pending', () =>
    {
        expect(classifyOutcome(site('detected'))).toBe('pending');
    });
    it('no nest found is excluded from counts', () =>
    {
        const none = site('detected', 'noNestFound');
        expect(classifyOutcome(none)).toBe('none');
        expect(outcomeCounts([none, site('detected'), site('detected', 'lost'), site('detected', 'nestConfirmed', 'hatched')])).toEqual({ saved: 1, notSaved: 1, pending: 1 });
    });
});

describe('danger not-saved rule', () =>
{
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 9, 20, minute));
    const log = (...entries: [string, number][]) => summarizeSite(entries.map(([type, minute]) => ({ type: type as never, at: at(minute) })));

    it('a danger without protection within 30 min is not saved once the 30 min pass', () =>
    {
        const site = log(['detected', 0], ['danger', 1], ['patrolVisit', 5]);
        expect(classifyOutcome(site, at(20))).toBe('pending');
        expect(classifyOutcome(site, at(31))).toBe('notSaved');
        expect(outcomeCounts([site], at(40))).toEqual({ saved: 0, notSaved: 1, pending: 0 });
    });
    it('protection within 30 min keeps the site pending', () =>
    {
        expect(classifyOutcome(log(['detected', 0], ['danger', 1], ['protectionInstalled', 20]), at(90))).toBe('pending');
    });
    it('protection after 30 min is too late', () =>
    {
        expect(classifyOutcome(log(['detected', 0], ['danger', 1], ['protectionInstalled', 45]), at(90))).toBe('notSaved');
    });
    it('a hatch still counts as saved', () =>
    {
        expect(classifyOutcome(log(['detected', 0], ['danger', 1], ['nestConfirmed', 50], ['hatched', 80]), at(90))).toBe('saved');
    });
});
