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

describe('danger lifecycle', () =>
{
    it('a danger entry is active until a resolve, protection, patrol or note follows', () =>
    {
        expect(summarizeSite([e('detected', 0)]).danger).toBe('none');
        expect(summarizeSite([e('detected', 0), e('danger', 1)]).danger).toBe('active');
        for (const type of ['dangerResolved', 'protectionInstalled', 'patrolVisit', 'note'])
        {
            expect(summarizeSite([e('detected', 0), e('danger', 1), e(type, 2)]).danger).toBe('resolved');
        }
        expect(summarizeSite([e('detected', 0), e('danger', 1), e('nestConfirmed', 2)]).danger).toBe('active');
        expect(summarizeSite([e('detected', 0), e('danger', 1), e('note', 2), e('danger', 3)]).danger).toBe('active');
    });

    it('a danger does not change a nest site status or activity on its own', () =>
    {
        const events = [e('detected', 0), e('danger', 1)];
        expect(summarizeSite(events)).toMatchObject({ active: true, personActed: false });
        expect(statusFor(summarizeSite(events), events)).toBe('NEW');
    });

    it('a DANGER alert is active until resolved, then cached as REVIEWED', () =>
    {
        const open = [e('danger', 0)];
        expect(summarizeSite(open, 'DANGER')).toMatchObject({ danger: 'active', active: true, dangerDeadline: null });
        expect(statusFor(summarizeSite(open, 'DANGER'), open, 'DANGER')).toBe('NEW');
        const done = [e('danger', 0), e('dangerResolved', 4)];
        expect(summarizeSite(done, 'DANGER')).toMatchObject({ danger: 'resolved', active: false });
        expect(statusFor(summarizeSite(done, 'DANGER'), done, 'DANGER')).toBe('REVIEWED');
    });

    it('sets a not-saved deadline 30 min after the first danger unless protection came by then', () =>
    {
        expect(summarizeSite([e('detected', 0), e('danger', 1)]).dangerDeadline).toBe('2026-10-09T20:31:00.000Z');
        expect(summarizeSite([e('detected', 0), e('danger', 1), e('danger', 10)]).dangerDeadline).toBe('2026-10-09T20:31:00.000Z');
        expect(summarizeSite([e('detected', 0), e('danger', 1), e('protectionInstalled', 31)]).dangerDeadline).toBeNull();
        expect(summarizeSite([e('detected', 0), e('protectionInstalled', 1), e('danger', 5)]).dangerDeadline).toBeNull();
        expect(summarizeSite([e('detected', 0), e('danger', 1), e('protectionInstalled', 32)]).dangerDeadline).toBe('2026-10-09T20:31:00.000Z');
        expect(summarizeSite([e('detected', 0)]).dangerDeadline).toBeNull();
    });
});
