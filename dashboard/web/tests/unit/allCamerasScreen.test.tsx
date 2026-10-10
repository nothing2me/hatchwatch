import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CameraView, MapSnapshot } from '@/lib/types';
import type { SessionUser } from '@/lib/auth/session';

const frame = vi.hoisted(() => ({ url: null as string | null }));
vi.mock('@/features/phones/useLiveFrame', () => ({ useLiveFrame: () => ({ url: frame.url, state: frame.url ? 'live' : 'loading' }) }));
vi.mock('@/app/(app)/actions', () => ({ logoutAction: vi.fn() }));
const removePhone = vi.fn();
const addBoardCamera = vi.fn();
const rotateDeviceToken = vi.fn();
vi.mock('@/app/(app)/cameras/actions', () => ({
    removePhone: (...args: unknown[]) => removePhone(...args),
    addBoardCamera: (...args: unknown[]) => addBoardCamera(...args),
    rotateDeviceToken: (...args: unknown[]) => rotateDeviceToken(...args),
}));
const { AllCamerasScreen } = await import('@/features/cameras/AllCamerasScreen');
const { MotionBox } = await import('@/features/phones/DeviceTile');
const { RecordingsPanel, formatStart } = await import('@/features/phones/RecordingsPanel');

const admin = { id: 'a', email: 'a@x.y', name: 'Ad', role: 'ADMIN' as const };
const viewer = { ...admin, id: 'v', role: 'VIEWER' as const };
const phone = { id: 'ck1', name: 'Dune phone', kind: 'PHONE' as const, ownerName: 'Vo', cameraCode: 'A1', online: true, recording: true, lastSeenAt: '2026-10-10T20:00:00.000Z', motion: null, detections: null };
const board = { ...phone, id: 'ckb', name: 'Dune board', kind: 'BOARD' as const, ownerName: 'Ad', cameraCode: null, recording: false, motion: { percent: 4.2, active: true, box: [96, 40, 64, 72] as [number, number, number, number], at: '2026-10-10T20:00:00.000Z' } };
const linkedBoard = { ...board, id: 'cb1', name: 'Shore board', cameraCode: 'B1', online: false, motion: null };
const token = 'A'.repeat(43);
const issuedResult = { ok: true, deviceId: 'ckb', name: 'Dune board', token, dashboardUrl: 'https://10.47.138.152:3443', secrets: `#define DASHBOARD_URL "https://10.47.138.152:3443"\n#define DEVICE_ID "ckb"\n#define DEVICE_TOKEN "${token}"\n` };

function camera(code: string, zoneCode: string, extra: Partial<CameraView>): CameraView
{
    return { id: `c-${code}`, code, zoneCode, position: [0, 0], headingDeg: 90, fovDeg: 44, rangeM: 350, status: 'ONLINE', calibrated: false, video: null, liveDevice: null, ...extra };
}
const clip = (id: string) => ({ id, source: 'SIMULATION' as const, durationS: 40, hasMotion: false, simRunId: 'A-demo-1' });
// Zone A: A1 linked to the phone ck1, A2 unlinked with a simulated clip. Zone B: B1 linked to the board cb1.
const snapshot: MapSnapshot = {
    zones: [
        { id: 'za', code: 'A', name: 'North', activityLevel: 'LOW', ring: [] },
        { id: 'zb', code: 'B', name: 'Holiday', activityLevel: 'HIGH', ring: [] },
    ],
    cameras: [
        camera('A1', 'A', { video: clip('v1'), liveDevice: { id: 'ck1', name: 'Dune phone' } }),
        camera('A2', 'A', { video: clip('v2') }),
        camera('B1', 'B', { video: clip('v3'), liveDevice: { id: 'cb1', name: 'Shore board', kind: 'BOARD' } }),
    ],
    alerts: [], camerasOnline: 3, camerasTotal: 3, inactiveCount: 0, tracks: [], dangerCount: 0, dangerTotal: 0,
    outcomes: { saved: 0, notSaved: 0, pending: 0 }, fadeMinutes: 30,
} as unknown as MapSnapshot;

function show(user: SessionUser, connect: { url: string | null; qrSvg: string | null } | null = null)
{
    return render(<AllCamerasScreen user={user} initialSnapshot={snapshot} connect={connect} />);
}

function stubFetch(devices: unknown[])
{
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.startsWith('/api/live/devices')
        ? Response.json({ devices })
        : Response.json({ enabled: true, convertsToMp4: true, recordings: [] })));
}
const zone = (code: string) => screen.getByRole('region', { name: `Zone ${code}` });
const card = (code: string) => screen.getByRole('article', { name: `Camera ${code}` });
const devicesSection = () => screen.getByRole('region', { name: 'Devices' });
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); frame.url = null; });

describe('AllCamerasScreen devices', () =>
{
    it('explains how to connect a phone when no unlinked one is sending', async () =>
    {
        stubFetch([]);
        show(viewer);
        expect(await screen.findByText('No unlinked phones or boards are sending.')).toBeTruthy();
        expect(screen.getByText(/Ask an admin for the Connect phone QR code/)).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Connect phone' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Recordings' })).toBeNull();
    });

    it('shows a tile per online phone with owner, camera, REC and actions', async () =>
    {
        stubFetch([phone, { ...phone, id: 'ck2', name: 'Silent', cameraCode: null, online: false, recording: false }]);
        show(viewer);
        const tile = await screen.findByRole('article', { name: 'Dune phone' });
        expect(screen.queryByText('Silent')).toBeNull();
        expect(within(tile).getByText('by Vo')).toBeTruthy();
        expect(within(tile).getByText('Camera A1')).toBeTruthy();
        expect(within(tile).getByText('REC')).toBeTruthy();
        expect(within(tile).getByRole('link', { name: 'Motion view' }).getAttribute('href')).toBe('/cameras/motion?device=ck1');
        fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
        expect(screen.getByRole('dialog', { name: 'Dune phone' })).toBeTruthy();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('gives admins Connect phone with the QR and the Recordings list', async () =>
    {
        stubFetch([]);
        show(admin, { url: 'https://192.168.1.20:3443/cam', qrSvg: '<svg data-testid="qr"></svg>' });
        fireEvent.click(screen.getByRole('button', { name: 'Connect phone' }));
        expect(screen.getByText('https://192.168.1.20:3443/cam')).toBeTruthy();
        expect(screen.getByTestId('qr')).toBeTruthy();
        expect(await screen.findByRole('heading', { name: 'Recordings' })).toBeTruthy();
        expect(await screen.findByText('No recordings yet. Phones are recorded while they send.')).toBeTruthy();
    });

    it('lists every phone for admins and removes one after an inline confirm', async () =>
    {
        stubFetch([{ ...phone, online: false, recording: false }]);
        removePhone.mockResolvedValueOnce({ ok: false, error: 'That phone was already removed.' }).mockResolvedValueOnce({ ok: true });
        show(admin);
        const row = await screen.findByRole('listitem', { name: 'Dune phone' });
        expect(within(row).getByText(/last seen/)).toBeTruthy();
        expect(within(row).getByText('Camera A1')).toBeTruthy();
        fireEvent.click(within(row).getByRole('button', { name: 'Remove Dune phone' }));
        expect(within(row).getByText('Remove Dune phone? Its camera returns to the simulation loop. The person can start again with a new phone name; to block a person, disable their account on the Users page.')).toBeTruthy();
        fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
        expect(await within(row).findByText('That phone was already removed.')).toBeTruthy();
        fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
        await waitFor(() => expect(removePhone).toHaveBeenCalledTimes(2));
        expect(removePhone).toHaveBeenCalledWith('ck1');
        await waitFor(() => expect(within(row).queryByText(/Its camera returns/)).toBeNull());
        expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith('/api/live/devices')).length).toBeGreaterThanOrEqual(2);
    });

    it('hides the devices list and admin controls from viewers', async () =>
    {
        stubFetch([phone, board]);
        show(viewer);
        expect(await screen.findByRole('article', { name: 'Dune phone' })).toBeTruthy();
        expect(within(devicesSection()).getByRole('article', { name: 'Dune board' })).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'All devices' })).toBeNull();
        expect(screen.queryByRole('listitem')).toBeNull();
        expect(screen.queryByRole('button', { name: /Remove|Rotate token/ })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Add board camera' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Recordings' })).toBeNull();
    });
});

describe('camera boards', () =>
{
    it('shows the on-board motion badge and label on board tiles only', async () =>
    {
        stubFetch([board, { ...board, id: 'ckb2', name: 'Still board', motion: { ...board.motion, percent: 0.4, active: false, box: [0, 0, 0, 0] } }, phone]);
        show(viewer);
        const moving = await screen.findByRole('article', { name: 'Dune board' });
        expect(within(moving).getByText('Moving 4.2%')).toBeTruthy();
        expect(within(moving).getByText('Motion measured on the camera board')).toBeTruthy();
        expect(within(moving).getByText('Camera board · added by Ad')).toBeTruthy();
        expect(within(screen.getByRole('article', { name: 'Still board' })).getByText('Still')).toBeTruthy();
        const phoneTile = screen.getByRole('article', { name: 'Dune phone' });
        expect(within(phoneTile).queryByText(/Moving|Still/)).toBeNull();
        expect(within(phoneTile).queryByText('Motion measured on the camera board')).toBeNull();
    });

    it('draws the box in picture pixels with the picture\'s own letterboxing', () =>
    {
        const { container } = render(<MotionBox box={[96, 40, 64, 72]} width={320} height={240} />);
        const svg = container.querySelector('svg')!;
        expect(svg.getAttribute('viewBox')).toBe('0 0 320 240');
        expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
        const rect = svg.querySelector('rect')!;
        expect([rect.getAttribute('x'), rect.getAttribute('y'), rect.getAttribute('width'), rect.getAttribute('height')]).toEqual(['96', '40', '64', '72']);
    });

    it('draws the box on a moving board tile once the picture has loaded, and never on a still one', async () =>
    {
        frame.url = 'blob:frame';
        stubFetch([board, { ...board, id: 'ckb2', name: 'Still board', motion: { ...board.motion, percent: 0.4, active: false, box: [0, 0, 0, 0] } }]);
        show(viewer);
        const moving = await screen.findByRole('article', { name: 'Dune board' });
        const still = screen.getByRole('article', { name: 'Still board' });
        expect(moving.querySelector('svg[preserveAspectRatio]')).toBeNull();
        for (const tile of [moving, still])
        {
            const img = within(tile).getByRole('img', { name: /Live picture/ });
            Object.defineProperty(img, 'naturalWidth', { value: 320 });
            Object.defineProperty(img, 'naturalHeight', { value: 240 });
            fireEvent.load(img);
        }
        const svg = await waitFor(() => moving.querySelector('svg[viewBox="0 0 320 240"]')!);
        expect(svg).toBeTruthy();
        const rect = svg.querySelector('rect')!;
        expect([rect.getAttribute('x'), rect.getAttribute('y'), rect.getAttribute('width'), rect.getAttribute('height')]).toEqual(['96', '40', '64', '72']);
        expect(still.querySelector('svg[preserveAspectRatio]')).toBeNull();
    });

    it('adds a board and shows the token once', async () =>
    {
        stubFetch([]);
        addBoardCamera.mockResolvedValueOnce(issuedResult);
        show(admin, { url: null, qrSvg: null });
        fireEvent.click(await screen.findByRole('button', { name: 'Add board camera' }));
        const dialog = screen.getByRole('dialog', { name: 'Add board camera' });
        fireEvent.change(within(dialog).getByLabelText('Board name'), { target: { value: 'Dune board' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
        await waitFor(() => expect(addBoardCamera).toHaveBeenCalledWith('Dune board'));
        expect((await within(dialog).findByLabelText('Device token') as HTMLInputElement).value).toBe(token);
        expect((within(dialog).getByLabelText('Device id') as HTMLInputElement).value).toBe('ckb');
        expect(within(dialog).getByText(/shown only once/)).toBeTruthy();
        expect(within(dialog).getByLabelText('secrets.h lines').textContent).toContain(`#define DEVICE_TOKEN "${token}"`);
        expect(within(dialog).getByText(/Replace the DASHBOARD_URL, DEVICE_ID and DEVICE_TOKEN lines/)).toBeTruthy();
        expect(within(dialog).getByText('docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt')).toBeTruthy();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.body.textContent).not.toContain(token);
        fireEvent.click(screen.getByRole('button', { name: 'Add board camera' }));
        expect((screen.getByLabelText('Board name') as HTMLInputElement).value).toBe('');
    });

    it('shows an add error and keeps the form', async () =>
    {
        stubFetch([]);
        addBoardCamera.mockResolvedValueOnce({ ok: false, error: 'A device with that name already exists.' });
        show(admin);
        fireEvent.click(await screen.findByRole('button', { name: 'Add board camera' }));
        const dialog = screen.getByRole('dialog', { name: 'Add board camera' });
        fireEvent.change(within(dialog).getByLabelText('Board name'), { target: { value: 'Dune board' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
        expect((await within(dialog).findByRole('alert')).textContent).toBe('A device with that name already exists.');
        expect((within(dialog).getByLabelText('Board name') as HTMLInputElement).value).toBe('Dune board');
    });

    it('lists devices with their kind and rotates a board token after a confirm', async () =>
    {
        stubFetch([{ ...board, online: false }, { ...phone, online: false }]);
        rotateDeviceToken.mockResolvedValueOnce({ ...issuedResult, token: 'B'.repeat(43) });
        show(admin);
        expect(await screen.findByRole('heading', { name: 'Devices' })).toBeTruthy();
        const boardRow = await screen.findByRole('listitem', { name: 'Dune board' });
        const phoneRow = screen.getByRole('listitem', { name: 'Dune phone' });
        expect(within(boardRow).getByText('Camera board')).toBeTruthy();
        expect(within(phoneRow).getByText('Phone')).toBeTruthy();
        expect(within(phoneRow).queryByRole('button', { name: /Rotate token/ })).toBeNull();
        fireEvent.click(within(boardRow).getByRole('button', { name: 'Rotate token for Dune board' }));
        expect(within(boardRow).getByText(/stops sending until secrets.h has the new token/)).toBeTruthy();
        fireEvent.click(within(boardRow).getByRole('button', { name: 'Rotate' }));
        await waitFor(() => expect(rotateDeviceToken).toHaveBeenCalledWith('ckb'));
        const dialog = await screen.findByRole('dialog', { name: 'New token for Dune board' });
        expect((within(dialog).getByLabelText('Device token') as HTMLInputElement).value).toBe('B'.repeat(43));
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(document.body.textContent).not.toContain('B'.repeat(43));
    });

    it('uses the board wording when removing a board', async () =>
    {
        stubFetch([{ ...board, online: false }]);
        show(admin);
        const row = await screen.findByRole('listitem', { name: 'Dune board' });
        fireEvent.click(within(row).getByRole('button', { name: 'Remove Dune board' }));
        expect(within(row).getByText('Remove Dune board? Its camera returns to the simulation loop and the board\'s token stops working. Add it again to get a new token.')).toBeTruthy();
    });
});

describe('AllCamerasScreen detections', () =>
{
    const seen = { ...phone, detections: { at: 1, dark: false, width: 320, height: 240, objects: [{ track: 'P1', label: 'person' as const, score: 0.82, box: [1, 2, 3, 4] as [number, number, number, number] }], trails: [] } };

    it('draws the overlay and the counts under the tile, with the footer note', async () =>
    {
        frame.url = 'blob:1';
        stubFetch([seen]);
        show(viewer);
        expect(await screen.findByText('person 0.82')).toBeTruthy();
        expect(screen.getByText('People 1 · Possible turtles 0')).toBeTruthy();
        expect(screen.getByText('Detection is a viewing aid; it can miss people and mistake objects.')).toBeTruthy();
    });

    it('says Detection off when the worker sends nothing', async () =>
    {
        stubFetch([phone]);
        show(viewer);
        expect(await screen.findByText('Detection off')).toBeTruthy();
    });

    it('says Too dark to detect and draws nothing on a dark frame', async () =>
    {
        frame.url = 'blob:1';
        stubFetch([{ ...seen, detections: { ...seen.detections, dark: true, objects: [], trails: [] } }]);
        show(viewer);
        const tile = await screen.findByRole('article', { name: 'Dune phone' });
        expect(await within(tile).findByText('Too dark to detect')).toBeTruthy();
        expect(tile.querySelector('svg[preserveAspectRatio]')).toBeNull();
    });

    it('hides everything with the Detections toggle and remembers it', async () =>
    {
        frame.url = 'blob:1';
        stubFetch([seen]);
        const { unmount } = show(viewer);
        const toggle = await screen.findByRole('button', { name: 'Detections' });
        expect(toggle.getAttribute('aria-pressed')).toBe('true');
        await screen.findByText('person 0.82');
        fireEvent.click(toggle);
        expect(screen.queryByText('person 0.82')).toBeNull();
        expect(screen.queryByText('People 1 · Possible turtles 0')).toBeNull();
        expect(screen.queryByText('Detection is a viewing aid; it can miss people and mistake objects.')).toBeNull();
        expect(localStorage.getItem('nesttrace.detections')).toBe('off');
        unmount();
        show(viewer);
        expect((await screen.findByRole('button', { name: 'Detections' })).getAttribute('aria-pressed')).toBe('false');
    });

    it('greys a person outside a linked camera\'s watch area, in the tile and the expanded view, but never on an unlinked tile', async () =>
    {
        frame.url = 'blob:1';
        const outside: [number, number][] = [[0, 0], [0.4, 0], [0.4, 0.4], [0, 0.4]];
        const detections = { ...seen.detections, objects: [{ ...seen.detections.objects[0], box: [194, 104, 31, 86] as [number, number, number, number] }] };
        const spare = { ...phone, id: 'cx9', name: 'Spare phone', cameraCode: null, recording: false, detections };
        stubFetch([{ ...seen, detections }, spare]);
        render(<AllCamerasScreen user={viewer} initialSnapshot={{ ...snapshot, cameras: [{ ...snapshot.cameras[0], mask: outside }, ...snapshot.cameras.slice(1)] }} connect={null} />);
        const a1 = await waitFor(() => within(zone('A')).getByRole('article', { name: 'Dune phone' }));
        expect(await within(a1).findByText('person 0.82 · outside watch area')).toBeTruthy();
        const unlinked = await within(devicesSection()).findByRole('article', { name: 'Spare phone' });
        expect(within(unlinked).getByText('person 0.82')).toBeTruthy();
        expect(within(unlinked).queryByText(/outside watch area/)).toBeNull();
        fireEvent.click(within(a1).getByRole('button', { name: 'Expand' }));
        expect(within(screen.getByRole('dialog', { name: 'Dune phone' })).getByText('person 0.82 · outside watch area')).toBeTruthy();
    });

    it('draws the overlay in the expanded view too', async () =>
    {
        frame.url = 'blob:1';
        stubFetch([seen]);
        show(viewer);
        await screen.findByText('person 0.82');
        fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
        expect(within(screen.getByRole('dialog', { name: 'Dune phone' })).getByText('person 0.82')).toBeTruthy();
    });
});

describe('AllCamerasScreen map cameras', () =>
{
    it('heads the page Cameras with the camera and device counts', async () =>
    {
        stubFetch([phone, board, linkedBoard]);
        show(viewer);
        expect(screen.getByRole('heading', { level: 1, name: 'Cameras' })).toBeTruthy();
        expect(await screen.findByText('3 of 3 map cameras online · 2 devices sending')).toBeTruthy();
    });

    it('shows a linked online phone live on its map camera, not the clip', async () =>
    {
        frame.url = 'blob:1';
        stubFetch([phone, linkedBoard]);
        show(viewer);
        const a1 = await waitFor(() => within(zone('A')).getByRole('article', { name: 'Camera A1' }));
        expect(await within(a1).findByText('LIVE')).toBeTruthy();
        expect(within(a1).getByRole('img', { name: 'Live picture from Dune phone' })).toBeTruthy();
        expect(within(a1).queryByTestId('camera-video')).toBeNull();
        expect(within(a1).queryByTestId('device-offline')).toBeNull();
    });

    it('says Board offline over the recorded clip when the linked board is offline', async () =>
    {
        stubFetch([phone, linkedBoard]);
        show(viewer);
        const b1 = card('B1');
        const badge = await within(b1).findByTestId('device-offline');
        expect(badge.textContent).toContain('Board offline');
        expect(within(b1).getByTestId('camera-video')).toBeTruthy();
        expect(within(b1).queryByText('LIVE')).toBeNull();
    });

    it('says Phone offline over the clip, or on the placeholder when there is no clip', async () =>
    {
        stubFetch([{ ...phone, online: false }]);
        render(<AllCamerasScreen user={viewer} initialSnapshot={{ ...snapshot, cameras: [snapshot.cameras[0], { ...snapshot.cameras[1], video: null, liveDevice: { id: 'ck3', name: 'Gone phone' } }] }} connect={null} />);
        expect((await within(card('A1')).findByTestId('device-offline')).textContent).toContain('Phone offline');
        expect(within(card('A1')).getByTestId('camera-video')).toBeTruthy();
        expect(within(card('A2')).getByTestId('device-offline').textContent).toContain('Phone offline');
        expect(within(card('A2')).queryByTestId('camera-video')).toBeNull();
    });

    it('shows an unlinked camera\'s recorded clip with the Simulated badge', async () =>
    {
        stubFetch([phone]);
        show(viewer);
        await screen.findByRole('article', { name: 'Dune phone' });
        const a2 = card('A2');
        expect(within(a2).getByTestId('camera-video')).toBeTruthy();
        expect(within(a2).getByText('Simulated')).toBeTruthy();
        expect(within(a2).queryByTestId('device-offline')).toBeNull();
    });

    it('lists an unlinked online phone under Devices and not in a zone', async () =>
    {
        frame.url = 'blob:1';
        stubFetch([phone, { ...phone, id: 'cx9', name: 'Spare phone', cameraCode: null, recording: false }]);
        show(viewer);
        expect(await within(devicesSection()).findByRole('article', { name: 'Spare phone' })).toBeTruthy();
        expect(within(zone('A')).queryByRole('article', { name: 'Spare phone' })).toBeNull();
        expect(within(zone('B')).queryByRole('article', { name: 'Spare phone' })).toBeNull();
        expect(within(devicesSection()).queryByRole('article', { name: 'Dune phone' })).toBeNull();
        expect(screen.queryByText('No unlinked phones or boards are sending.')).toBeNull();
    });

    it('shows no offline badge before the first devices response', () =>
    {
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
        show(viewer);
        expect(within(card('A1')).queryByTestId('device-offline')).toBeNull();
        expect(within(card('B1')).queryByTestId('device-offline')).toBeNull();
        expect(within(card('A1')).getByTestId('camera-video')).toBeTruthy();
    });

    it('shows the error line when the devices cannot be loaded', async () =>
    {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 500 })));
        show(viewer);
        expect((await screen.findByRole('alert')).textContent).toBe('Could not load phones.');
    });

    it('has one Cameras item in the top bar: Map, Cameras, Analytics, and Settings for admins', async () =>
    {
        stubFetch([]);
        const { unmount } = show(admin);
        const links = () => within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link');
        expect(links().map(link => link.textContent)).toEqual(['Map', 'Cameras', 'Analytics', 'Settings']);
        expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Cameras' }).getAttribute('aria-current')).toBe('page');
        await screen.findByRole('heading', { name: 'Recordings' });
        unmount();
        show(viewer);
        expect(links().map(link => link.textContent)).toEqual(['Map', 'Cameras', 'Analytics']);
    });
});

describe('RecordingsPanel', () =>
{
    const segment = { path: 'ck1/2026-10-10/200000.mp4', deviceId: 'ck1', deviceName: 'Dune phone', cameraCode: 'B1', startedAt: '2026-10-10T20:00:00.000Z', durationS: 252, sizeBytes: 13_002_342, playable: true };

    it('lists a segment with device, camera, start, length, size, Play and Download', async () =>
    {
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ enabled: true, convertsToMp4: true, recordings: [segment] })));
        render(<RecordingsPanel />);
        const row = (await screen.findByText('Dune phone')).closest('tr')!;
        expect(within(row).getByText('B1')).toBeTruthy();
        expect(within(row).getByText(formatStart(segment.startedAt))).toBeTruthy();
        expect(within(row).getByText('4 min 12 s')).toBeTruthy();
        expect(within(row).getByText('12.4 MB')).toBeTruthy();
        expect(within(row).getByRole('link', { name: 'Download' }).getAttribute('href')).toBe('/api/live/recordings/ck1/2026-10-10/200000.mp4?download=1');
        fireEvent.click(within(row).getByRole('button', { name: 'Play' }));
        expect(document.querySelector('video')?.getAttribute('src')).toBe('/api/live/recordings/ck1/2026-10-10/200000.mp4');
    });

    it('marks AVI segments download only and says when recording is off', async () =>
    {
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ enabled: true, convertsToMp4: false, recordings: [{ ...segment, path: 'ck1/2026-10-10/200000.avi', cameraCode: null, durationS: 38, sizeBytes: 849_000, playable: false }] })));
        const { unmount } = render(<RecordingsPanel />);
        const row = (await screen.findByText('Dune phone')).closest('tr')!;
        expect(within(row).getByText('—')).toBeTruthy();
        expect(within(row).getByText('38 s')).toBeTruthy();
        expect(within(row).getByText('830 KB')).toBeTruthy();
        expect(within(row).getByText('AVI · download only (install ffmpeg to convert)')).toBeTruthy();
        expect(within(row).queryByRole('button', { name: 'Play' })).toBeNull();
        unmount();
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ enabled: false, convertsToMp4: false, recordings: [] })));
        render(<RecordingsPanel />);
        expect(await screen.findByText('Recording is off (RECORDING=off).')).toBeTruthy();
    });
});
