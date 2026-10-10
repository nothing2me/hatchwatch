import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { MapSnapshot } from '@/lib/types';
import { siteAlert } from './siteFixtures';

vi.mock('@/app/(app)/actions', () => ({ logoutAction: vi.fn() }));

const { AnalyticsScreen } = await import('@/features/analytics/AnalyticsScreen');
const { TopBar } = await import('@/features/shell/TopBar');

afterEach(() => { cleanup(); localStorage.clear(); });

const viewer = { id: 'u', email: 'v@x.y', name: 'V', role: 'VIEWER' as const };
const admin = { ...viewer, role: 'ADMIN' as const };

const snapshot: MapSnapshot = {
    zones: [
        { id: 'za', code: 'A', name: 'Sand Point access', activityLevel: 'LOW', ring: [] },
        { id: 'zb', code: 'B', name: 'Holiday Beach access', activityLevel: 'HIGH', ring: [] },
    ],
    cameras: [],
    alerts: [
        siteAlert('a1'),
        siteAlert('a2', { protection: 'protected', nesting: 'confirmed', personActed: true, patrolVisited: true }, { zoneCode: 'A' }),
        siteAlert('a3', { active: false, outcome: 'hatched', nesting: 'confirmed', protection: 'protected', personActed: true, patrolVisited: true }),
        siteAlert('a4', { active: false, archivedAt: '2026-10-09T00:20:00.000Z' }),
    ],
    camerasOnline: 2, camerasTotal: 4, inactiveCount: 2,
    outcomes: { saved: 1, notSaved: 1, pending: 2 }, fadeMinutes: 5, tracks: [], dangerCount: 0, dangerTotal: 0,
};

const tile = (label: string) => screen.getByRole('group', { name: label });

describe('AnalyticsScreen', () =>
{
    it('shows the heading, tiles and outcomes for the live map by default', () =>
    {
        render(<AnalyticsScreen snapshot={snapshot} user={viewer} />);
        expect(screen.getByRole('heading', { name: 'Tonight at a glance' })).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'On the map now' }).getAttribute('aria-checked')).toBe('true');
        expect(within(tile('Sites')).getByTestId('value').textContent).toBe('2');
        expect(within(tile('Unprotected')).getByTestId('value').textContent).toBe('1');
        expect(tile('Unprotected').getAttribute('data-tone')).toBe('danger');
        expect(within(tile('Patrol visited')).getByTestId('value').textContent).toBe('1');
        expect(within(tile('Seen by both cameras')).getByTestId('value').textContent).toBe('100%');
        expect(within(tile('Archived')).getByTestId('value').textContent).toBe('0');
        const outcomes = screen.getByRole('region', { name: 'Outcomes' });
        expect(within(outcomes).getByRole('img').getAttribute('aria-label')).toBe('Outcomes: 0 saved, 0 not saved, 2 pending');
    });

    it('switches every total to the whole log with the scope toggle', () =>
    {
        render(<AnalyticsScreen snapshot={snapshot} user={viewer} />);
        fireEvent.click(screen.getByRole('radio', { name: 'Everything logged' }));
        expect(within(tile('Sites')).getByTestId('value').textContent).toBe('4');
        expect(within(tile('Unprotected')).getByTestId('value').textContent).toBe('2');
        expect(within(tile('Archived')).getByTestId('value').textContent).toBe('1');
        const outcomes = screen.getByRole('region', { name: 'Outcomes' });
        expect(within(outcomes).getByRole('img').getAttribute('aria-label')).toBe('Outcomes: 1 saved, 1 not saved, 2 pending');
        expect(outcomes.textContent).toContain('25%');
        expect(outcomes.textContent).toContain('50%');
    });

    it('draws the three bar charts as labelled SVG images listing every zone', () =>
    {
        render(<AnalyticsScreen snapshot={snapshot} user={viewer} />);
        expect(screen.getByRole('img', { name: 'Protection: Unprotected 1, Protected 1, Not needed 0' })).toBeTruthy();
        expect(screen.getByRole('img', { name: 'Nesting: Unresolved 1, Nest confirmed 1, No nest found 0' })).toBeTruthy();
        const zones = screen.getByRole('img', { name: 'Sites by zone: Zone A 1, Zone B 1' });
        expect(zones.tagName.toLowerCase()).toBe('svg');
        expect(zones.textContent).toContain('Zone A');
        expect(zones.textContent).toContain('Sites');
    });

    it('can show a chart as a table', () =>
    {
        render(<AnalyticsScreen snapshot={snapshot} user={viewer} />);
        fireEvent.click(screen.getAllByRole('button', { name: 'Show table' })[0]);
        const table = screen.getByRole('table');
        expect(within(table).getByText('Unprotected')).toBeTruthy();
    });

    it('shows an empty state when there are no sites', () =>
    {
        render(<AnalyticsScreen snapshot={{ ...snapshot, alerts: [], inactiveCount: 0, outcomes: { saved: 0, notSaved: 0, pending: 0 } }} user={viewer} />);
        expect(screen.getByText('No sites yet — waiting for the live feed')).toBeTruthy();
    });
});

describe('AnalyticsScreen dangers', () =>
{
    it('shows a Danger alerts tile with open / total and explains danger in Not saved', () =>
    {
        render(<AnalyticsScreen snapshot={{ ...snapshot, dangerCount: 2, dangerTotal: 5 }} user={viewer} />);
        expect(within(tile('Danger alerts')).getByTestId('value').textContent).toBe('2/5');
        expect(tile('Danger alerts').getAttribute('data-tone')).toBe('danger');
        expect(screen.getByRole('region', { name: 'Outcomes' }).textContent).toContain('no protection 30 min after a person came near');
    });

    it('keeps the danger tile calm when none are open', () =>
    {
        render(<AnalyticsScreen snapshot={{ ...snapshot, dangerCount: 0, dangerTotal: 3 }} user={viewer} />);
        expect(within(tile('Danger alerts')).getByTestId('value').textContent).toBe('0/3');
        expect(tile('Danger alerts').getAttribute('data-tone')).toBeNull();
    });
});

describe('TopBar', () =>
{
    it('shows a red danger chip linking to the first danger only when one is open', () =>
    {
        const { rerender } = render(<TopBar user={viewer} current="analytics" camerasOnline={1} camerasTotal={2} activeSites={3} dangerCount={2} firstDangerId="d7" />);
        const chip = screen.getByRole('link', { name: /2 danger/ });
        expect(chip.getAttribute('href')).toBe('/?alert=d7');
        expect(chip.getAttribute('data-tone')).toBe('danger');
        rerender(<TopBar user={viewer} current="analytics" camerasOnline={1} camerasTotal={2} activeSites={3} dangerCount={0} firstDangerId={null} />);
        expect(screen.queryByRole('link', { name: /danger/ })).toBeNull();
    });

    it('opens the danger in place on the map page', () =>
    {
        const onDanger = vi.fn();
        render(<TopBar user={viewer} current="map" camerasOnline={1} camerasTotal={2} activeSites={3} dangerCount={1} firstDangerId="d7" onDanger={onDanger} />);
        fireEvent.click(screen.getByRole('link', { name: /1 danger/ }));
        expect(onDanger).toHaveBeenCalledWith('d7');
    });

    it('counts active sites and highlights the current page', () =>
    {
        render(<TopBar user={viewer} current="analytics" camerasOnline={1} camerasTotal={2} activeSites={23} />);
        expect(screen.getByText('23')).toBeTruthy();
        expect(screen.getByText('active sites')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Analytics' }).getAttribute('aria-current')).toBe('page');
        expect(screen.getByRole('link', { name: 'Map' }).getAttribute('aria-current')).toBeNull();
        expect(screen.queryByRole('link', { name: 'Setup' })).toBeNull();
    });

    it('shows Setup to admins and uses the singular for one site', () =>
    {
        render(<TopBar user={admin} current="map" camerasOnline={1} camerasTotal={2} activeSites={1} />);
        expect(screen.getByRole('link', { name: 'Setup' }).getAttribute('href')).toBe('/setup');
        expect(screen.getByRole('link', { name: 'Map' }).getAttribute('aria-current')).toBe('page');
        expect(screen.getByText('active site')).toBeTruthy();
    });

    it('drops the Users link on phones only (Setup links to it)', () =>
    {
        render(<TopBar user={admin} current="map" camerasOnline={1} camerasTotal={2} activeSites={1} />);
        expect(screen.getByRole('link', { name: 'Users' }).className).toContain('max-sm:hidden');
        expect(screen.getByRole('link', { name: 'Setup' }).className).not.toContain('max-sm:hidden');
    });
});
