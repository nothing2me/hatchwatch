import { describe, expect, it } from 'vitest';
import { statusFor, summarizeSite } from '@/lib/sites/summary';

const e = (type: string, minute: number) => ({ type: type as never, at: new Date(Date.UTC(2026, 9, 9, 20, minute)) });

describe('summarizeSite', () =>
{
    it('defaults to an unprotected, unresolved, open, active site', () =>
    {
        const s = summarizeSite([e('detected', 0)]);
        expect(s).toMatchObject({ protection: 'unprotected', nesting: 'unresolved', outcome: 'open', active: true, personActed: false, patrolVisited: false });
        expect(s.detectedAt).toBe('2026-10-09T20:00:00.000Z');
    });
    it('later entries win and sorting is by time, not insertion', () =>
    {
        const s = summarizeSite([e('nestConfirmed', 5), e('detected', 0), e('noNestFound', 3)]);
        expect(s.nesting).toBe('confirmed');
        expect(s.protection).toBe('unprotected');
    });
    it('no nest found makes protection not needed and the site inactive', () =>
    {
        const s = summarizeSite([e('detected', 0), e('noNestFound', 2)]);
        expect(s).toMatchObject({ protection: 'notNeeded', nesting: 'noNest', active: false, patrolVisited: true });
    });
    it('hatched and lost close the site', () =>
    {
        expect(summarizeSite([e('detected', 0), e('nestConfirmed', 1), e('hatched', 9)])).toMatchObject({ outcome: 'hatched', active: false });
        expect(summarizeSite([e('detected', 0), e('lost', 9)])).toMatchObject({ outcome: 'lost', active: false });
    });
    it('archived only deactivates when no person acted afterwards', () =>
    {
        expect(summarizeSite([e('detected', 0), e('archived', 20)])).toMatchObject({ active: false, archivedAt: '2026-10-09T20:20:00.000Z' });
        expect(summarizeSite([e('detected', 0), e('archived', 20), e('patrolVisit', 25)])).toMatchObject({ active: true, personActed: true });
    });
    it('maps to the cached Alert.status', () =>
    {
        const cases: [string[], string][] = [
            [['detected'], 'NEW'],
            [['detected', 'patrolVisit'], 'REVIEWED'],
            [['detected', 'nestConfirmed'], 'FIELD_CONFIRMED'],
            [['detected', 'noNestFound'], 'DISMISSED'],
            [['detected', 'nestConfirmed', 'hatched'], 'HATCHED'],
            [['detected', 'lost'], 'LOST'],
            [['detected', 'archived'], 'ARCHIVED'],
        ];
        for (const [types, status] of cases)
        {
            const events = types.map((type, i) => e(type, i));
            expect(statusFor(summarizeSite(events), events)).toBe(status);
        }
    });

    it('breaks ties on at by createdAt, not input order', () =>
    {
        const at = new Date(Date.UTC(2026, 9, 9, 20, 5));
        const archived = { type: 'archived' as const, at, createdAt: new Date(Date.UTC(2026, 9, 9, 20, 5, 1)) };
        const visit = { type: 'patrolVisit' as const, at, createdAt: new Date(Date.UTC(2026, 9, 9, 20, 5, 2)) };
        const detected = e('detected', 0);
        expect(summarizeSite([detected, archived, visit]).active).toBe(true);
        expect(summarizeSite([detected, visit, archived]).active).toBe(true);
        const late = { ...archived, createdAt: new Date(Date.UTC(2026, 9, 9, 20, 5, 3)) };
        expect(summarizeSite([detected, late, visit]).active).toBe(false);
        expect(summarizeSite([detected, visit, late]).active).toBe(false);
    });
});
