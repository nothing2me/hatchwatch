import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AlertsFeed } from '@/features/alerts/AlertsFeed';
import { siteAlert } from './siteFixtures';

afterEach(() => { cleanup(); localStorage.clear(); });

const alerts = [
    siteAlert('a1'),
    siteAlert('a2', { protection: 'protected', nesting: 'confirmed', personActed: true }),
    siteAlert('a3', { active: false, outcome: 'hatched', nesting: 'confirmed', protection: 'protected', personActed: true }),
    siteAlert('a4', { active: false, archivedAt: '2026-10-09T00:20:00.000Z' }),
    siteAlert('a5', { active: false, nesting: 'noNest', protection: 'notNeeded', personActed: true }),
];

describe('AlertsFeed', () =>
{
    it('remembers collapsing under the HatchWatch key and keeps a state saved before the rename', () =>
    {
        const first = render(<AlertsFeed alerts={alerts} onSelect={() => undefined} />);
        fireEvent.click(screen.getByRole('button', { name: 'Collapse alerts' }));
        expect(localStorage.getItem('hatchwatch.alerts.open')).toBe('false');
        first.unmount();
        localStorage.clear();
        localStorage.setItem('nesttrace.alerts.open', 'false');
        render(<AlertsFeed alerts={alerts} onSelect={() => undefined} />);
        expect(screen.queryByRole('button', { name: 'Collapse alerts' })).toBeNull();
        expect(localStorage.getItem('hatchwatch.alerts.open')).toBe('false');
        expect(localStorage.getItem('nesttrace.alerts.open')).toBeNull();
    });

    it('counts active and inactive sites in the tabs', () =>
    {
        render(<AlertsFeed alerts={alerts} onSelect={vi.fn()} />);
        expect(screen.getByRole('radio', { name: 'Active (2)' }).getAttribute('aria-checked')).toBe('true');
        expect(screen.getByRole('radio', { name: 'Inactive (3)' }).getAttribute('aria-checked')).toBe('false');
    });

    it('uses the server inactive count when given (the snapshot carries only the newest inactive sites)', () =>
    {
        render(<AlertsFeed alerts={alerts} inactiveCount={41} onSelect={vi.fn()} />);
        expect(screen.getByRole('radio', { name: 'Inactive (41)' })).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Active (2)' })).toBeTruthy();
    });

    it('shows only active sites with a protection pill and nesting text', () =>
    {
        render(<AlertsFeed alerts={alerts} onSelect={vi.fn()} />);
        const cards = screen.getAllByRole('button', { name: /Digging activity detected/ });
        expect(cards).toHaveLength(2);
        expect(within(cards[0]).getByText('Unprotected')).toBeTruthy();
        expect(within(cards[0]).getByText('Nesting unresolved')).toBeTruthy();
        expect(within(cards[1]).getByText('Protected')).toBeTruthy();
        expect(within(cards[1]).getByText('Nest confirmed by patrol')).toBeTruthy();
        expect(within(cards[0]).queryByText('Patrolled')).toBeNull();
    });

    it('marks sites a patrol has visited', () =>
    {
        render(<AlertsFeed alerts={[siteAlert('p', { patrolVisited: true, personActed: true })]} onSelect={vi.fn()} />);
        expect(screen.getByText('Patrolled')).toBeTruthy();
    });

    it('switches to inactive sites showing their outcome, dimmed', () =>
    {
        render(<AlertsFeed alerts={alerts} onSelect={vi.fn()} />);
        fireEvent.click(screen.getByRole('radio', { name: 'Inactive (3)' }));
        const cards = screen.getAllByRole('button', { name: /Digging activity detected/ });
        expect(cards).toHaveLength(3);
        expect(within(cards[0]).getByText('Hatched')).toBeTruthy();
        expect(within(cards[1]).getByText('Archived')).toBeTruthy();
        expect(within(cards[2]).getByText('No nest found')).toBeTruthy();
        expect(cards[0].getAttribute('data-inactive')).toBe('true');
    });

    it('moves between tabs with the arrow keys', () =>
    {
        render(<AlertsFeed alerts={alerts} onSelect={vi.fn()} />);
        const active = screen.getByRole('radio', { name: 'Active (2)' });
        fireEvent.keyDown(active, { key: 'ArrowRight' });
        const inactive = screen.getByRole('radio', { name: 'Inactive (3)' });
        expect(inactive.getAttribute('aria-checked')).toBe('true');
        expect(document.activeElement).toBe(inactive);
        fireEvent.keyDown(inactive, { key: 'ArrowLeft' });
        expect(screen.getByRole('radio', { name: 'Active (2)' }).getAttribute('aria-checked')).toBe('true');
    });

    it('selects a card and marks the open site', () =>
    {
        const onSelect = vi.fn();
        render(<AlertsFeed alerts={alerts} onSelect={onSelect} selectedId="a2" />);
        const cards = screen.getAllByRole('button', { name: /Digging activity detected/ });
        fireEvent.click(cards[0]);
        expect(onSelect).toHaveBeenCalledWith(alerts[0]);
        expect(cards[1].getAttribute('aria-expanded')).toBe('true');
    });

    it('shows an empty state per tab', () =>
    {
        render(<AlertsFeed alerts={[alerts[0]]} onSelect={vi.fn()} />);
        fireEvent.click(screen.getByRole('radio', { name: 'Inactive (0)' }));
        expect(screen.getByText('No inactive sites.')).toBeTruthy();
    });

    it('filters activities independently and keeps the list scrollable', () =>
    {
        const crawl = siteAlert('crawl', {}, { kind: 'TRACK_ONLY', message: 'Crawl tracked; digging not observed.' });
        render(<AlertsFeed alerts={[alerts[0], crawl]} onSelect={vi.fn()} />);
        const list = screen.getByRole('list', { name: 'Active sites' });
        expect(list.className).toContain('overflow-y-auto');
        fireEvent.click(screen.getByRole('checkbox', { name: 'Digging' }));
        expect(screen.queryByRole('button', { name: /Digging activity detected/ })).toBeNull();
        expect(screen.getByRole('button', { name: /Crawl tracked/ })).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Active (1)' })).toBeTruthy();
    });
});
