import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AlertsFeed } from '@/features/alerts/AlertsFeed';
import type { AlertView } from '@/lib/types';
import { siteAlert } from './siteFixtures';

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

const DANGER = 'Danger · person near an active nest site — immediate action';
const danger = (id: string, siteId: string, createdAt = '2026-10-09T01:00:00.000Z', extra: Partial<AlertView> = {}) =>
    siteAlert(id, { danger: 'active' }, { kind: 'DANGER', level: 1, siteId, createdAt, message: DANGER, startT: 14.2, endT: 16, ...extra });

const sites = [
    siteAlert('s1', { danger: 'active' }, { colorIndex: 0, startT: 8, createdAt: '2026-10-09T00:59:00.000Z' }),
    siteAlert('s2', { danger: 'active' }, { colorIndex: 3, startT: 20, createdAt: '2026-10-09T00:59:30.000Z' }),
    siteAlert('s3', { danger: 'active', active: false, outcome: 'lost' }, { startT: 30 }),
];
const alerts = [...sites, danger('d1', 's1'), danger('d2', 's2', '2026-10-09T01:00:20.000Z'), danger('d3', 's3', '2026-10-09T01:00:30.000Z')];

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;

describe('AlertsFeed dangers', () =>
{
    it('puts one group card first in Active with a level-1 badge', () =>
    {
        render(<AlertsFeed alerts={alerts} onSelect={vi.fn()} canResolve />);
        const list = screen.getByRole('list', { name: 'Active sites' });
        const first = within(list).getAllByRole('listitem')[0];
        expect(first.textContent).toContain('Person on the beach near 3 sites');
        expect(within(first).getByText('Level 1 · Danger')).toBeTruthy();
        // Grouped: the three danger alerts do not appear as their own cards.
        expect(screen.queryAllByRole('button', { name: new RegExp(DANGER) })).toHaveLength(0);
    });

    it('expands to one row per site with Resolve buttons and flags a closed site', () =>
    {
        render(<AlertsFeed alerts={alerts} onSelect={vi.fn()} canResolve />);
        fireEvent.click(screen.getByRole('button', { name: /Person on the beach near 3 sites/ }));
        const rows = screen.getAllByRole('group', { name: /^Danger at / });
        expect(rows).toHaveLength(3);
        expect(within(rows[0]).getByRole('button', { name: /Zone B · blue trail · dug at 8.0 s/ })).toBeTruthy();
        expect(within(rows[0]).getByRole('button', { name: 'Resolve' })).toBeTruthy();
        expect(within(rows[2]).getByText('Site closed · danger still open')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Resolve all' })).toBeTruthy();
    });

    it('opens the danger when a site row is chosen', () =>
    {
        const onSelect = vi.fn();
        render(<AlertsFeed alerts={alerts} onSelect={onSelect} canResolve />);
        fireEvent.click(screen.getByRole('button', { name: /Person on the beach near 3 sites/ }));
        fireEvent.click(screen.getByRole('button', { name: /Zone B · violet trail · dug at 20.0 s/ }));
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'd2' }));
    });

    it('resolves one site, then all of them', async () =>
    {
        const fetchMock = vi.fn(async () => json({ summary: {} }));
        vi.stubGlobal('fetch', fetchMock);
        render(<AlertsFeed alerts={alerts} onSelect={vi.fn()} canResolve />);
        fireEvent.click(screen.getByRole('button', { name: /Person on the beach near 3 sites/ }));
        fireEvent.click(within(screen.getAllByRole('group', { name: /^Danger at / })[1]).getByRole('button', { name: 'Resolve' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(fetchMock).toHaveBeenCalledWith('/api/sites/d2/events', expect.objectContaining({ method: 'POST', body: JSON.stringify({ type: 'dangerResolved' }) }));
        fireEvent.click(screen.getByRole('button', { name: 'Resolve all' }));
        // The row already resolved here is not posted again before the live snapshot catches up.
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        expect(fetchMock.mock.calls.slice(1).map(call => (call as unknown[])[0])).toEqual(['/api/sites/d1/events', '/api/sites/d3/events']);
    });

    it('shows the server message when a resolve fails', async () =>
    {
        vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'Volunteers and admins only' }, 403)));
        render(<AlertsFeed alerts={alerts} onSelect={vi.fn()} canResolve />);
        fireEvent.click(screen.getByRole('button', { name: /Person on the beach near 3 sites/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Resolve all' }));
        expect((await screen.findByRole('alert')).textContent).toContain('Volunteers and admins only');
    });

    it('is read-only for viewers', () =>
    {
        render(<AlertsFeed alerts={alerts} onSelect={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /Person on the beach near 3 sites/ }));
        expect(screen.getAllByRole('group', { name: /^Danger at / })).toHaveLength(3);
        expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Resolve all' })).toBeNull();
    });

    it('lists a resolved danger in Inactive with who resolved it', () =>
    {
        const resolved = siteAlert('d9', { danger: 'resolved', active: false }, { kind: 'DANGER', level: 1, siteId: 's1', message: DANGER, resolvedBy: 'Vera Volunteer' });
        render(<AlertsFeed alerts={[sites[0], resolved]} onSelect={vi.fn()} />);
        fireEvent.click(screen.getByRole('radio', { name: /Inactive/ }));
        const card = screen.getByRole('button', { name: /Danger resolved by Vera Volunteer/ });
        expect(card.textContent).not.toContain('Not saved');
    });

    it('says "near 1 site" for a single danger', () =>
    {
        render(<AlertsFeed alerts={[sites[0], danger('d1', 's1')]} onSelect={vi.fn()} />);
        expect(screen.getByRole('button', { name: /Person on the beach near 1 site\b/ })).toBeTruthy();
    });

    it('stays open when its first danger is resolved and drops out of the list', () =>
    {
        const { rerender } = render(<AlertsFeed alerts={alerts} onSelect={vi.fn()} canResolve />);
        fireEvent.click(screen.getByRole('button', { name: /Person on the beach near 3 sites/ }));
        rerender(<AlertsFeed alerts={alerts.filter(alert => alert.id !== 'd1')} onSelect={vi.fn()} canResolve />);
        expect(screen.getAllByRole('group', { name: /^Danger at / })).toHaveLength(2);
        expect(screen.getByRole('button', { name: 'Resolve all' })).toBeTruthy();
    });
});
