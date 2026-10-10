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
