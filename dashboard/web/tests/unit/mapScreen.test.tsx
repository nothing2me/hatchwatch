import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AlertView, MapSnapshot } from '@/lib/types';
import type { Playback } from '@/features/map/playback';

// MapLibre needs WebGL; replace MapView with a stub that exposes camera buttons.
vi.mock('@/features/map/MapView', async () =>
{
    const React = await import('react');
    const { visibleAlerts } = await import('@/features/map/playback');
    return {
        initialBounds: () => [[0, 0], [1, 1]],
        MapView: React.forwardRef(function MapViewStub(props: { snapshot: MapSnapshot; onSelectCamera: (id: string) => void; playback: Playback | null; editing?: boolean; onMapClick?: (at: [number, number]) => void; onDeleteZone?: (code: string) => void }, ref)
        {
            React.useImperativeHandle(ref, () => ({ zoomIn: vi.fn(), zoomOut: vi.fn(), fitBounds: vi.fn(), flyTo: vi.fn() }));
            const visible = visibleAlerts(props.snapshot.alerts, props.playback).map(alert => alert.id).join(',');
            return (
                <div>
                    {props.snapshot.cameras.map(camera => <button key={camera.id} onClick={() => props.onSelectCamera(camera.id)}>cam {camera.code}</button>)}
                    <span data-testid="visible-pins">{visible}</span>
                    <span data-testid="editing">{String(Boolean(props.editing))}</span>
                    <button onClick={() => props.onMapClick?.([-97.05, 27.82])}>map click</button>
                    <button onClick={() => { props.onMapClick?.([-97.05, 27.82]); props.onMapClick?.([-97.05, 27.82]); }}>map double click</button>
                    {props.editing && props.snapshot.zones.filter(zone => zone.custom).map(zone => <button key={zone.id} onClick={() => props.onDeleteZone?.(zone.code)}>remove {zone.code}</button>)}
                </div>
            );
        }),
    };
});
vi.mock('@/app/(app)/actions', () => ({ logoutAction: vi.fn() }));
const addCameraPair = vi.fn();
const deleteZone = vi.fn();
vi.mock('@/app/(app)/camera-actions', () => ({ addCameraPair: (...args: unknown[]) => addCameraPair(...args), deleteZone: (...args: unknown[]) => deleteZone(...args) }));
vi.mock('@/features/sites/SiteCloseUp', () => ({ SiteCloseUp: () => <div data-testid="close-up" /> }));

class FakeEventSource
{
    static instances: FakeEventSource[] = [];
    onmessage: ((event: MessageEvent) => void) | null = null;
    onopen: (() => void) | null = null;
    constructor(public url: string) { FakeEventSource.instances.push(this); }
    close() {}
}
let nextSnapshot: MapSnapshot | null = null;
const fetchMock = vi.fn(async (url: string) =>
{
    if (url === '/api/snapshot')
    {
        return { ok: true, json: async () => nextSnapshot } as Response;
    }
    return { ok: true, json: async () => ({ site: {}, summary: null, events: [{ id: 'e1', type: 'detected', author: 'Camera', note: null, at: '2026-10-09T00:00:00.000Z' }] }) } as Response;
});

const { MapScreen } = await import('@/features/map/MapScreen');

const snapshot: MapSnapshot = {
    zones: [{ id: 'z', code: 'B', name: 'Holiday', activityLevel: 'HIGH', ring: [[0, 0], [1, 0], [1, 1], [0, 0]] }],
    cameras: [{ id: 'c1', code: 'B1', zoneCode: 'B', position: [0.5, 0.5], headingDeg: 203, fovDeg: 44, rangeM: 350, status: 'ONLINE', calibrated: false, video: null }],
    alerts: [],
    camerasOnline: 1, camerasTotal: 1, inactiveCount: 0, outcomes: { saved: 0, notSaved: 0, pending: 0 }, fadeMinutes: 5,
};
const user = { id: 'u', email: 'v@x.y', name: 'V', role: 'VIEWER' as const };

beforeEach(() =>
{
    FakeEventSource.instances = [];
    fetchMock.mockClear();
    addCameraPair.mockReset();
    deleteZone.mockReset();
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

describe('MapScreen', () =>
{
    it('opens the camera panel when a camera is selected and closes it', () =>
    {
        render(<MapScreen snapshot={snapshot} user={user} />);
        expect(screen.queryByText('Camera B1')).toBeNull();
        fireEvent.click(screen.getByText('cam B1'));
        expect(screen.getByText('Camera B1')).toBeTruthy();
        expect(screen.getByText('No footage yet')).toBeTruthy();
        fireEvent.click(screen.getByLabelText('Close camera panel'));
        expect(screen.queryByText('Camera B1')).toBeNull();
    });

    it('hides Setup link for viewers', () =>
    {
        render(<MapScreen snapshot={snapshot} user={user} />);
        expect(screen.queryByText('Setup')).toBeNull();
    });

    it('shows zoom, fit, and layer controls and an empty alerts state', () =>
    {
        render(<MapScreen snapshot={snapshot} user={user} />);
        expect(screen.getByLabelText('Zoom in')).toBeTruthy();
        expect(screen.getByLabelText('Zoom out')).toBeTruthy();
        expect(screen.getByLabelText('Fit beach')).toBeTruthy();
        expect(screen.getByText('No alerts yet.')).toBeTruthy();
    });

    it('lets the alerts feed collapse so the map is usable on phones', () =>
    {
        render(<MapScreen snapshot={snapshot} user={user} />);
        fireEvent.click(screen.getByLabelText('Collapse alerts'));
        expect(screen.queryByText('No alerts yet.')).toBeNull();
    });

    it('plays footage for a camera that has a video', () =>
    {
        const withVideo: MapSnapshot = {
            ...snapshot,
            cameras: [{ ...snapshot.cameras[0], video: { id: 'v1', source: 'SIMULATION', durationS: 60, hasMotion: true, simRunId: 'R1' } }],
        };
        render(<MapScreen snapshot={withVideo} user={user} />);
        fireEvent.click(screen.getByText('cam B1'));
        expect(screen.getByTestId('camera-video').getAttribute('src')).toBe('/api/media/video/v1?variant=raw');
        expect(screen.queryByText('No footage yet')).toBeNull();
        expect(screen.getByText('Simulated footage · pins placed approximately')).toBeTruthy();
        expect(screen.queryByText(/Calibrate this camera/)).toBeNull();
    });

    const simAlert = (id: string, runId: string, cameraCode: string, startT: number): AlertView => ({
        id, kind: 'DIGGING', message: `Digging activity detected; nesting unresolved.`, status: 'NEW', zoneCode: 'B', cameraCode,
        position: [0.5, 0.5], radiusM: 0.9, score: 1, createdAt: '2026-10-09T00:00:00.000Z', videoId: `video-${runId}`,
        simRunId: runId, startT, endT: startT + 4, evidenceTier: 'TWO_CAMERA', simulated: true,
        site: { protection: 'unprotected', nesting: 'unresolved', outcome: 'open', active: true, personActed: false, patrolVisited: false, detectedAt: null, archivedAt: null },
    });
    const twoRuns: MapSnapshot = {
        ...snapshot,
        cameras: [
            { ...snapshot.cameras[0], video: { id: 'v1', source: 'SIMULATION', durationS: 60, hasMotion: true, simRunId: 'R1' } },
            { ...snapshot.cameras[0], id: 'c2', code: 'C1', zoneCode: 'C', video: { id: 'v2', source: 'SIMULATION', durationS: 60, hasMotion: true, simRunId: 'R2' } },
        ],
        alerts: [simAlert('a1', 'R1', 'B1', 8), simAlert('a2', 'R2', 'C1', 3)],
    };

    it('seeks the alert camera feed to the alert start and marks the alert active', () =>
    {
        render(<MapScreen snapshot={twoRuns} user={user} />);
        fireEvent.click(screen.getAllByText('Digging activity detected; nesting unresolved.')[0]);
        const element = screen.getByTestId('camera-video') as HTMLVideoElement;
        expect(element.getAttribute('src')).toBe('/api/media/video/v1?variant=raw');
        fireEvent(element, new Event('loadedmetadata'));
        expect(element.currentTime).toBeCloseTo(8);
        expect(screen.getByTestId('visible-pins').textContent).toBe('a1');
        const [first, second] = screen.getAllByRole('button', { name: /Digging activity detected/ });
        expect(first.getAttribute('aria-current')).toBe('true');
        expect(second.getAttribute('aria-current')).toBeNull();
    });

    it('never shows other runs\' pins when a camera opens', () =>
    {
        render(<MapScreen snapshot={twoRuns} user={user} />);
        expect(screen.getByTestId('visible-pins').textContent).toBe('a1,a2');
        fireEvent.click(screen.getByText('cam C1'));
        expect(screen.getByTestId('visible-pins').textContent).toBe('');
        fireEvent.click(screen.getByLabelText('Close camera panel'));
        expect(screen.getByTestId('visible-pins').textContent).toBe('a1,a2');
    });

    it('opens the site drawer from a card and still seeks the feed', async () =>
    {
        render(<MapScreen snapshot={twoRuns} user={user} />);
        fireEvent.click(screen.getAllByText('Digging activity detected; nesting unresolved.')[0]);
        expect(screen.getByRole('dialog', { name: /Site in zone B/ })).toBeTruthy();
        expect(await screen.findByText('Arrived')).toBeTruthy();
        expect(fetchMock).toHaveBeenCalledWith('/api/sites/a1', expect.anything());
        expect(screen.getByTestId('camera-video').getAttribute('src')).toBe('/api/media/video/v1?variant=raw');
        fireEvent.click(screen.getByRole('button', { name: 'Close site' }));
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('keeps the drawer open when its site drops out of the snapshot', async () =>
    {
        render(<MapScreen snapshot={twoRuns} user={user} />);
        fireEvent.click(screen.getAllByText('Digging activity detected; nesting unresolved.')[0]);
        expect(screen.getByRole('dialog', { name: /Site in zone B/ })).toBeTruthy();
        nextSnapshot = { ...twoRuns, alerts: [twoRuns.alerts[1]] };
        act(() => FakeEventSource.instances[0].onmessage?.(new MessageEvent('message', { data: '{"type":"snapshot"}' })));
        await waitFor(() => expect(screen.getByRole('radio', { name: 'Active (1)' })).toBeTruthy(), { timeout: 2000 });
        expect(screen.getByRole('dialog', { name: /Site in zone B/ })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Close site' }));
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('hides the legend while a camera panel or a site drawer is open', () =>
    {
        render(<MapScreen snapshot={twoRuns} user={user} />);
        expect(screen.getByRole('button', { name: /legend/i })).toBeTruthy();
        fireEvent.click(screen.getByText('cam B1'));
        expect(screen.queryByRole('button', { name: /legend/i })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Close camera panel' }));
        expect(screen.getByRole('button', { name: /legend/i })).toBeTruthy();
        fireEvent.click(screen.getAllByText('Digging activity detected; nesting unresolved.')[0]);
        fireEvent.click(screen.getByRole('button', { name: 'Close camera panel' }));
        expect(screen.getByRole('dialog', { name: /Site in zone B/ })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /legend/i })).toBeNull();
    });

    it('re-fetches the snapshot when the stream reports a change', async () =>
    {
        render(<MapScreen snapshot={snapshot} user={user} />);
        expect(screen.getByRole('radio', { name: 'Active (0)' })).toBeTruthy();
        nextSnapshot = twoRuns;
        act(() => FakeEventSource.instances[0].onmessage?.(new MessageEvent('message', { data: '{"type":"snapshot"}' })));
        await waitFor(() => expect(screen.getByRole('radio', { name: 'Active (2)' })).toBeTruthy(), { timeout: 2000 });
        expect(fetchMock).toHaveBeenCalledWith('/api/snapshot', expect.anything());
    });

    describe('camera editing', () =>
    {
        const admin = { ...user, role: 'ADMIN' as const };
        const withCustom: MapSnapshot = { ...snapshot, zones: [...snapshot.zones, { id: 'ze', code: 'E', name: 'Zone E', activityLevel: 'LOW', ring: [[0, 0], [1, 0], [1, 1], [0, 0]], custom: true }] };

        it('offers Edit cameras only to admins', () =>
        {
            render(<MapScreen snapshot={snapshot} user={user} />);
            expect(screen.queryByRole('button', { name: 'Edit cameras' })).toBeNull();
            cleanup();
            render(<MapScreen snapshot={snapshot} user={{ ...user, role: 'VOLUNTEER' }} />);
            expect(screen.queryByRole('button', { name: 'Edit cameras' })).toBeNull();
            cleanup();
            render(<MapScreen snapshot={snapshot} user={admin} />);
            expect(screen.getByRole('button', { name: 'Edit cameras' })).toBeTruthy();
        });

        it('shows the banner in edit mode and leaves on Esc', () =>
        {
            render(<MapScreen snapshot={snapshot} user={admin} />);
            fireEvent.click(screen.getByRole('button', { name: 'Edit cameras' }));
            expect(screen.getByText('Click the dune line to add a camera pair · Esc to finish')).toBeTruthy();
            expect(screen.getByTestId('editing').textContent).toBe('true');
            fireEvent.keyDown(window, { key: 'Escape' });
            expect(screen.queryByText(/Click the dune line/)).toBeNull();
            expect(screen.getByTestId('editing').textContent).toBe('false');
        });

        it('ignores map clicks outside edit mode', () =>
        {
            render(<MapScreen snapshot={snapshot} user={admin} />);
            fireEvent.click(screen.getByText('map click'));
            expect(addCameraPair).not.toHaveBeenCalled();
        });

        it('adds a camera pair where the map is clicked and confirms it', async () =>
        {
            addCameraPair.mockResolvedValue({ ok: true, code: 'E' });
            render(<MapScreen snapshot={snapshot} user={admin} />);
            fireEvent.click(screen.getByRole('button', { name: 'Edit cameras' }));
            fireEvent.click(screen.getByText('map click'));
            expect(addCameraPair).toHaveBeenCalledWith([-97.05, 27.82]);
            expect(await screen.findByText('Zone E added')).toBeTruthy();
        });

        it('places one pair for a double click while the first is still saving', async () =>
        {
            addCameraPair.mockResolvedValue({ ok: true, code: 'E' });
            render(<MapScreen snapshot={snapshot} user={admin} />);
            fireEvent.click(screen.getByRole('button', { name: 'Edit cameras' }));
            fireEvent.click(screen.getByText('map double click'));
            expect(addCameraPair).toHaveBeenCalledTimes(1);
            expect(await screen.findByText('Zone E added')).toBeTruthy();
            fireEvent.click(screen.getByText('map click'));
            expect(addCameraPair).toHaveBeenCalledTimes(2);
        });

        it('shows why a placement was refused', async () =>
        {
            addCameraPair.mockResolvedValue({ ok: false, error: 'Click closer to the beach' });
            render(<MapScreen snapshot={snapshot} user={admin} />);
            fireEvent.click(screen.getByRole('button', { name: 'Edit cameras' }));
            fireEvent.click(screen.getByText('map click'));
            expect(await screen.findByText('Click closer to the beach')).toBeTruthy();
        });

        it('asks before removing an added zone, then removes it', async () =>
        {
            deleteZone.mockResolvedValue({ ok: true, code: 'E' });
            render(<MapScreen snapshot={withCustom} user={admin} />);
            expect(screen.queryByText('remove B')).toBeNull();
            fireEvent.click(screen.getByRole('button', { name: 'Edit cameras' }));
            fireEvent.click(screen.getByText('remove E'));
            expect(deleteZone).not.toHaveBeenCalled();
            const dialog = screen.getByRole('alertdialog', { name: /Remove Zone E/ });
            // A map click while the question is open does not place a pair.
            fireEvent.click(screen.getByText('map click'));
            expect(addCameraPair).not.toHaveBeenCalled();
            fireEvent.click(within(dialog).getByRole('button', { name: 'Remove zone' }));
            expect(deleteZone).toHaveBeenCalledWith('E');
            expect(await screen.findByText('Zone E removed')).toBeTruthy();
        });

        it('keeps the zone when the removal is cancelled or refused', async () =>
        {
            deleteZone.mockResolvedValue({ ok: false, error: 'This zone has footage or alerts; it cannot be removed.' });
            render(<MapScreen snapshot={withCustom} user={admin} />);
            fireEvent.click(screen.getByRole('button', { name: 'Edit cameras' }));
            fireEvent.click(screen.getByText('remove E'));
            fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
            expect(screen.queryByRole('alertdialog')).toBeNull();
            fireEvent.click(screen.getByText('remove E'));
            fireEvent.click(screen.getByRole('button', { name: 'Remove zone' }));
            expect(await screen.findByText('This zone has footage or alerts; it cannot be removed.')).toBeTruthy();
        });
    });
});
