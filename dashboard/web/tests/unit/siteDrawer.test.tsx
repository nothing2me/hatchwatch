import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SiteSummary } from '@/lib/types';
import { openSite, siteAlert } from './siteFixtures';

vi.mock('@/features/sites/SiteCloseUp', () => ({ SiteCloseUp: () => <div data-testid="close-up" /> }));

const { SiteDrawer } = await import('@/features/sites/SiteDrawer');

const admin = { id: 'u1', email: 'a@x.y', name: 'Ada', role: 'ADMIN' as const };
const viewer = { ...admin, role: 'VIEWER' as const };
const volunteer = { ...admin, role: 'VOLUNTEER' as const };

const log = (summary: Partial<SiteSummary> = {}) => ({
    site: { id: 'a1' },
    summary: { ...openSite, ...summary },
    events: [
        { id: 'e2', type: 'patrolVisit', author: 'Ada', note: 'Tracks still visible', at: '2026-10-09T00:10:00.000Z' },
        { id: 'e1', type: 'detected', author: 'Camera', note: null, at: '2026-10-09T00:00:00.000Z' },
    ],
});

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('SiteDrawer', () =>
{
    it('shows the site log newest first with labels and authors', async () =>
    {
        vi.stubGlobal('fetch', vi.fn(async () => json(log())));
        render(<SiteDrawer alert={siteAlert('a1')} user={viewer} onClose={vi.fn()} />);
        expect(await screen.findByText('Patrol visited')).toBeTruthy();
        const items = screen.getAllByRole('listitem');
        expect(items[0].textContent).toContain('Patrol visited');
        expect(items[0].textContent).toContain('Ada');
        expect(items[0].textContent).toContain('Tracks still visible');
        expect(items[1].textContent).toContain('Arrived');
        expect(screen.getByRole('dialog').textContent).toContain('Zone B');
        expect(screen.getByTestId('close-up')).toBeTruthy();
    });

    it('hides the patrol form from viewers', async () =>
    {
        vi.stubGlobal('fetch', vi.fn(async () => json(log())));
        render(<SiteDrawer alert={siteAlert('a1')} user={viewer} onClose={vi.fn()} />);
        await screen.findByText('Patrol visited');
        expect(screen.queryByLabelText('Entry')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Add to log' })).toBeNull();
    });

    it('lets volunteers log entries but disables hatched until the nest is confirmed', async () =>
    {
        vi.stubGlobal('fetch', vi.fn(async () => json(log())));
        render(<SiteDrawer alert={siteAlert('a1')} user={volunteer} onClose={vi.fn()} />);
        await screen.findByText('Patrol visited');
        const hatched = screen.getByRole('option', { name: 'Hatched' }) as HTMLOptionElement;
        expect(hatched.disabled).toBe(true);
        expect(screen.getByText('Confirm the nest first')).toBeTruthy();
    });

    it('enables hatched once the nest is confirmed', async () =>
    {
        vi.stubGlobal('fetch', vi.fn(async () => json(log({ nesting: 'confirmed' }))));
        render(<SiteDrawer alert={siteAlert('a1', { nesting: 'confirmed' })} user={admin} onClose={vi.fn()} />);
        await screen.findByText('Patrol visited');
        expect((screen.getByRole('option', { name: 'Hatched' }) as HTMLOptionElement).disabled).toBe(false);
        expect(screen.queryByText('Confirm the nest first')).toBeNull();
    });

    it('posts an entry and reloads the log', async () =>
    {
        const fetchMock = vi.fn(async (url: string, init?: RequestInit) => init?.method === 'POST' ? json({ summary: openSite }) : json(log()));
        vi.stubGlobal('fetch', fetchMock);
        render(<SiteDrawer alert={siteAlert('a1')} user={admin} onClose={vi.fn()} />);
        await screen.findByText('Patrol visited');
        fireEvent.change(screen.getByLabelText('Entry'), { target: { value: 'protectionInstalled' } });
        fireEvent.change(screen.getByLabelText(/Note/), { target: { value: 'Cage set' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add to log' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        const post = fetchMock.mock.calls[1];
        expect(post[0]).toBe('/api/sites/a1/events');
        expect(post[1]?.method).toBe('POST');
        expect(JSON.parse(String(post[1]?.body))).toEqual({ type: 'protectionInstalled', note: 'Cage set' });
        expect(fetchMock.mock.calls[2][0]).toBe('/api/sites/a1');
    });

    it('offers direct protection and Google Maps actions on a pin', async () =>
    {
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? json({ summary: openSite }) : json(log()));
        vi.stubGlobal('fetch', fetchMock);
        render(<SiteDrawer alert={siteAlert('a1')} user={volunteer} onClose={vi.fn()} />);
        await screen.findByText('Patrol visited');
        const maps = screen.getByRole('link', { name: /Open in Google Maps/ }) as HTMLAnchorElement;
        expect(maps.href).toContain('google.com/maps/search/');
        fireEvent.click(screen.getByRole('button', { name: 'Mark protected' }));
        await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
        expect(JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')?.[1]?.body))).toEqual({ type: 'protectionInstalled' });
    });

    it('shows the server message when the entry is refused', async () =>
    {
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
            ? json({ error: 'Confirm the nest before marking it hatched.' }, 409)
            : json(log({ nesting: 'confirmed' })));
        vi.stubGlobal('fetch', fetchMock);
        render(<SiteDrawer alert={siteAlert('a1', { nesting: 'confirmed' })} user={admin} onClose={vi.fn()} />);
        await screen.findByText('Patrol visited');
        fireEvent.change(screen.getByLabelText('Entry'), { target: { value: 'hatched' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add to log' }));
        expect((await screen.findByRole('alert')).textContent).toContain('Confirm the nest before marking it hatched.');
    });

    it('closes on Escape', async () =>
    {
        vi.stubGlobal('fetch', vi.fn(async () => json(log())));
        const onClose = vi.fn();
        render(<SiteDrawer alert={siteAlert('a1')} user={viewer} onClose={onClose} />);
        await screen.findByText('Patrol visited');
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });

    it('keeps Tab focus inside the drawer', async () =>
    {
        vi.stubGlobal('fetch', vi.fn(async () => json(log())));
        render(<SiteDrawer alert={siteAlert('a1')} user={admin} onClose={vi.fn()} />);
        await screen.findByText('Patrol visited');
        const close = screen.getByRole('button', { name: 'Close site' });
        const submit = screen.getByRole('button', { name: 'Add to log' });
        expect(document.activeElement).toBe(close);
        submit.focus();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
        expect(document.activeElement).toBe(close);
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(submit);
    });
});

describe('SiteDrawer for a danger alert', () =>
{
    const DANGER = 'Danger · person near an active nest site — immediate action';
    const site = siteAlert('s1', { danger: 'active' }, { colorIndex: 1, startT: 8 });
    const danger = siteAlert('d1', { danger: 'active', detectedAt: null }, { kind: 'DANGER', level: 1, siteId: 's1', message: DANGER, startT: 14.2, endT: 16.4 });
    const dangerLog = {
        site: { id: 'd1' },
        summary: { ...openSite, danger: 'active' },
        events: [{ id: 'e1', type: 'danger', author: 'Camera', note: 'person-2 within 3 m at 14.2 s of the clip.', at: '2026-10-09T00:00:00.000Z' }],
    };

    it('shows the level, the approach time and the linked site', async () =>
    {
        vi.stubGlobal('fetch', vi.fn(async () => json(dangerLog)));
        const onOpenAlert = vi.fn();
        render(<SiteDrawer alert={danger} linkedSite={site} user={viewer} onClose={vi.fn()} onOpenAlert={onOpenAlert} />);
        await screen.findByText('Person near the site');
        const dialog = screen.getByRole('dialog');
        expect(dialog.getAttribute('aria-label')).toBe('Danger in zone B');
        expect(within(dialog).getByText('Level 1 · Danger')).toBeTruthy();
        expect(within(dialog).getByText('14.2–16.4 s')).toBeTruthy();
        fireEvent.click(within(dialog).getByRole('button', { name: /Zone B · pink trail · dug at 8.0 s/ }));
        expect(onOpenAlert).toHaveBeenCalledWith('s1');
        expect(within(dialog).queryByRole('button', { name: 'Resolve danger' })).toBeNull();
        expect(within(dialog).getByText(/View only/)).toBeTruthy();
    });

    it('lets a volunteer resolve it with an optional note', async () =>
    {
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? json({ summary: openSite }) : json(dangerLog));
        vi.stubGlobal('fetch', fetchMock);
        render(<SiteDrawer alert={danger} linkedSite={site} user={volunteer} onClose={vi.fn()} />);
        await screen.findByText('Person near the site');
        expect(screen.queryByLabelText('Entry')).toBeNull();
        fireEvent.change(screen.getByLabelText(/Note/), { target: { value: 'Walker moved off' } });
        fireEvent.click(screen.getByRole('button', { name: 'Resolve danger' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        const post = fetchMock.mock.calls[1];
        expect(post[0]).toBe('/api/sites/d1/events');
        expect(JSON.parse(String(post[1]?.body))).toEqual({ type: 'dangerResolved', note: 'Walker moved off' });
    });

    it('says when the linked site is already closed', async () =>
    {
        vi.stubGlobal('fetch', vi.fn(async () => json(dangerLog)));
        render(<SiteDrawer alert={danger} linkedSite={siteAlert('s1', { active: false, outcome: 'hatched' }, { startT: 8 })} user={viewer} onClose={vi.fn()} />);
        expect(await screen.findByText('Site closed · danger still open')).toBeTruthy();
    });

    it('on the nest site, flags the open danger and links to it', async () =>
    {
        vi.stubGlobal('fetch', vi.fn(async () => json({ ...log({ danger: 'active' }), events: [dangerLog.events[0]] })));
        const onOpenAlert = vi.fn();
        render(<SiteDrawer alert={site} dangers={[danger]} user={volunteer} onClose={vi.fn()} onOpenAlert={onOpenAlert} />);
        await screen.findByText('Person near the site');
        fireEvent.click(screen.getByRole('button', { name: /Person near this site/ }));
        expect(onOpenAlert).toHaveBeenCalledWith('d1');
        // The site's own form never offers "Danger resolved": that belongs to the danger alert.
        expect(screen.queryByRole('option', { name: 'Danger resolved' })).toBeNull();
    });

    it('says who secured an active site and when', async () =>
    {
        const secured = { by: 'Vera Volunteer', at: '2026-10-09T00:30:00.000Z' };
        vi.stubGlobal('fetch', vi.fn(async () => json(log({ protection: 'protected', secured }))));
        render(<SiteDrawer alert={siteAlert('a1', { protection: 'protected', secured })} user={viewer} onClose={vi.fn()} />);
        await screen.findByText('Patrol visited');
        const line = screen.getByTestId('site-secured');
        expect(line.textContent).toBe('Secured by Vera Volunteer · Oct 8, 7:30 PM');
    });

    it('shows no secured line for an unsecured site', async () =>
    {
        vi.stubGlobal('fetch', vi.fn(async () => json(log())));
        render(<SiteDrawer alert={siteAlert('a1')} user={viewer} onClose={vi.fn()} />);
        await screen.findByText('Patrol visited');
        expect(screen.queryByTestId('site-secured')).toBeNull();
    });
});

