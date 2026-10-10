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
        MapView: React.forwardRef(function MapViewStub(props: { snapshot: MapSnapshot; onSelectCamera: (id: string) => void; playback: Playback | null; editing?: boolean; onMapClick?: (at: [number, number]) => void; onMoveCamera?: (code: string, to: [number, number]) => Promise<boolean>; onMoveZone?: (code: string, from: [number, number], to: [number, number]) => Promise<boolean>; onDeleteZone?: (code: string) => Promise<boolean> }, ref)
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
                    <button onClick={() => { void props.onMoveCamera?.('B1', [-97.06, 27.81]).then(saved => { document.body.dataset.moveSaved = String(saved); }); }}>drag B1</button>
                    <button onClick={() => { void props.onMoveZone?.('E', [-97.05, 27.83], [-97.049, 27.831]).then(saved => { document.body.dataset.zoneSaved = String(saved); }); }}>drag zone E</button>
                    <button onClick={() => { void props.onDeleteZone?.('E'); }}>delete zone E</button>
                </div>
            );
        }),
    };
});
vi.mock('@/app/(app)/actions', () => ({ logoutAction: vi.fn() }));
const addCameraPair = vi.fn();
const updateCamera = vi.fn();
const moveZone = vi.fn();
const deleteZone = vi.fn();
vi.mock('@/app/(app)/camera-actions', () => ({
    addCameraPair: (...args: unknown[]) => addCameraPair(...args), updateCamera: (...args: unknown[]) => updateCamera(...args),
    moveZone: (...args: unknown[]) => moveZone(...args), deleteZone: (...args: unknown[]) => deleteZone(...args),
}));
vi.mock('@/features/sites/SiteCloseUp', () => ({ SiteCloseUp: () => <div data-testid="close-up" /> }));
// Live device feeds: the status poll and the WebRTC player are replaced; tests set `liveStatus`.
let liveStatus: Record<string, { deviceId: string; name: string; online: boolean }> = {};
vi.mock('@/features/live/useLiveStatus', () => ({ useLiveStatus: () => liveStatus }));
vi.mock('@/features/live/LiveVideo', () => ({ LiveVideo: ({ deviceId }: { deviceId: string }) => <div data-testid="live-player">live {deviceId}</div> }));
vi.mock('@/app/(app)/live-actions', () => ({ assignCameraSource: vi.fn() }));

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
    cameras: [{ id: 'c1', code: 'B1', zoneCode: 'B', position: [0.5, 0.5], headingDeg: 203, fovDeg: 44, rangeM: 350, status: 'ONLINE', calibrated: false, video: null, liveDeviceId: null }],
    alerts: [],
    camerasOnline: 1, camerasTotal: 1, inactiveCount: 0, outcomes: { saved: 0, notSaved: 0, pending: 0 }, fadeMinutes: 5,
    tracks: [], dangerCount: 0, dangerTotal: 0,
};
const user = { id: 'u', email: 'v@x.y', name: 'V', role: 'VIEWER' as const };

beforeEach(() =>
{
    FakeEventSource.instances = [];
    liveStatus = {};
    fetchMock.mockClear();
    addCameraPair.mockReset();
    updateCamera.mockReset();
    moveZone.mockReset();
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

    it('hides Settings link for viewers', () =>
    {
        render(<MapScreen snapshot={snapshot} user={user} />);
        expect(screen.queryByText('Settings')).toBeNull();
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
            cameras: [{ ...snapshot.cameras[0], calibrated: true, video: { id: 'v1', source: 'SIMULATION', durationS: 60, hasMotion: true, simRunId: 'R1' } }],
        };
        render(<MapScreen snapshot={withVideo} user={user} />);
        fireEvent.click(screen.getByText('cam B1'));
        expect(screen.getByTestId('camera-video').getAttribute('src')).toBe('/api/media/video/v1?variant=raw');
        expect(screen.queryByText('No footage yet')).toBeNull();
        expect(screen.queryByText(/Simulated/)).toBeNull();
        expect(screen.queryByText(/Calibrate this camera/)).toBeNull();
    });

    const simAlert = (id: string, runId: string, cameraCode: string, startT: number): AlertView => ({
        id, kind: 'DIGGING', message: `Digging activity detected; nesting unresolved.`, status: 'NEW', zoneCode: 'B', cameraCode,
        position: [0.5, 0.5], radiusM: 0.9, score: 1, createdAt: '2026-10-09T00:00:00.000Z', videoId: `video-${runId}`,
        simRunId: runId, startT, endT: startT + 4, evidenceTier: 'TWO_CAMERA', simulated: true, level: 0, siteId: null, colorIndex: null,
        site: { protection: 'unprotected', nesting: 'unresolved', outcome: 'open', active: true, personActed: false, patrolVisited: false, detectedAt: null, archivedAt: null, danger: 'none', dangerDeadline: null, secured: null },
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
            expect(screen.getByText('Click a zone to add a pair · open beach starts a new zone · drag cameras or new zones')).toBeTruthy();
            expect(screen.getByTestId('editing').textContent).toBe('true');
            fireEvent.keyDown(window, { key: 'Escape' });
            expect(screen.queryByText(/open beach starts a new zone/)).toBeNull();
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
            addCameraPair.mockResolvedValue({ ok: true, codes: ['B3', 'B4'], zoneCode: 'B', newZone: false });
            render(<MapScreen snapshot={snapshot} user={admin} />);
            fireEvent.click(screen.getByRole('button', { name: 'Edit cameras' }));
            fireEvent.click(screen.getByText('map click'));
            expect(addCameraPair).toHaveBeenCalledWith([-97.05, 27.82]);
            expect(await screen.findByText('B3 · B4 added to Zone B')).toBeTruthy();
        });

        it('announces a new zone made from an open-beach click', async () =>
        {
            addCameraPair.mockResolvedValue({ ok: true, codes: ['E1', 'E2'], zoneCode: 'E', newZone: true });
            render(<MapScreen snapshot={snapshot} user={admin} />);
            fireEvent.click(screen.getByRole('button', { name: 'Edit cameras' }));
            fireEvent.click(screen.getByText('map click'));
            expect(await screen.findByText('New Zone E · E1 · E2 facing the sea')).toBeTruthy();
        });

        it('moves and deletes map-made zones only in edit mode', async () =>
        {
            moveZone.mockResolvedValue({ ok: true, code: 'E' });
            deleteZone.mockResolvedValue({ ok: true, code: 'E' });
            render(<MapScreen snapshot={snapshot} user={admin} />);
            fireEvent.click(screen.getByText('drag zone E'));
            fireEvent.click(screen.getByText('delete zone E'));
            expect(moveZone).not.toHaveBeenCalled();
            expect(deleteZone).not.toHaveBeenCalled();
            fireEvent.click(screen.getByRole('button', { name: 'Edit cameras' }));
            fireEvent.click(screen.getByText('drag zone E'));
            expect(moveZone).toHaveBeenCalledWith('E', [-97.05, 27.83], [-97.049, 27.831]);
            expect(await screen.findByText('Zone E moved with its cameras')).toBeTruthy();
            await waitFor(() => expect(document.body.dataset.zoneSaved).toBe('true'));
            fireEvent.click(screen.getByText('delete zone E'));
            expect(deleteZone).toHaveBeenCalledWith('E');
            expect(await screen.findByText('Zone E and its cameras removed')).toBeTruthy();
        });

        it('puts a zone back when its move is refused', async () =>
        {
            moveZone.mockResolvedValue({ ok: false, error: 'Too close to Zone D — click inside it to join, or further away for a new zone' });
            render(<MapScreen snapshot={snapshot} user={admin} />);
            fireEvent.click(screen.getByRole('button', { name: 'Edit cameras' }));
            fireEvent.click(screen.getByText('drag zone E'));
            expect(await screen.findByText(/Too close to Zone D/)).toBeTruthy();
            await waitFor(() => expect(document.body.dataset.zoneSaved).toBe('false'));
        });

        it('places one pair for a double click while the first is still saving', async () =>
        {
            addCameraPair.mockResolvedValue({ ok: true, codes: ['B3', 'B4'], zoneCode: 'B' });
            render(<MapScreen snapshot={snapshot} user={admin} />);
            fireEvent.click(screen.getByRole('button', { name: 'Edit cameras' }));
            fireEvent.click(screen.getByText('map double click'));
            expect(addCameraPair).toHaveBeenCalledTimes(1);
            expect(await screen.findByText('B3 · B4 added to Zone B')).toBeTruthy();
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

        it('moves a dragged camera and confirms it', async () =>
        {
            updateCamera.mockResolvedValue({ ok: true, code: 'B1' });
            render(<MapScreen snapshot={snapshot} user={admin} />);
            fireEvent.click(screen.getByText('drag B1'));
            expect(updateCamera).not.toHaveBeenCalled();
            fireEvent.click(screen.getByRole('button', { name: 'Edit cameras' }));
            fireEvent.click(screen.getByText('drag B1'));
            expect(updateCamera).toHaveBeenCalledWith('B1', { lng: -97.06, lat: 27.81 });
            expect(await screen.findByText('B1 moved')).toBeTruthy();
            await waitFor(() => expect(document.body.dataset.moveSaved).toBe('true'));
        });

        it('shows why a move was refused', async () =>
        {
            updateCamera.mockResolvedValue({ ok: false, error: 'Latitude must be between -90 and 90.' });
            render(<MapScreen snapshot={snapshot} user={admin} />);
            fireEvent.click(screen.getByRole('button', { name: 'Edit cameras' }));
            fireEvent.click(screen.getByText('drag B1'));
            expect(await screen.findByText('Latitude must be between -90 and 90.')).toBeTruthy();
            // MapView puts the marker back when the move resolves false.
            await waitFor(() => expect(document.body.dataset.moveSaved).toBe('false'));
        });
    });

    describe('trails and dangers', () =>
    {
        const site = { id: 's1', kind: 'DIGGING', message: 'Digging activity detected; nesting unresolved.', status: 'NEW', zoneCode: 'B', cameraCode: 'B1', position: [0.5, 0.5], radiusM: 0.9, score: 1, createdAt: '2026-10-09T00:00:00.000Z', videoId: 'v', simRunId: 'R', startT: 8, endT: 20, evidenceTier: 'TWO_CAMERA', simulated: true, level: 0, siteId: null, colorIndex: 0,
            site: { protection: 'unprotected', nesting: 'unresolved', outcome: 'open', active: true, personActed: false, patrolVisited: false, detectedAt: null, archivedAt: null, danger: 'active', dangerDeadline: null, secured: null } } as AlertView;
        const danger = { ...site, id: 'd1', kind: 'DANGER', message: 'Danger · person near an active nest site — immediate action', level: 1, siteId: 's1', colorIndex: null, startT: 14, endT: 15 } as AlertView;
        const withDanger: MapSnapshot = { ...snapshot, alerts: [site, danger], dangerCount: 1, dangerTotal: 1 };

        it('offers a Trails layer, on by default', () =>
        {
            render(<MapScreen snapshot={snapshot} user={user} />);
            fireEvent.click(screen.getByRole('button', { name: 'Map layers' }));
            expect((screen.getByRole('checkbox', { name: 'Trails' }) as HTMLInputElement).checked).toBe(true);
        });

        it('opens the first danger from the top-bar chip', async () =>
        {
            render(<MapScreen snapshot={withDanger} user={user} />);
            fireEvent.click(screen.getByRole('link', { name: /1 danger/ }));
            expect(await screen.findByRole('dialog', { name: 'Danger in zone B' })).toBeTruthy();
        });

        it('opens the danger named in the address (?alert=)', async () =>
        {
            window.history.replaceState(null, '', '/?alert=d1');
            try
            {
                render(<MapScreen snapshot={withDanger} user={user} />);
                expect(await screen.findByRole('dialog', { name: 'Danger in zone B' })).toBeTruthy();
            }
            finally
            {
                window.history.replaceState(null, '', '/');
            }
        });
    });

    it('plays an online live device instead of the loop and shows every pin', () =>
    {
        liveStatus = { B1: { deviceId: 'd1', name: 'Pixel', online: true } };
        const live: MapSnapshot = { ...twoRuns, cameras: [{ ...twoRuns.cameras[0], liveDeviceId: 'd1' }, twoRuns.cameras[1]] };
        render(<MapScreen snapshot={live} user={user} />);
        fireEvent.click(screen.getByText('cam B1'));
        expect(screen.getByTestId('live-player').textContent).toBe('live d1');
        expect(screen.getByText('LIVE · Pixel')).toBeTruthy();
        expect(screen.queryByTestId('camera-video')).toBeNull();
        // A live feed has no clock, so no pin is gated.
        expect(screen.getByTestId('visible-pins').textContent).toBe('a1,a2');
        // Viewers get no Source picker.
        expect(screen.queryByLabelText('Source')).toBeNull();
    });

    it('falls back to the loop and names the device while it is offline', () =>
    {
        liveStatus = { B1: { deviceId: 'd1', name: 'Pixel', online: false } };
        render(<MapScreen snapshot={twoRuns} user={user} />);
        fireEvent.click(screen.getByText('cam B1'));
        expect(screen.getByTestId('camera-video').getAttribute('src')).toBe('/api/media/video/v1?variant=raw');
        expect(screen.getByText('Pixel offline · showing simulation')).toBeTruthy();
        expect(screen.queryByTestId('live-player')).toBeNull();
    });

    it('re-gates pins when the device of the open camera stops streaming', () =>
    {
        liveStatus = { B1: { deviceId: 'd1', name: 'Pixel', online: true } };
        const { rerender } = render(<MapScreen snapshot={twoRuns} user={user} />);
        fireEvent.click(screen.getByText('cam B1'));
        expect(screen.getByTestId('visible-pins').textContent).toBe('a1,a2');
        liveStatus = { B1: { deviceId: 'd1', name: 'Pixel', online: false } };
        rerender(<MapScreen snapshot={{ ...twoRuns }} user={user} />);
        expect(screen.getByTestId('camera-video')).toBeTruthy();
        expect(screen.getByTestId('visible-pins').textContent).toBe('');
    });

    it('gives admins a Source picker on the camera panel', () =>
    {
        render(<MapScreen snapshot={twoRuns} user={{ ...user, role: 'ADMIN' }} />);
        fireEvent.click(screen.getByText('cam B1'));
        expect((screen.getByLabelText('Source') as HTMLSelectElement).value).toBe('');
        expect(screen.getByText('No devices streaming. Use Connect device in the top bar.')).toBeTruthy();
    });
});
