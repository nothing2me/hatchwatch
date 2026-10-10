import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const frame = vi.hoisted(() => ({ url: null as string | null }));
vi.mock('@/features/phones/useLiveFrame', () => ({ useLiveFrame: () => ({ url: frame.url, state: frame.url ? 'live' : 'loading' }) }));
vi.mock('@/app/(app)/actions', () => ({ logoutAction: vi.fn() }));
const removePhone = vi.fn();
const addBoardCamera = vi.fn();
const rotateDeviceToken = vi.fn();
vi.mock('@/app/(app)/live/actions', () => ({
    removePhone: (...args: unknown[]) => removePhone(...args),
    addBoardCamera: (...args: unknown[]) => addBoardCamera(...args),
    rotateDeviceToken: (...args: unknown[]) => rotateDeviceToken(...args),
}));
const { LiveScreen, MotionBox } = await import('@/features/phones/LiveScreen');
const { RecordingsPanel, formatStart } = await import('@/features/phones/RecordingsPanel');

const bar = { camerasOnline: 1, camerasTotal: 2, activeSites: 0 };
const admin = { id: 'a', email: 'a@x.y', name: 'Ad', role: 'ADMIN' as const };
const viewer = { ...admin, id: 'v', role: 'VIEWER' as const };
const phone = { id: 'ck1', name: 'Dune phone', kind: 'PHONE' as const, ownerName: 'Vo', cameraCode: 'B1', online: true, recording: true, lastSeenAt: '2026-10-10T20:00:00.000Z', motion: null, detections: null };
const board = { ...phone, id: 'ckb', name: 'Dune board', kind: 'BOARD' as const, ownerName: 'Ad', recording: false, motion: { percent: 4.2, active: true, box: [96, 40, 64, 72] as [number, number, number, number], at: '2026-10-10T20:00:00.000Z' } };
const token = 'A'.repeat(43);
const issuedResult = { ok: true, deviceId: 'ckb', name: 'Dune board', token, dashboardUrl: 'https://10.47.138.152:3443', secrets: `#define DASHBOARD_URL "https://10.47.138.152:3443"\n#define DEVICE_ID "ckb"\n#define DEVICE_TOKEN "${token}"\n` };

function stubFetch(devices: unknown[])
{
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.startsWith('/api/live/devices')
        ? Response.json({ devices })
        : Response.json({ enabled: true, convertsToMp4: true, recordings: [] })));
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); frame.url = null; });

describe('LiveScreen', () =>
{
    it('explains how to connect a phone when none is sending', async () =>
    {
        stubFetch([]);
        render(<LiveScreen user={viewer} bar={bar} connect={null} />);
        expect(await screen.findByText('No phones are sending right now.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Connect phone' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Recordings' })).toBeNull();
    });

    it('shows a tile per online phone with owner, camera, REC and actions', async () =>
    {
        stubFetch([phone, { ...phone, id: 'ck2', name: 'Silent', online: false, recording: false }]);
        render(<LiveScreen user={viewer} bar={bar} connect={null} />);
        expect(await screen.findByText('Dune phone')).toBeTruthy();
        expect(screen.queryByText('Silent')).toBeNull();
        expect(screen.getByText('by Vo')).toBeTruthy();
        expect(screen.getByText('Camera B1')).toBeTruthy();
        expect(screen.getByText('REC')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Motion view' }).getAttribute('href')).toBe('/live/motion?device=ck1');
        fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
        expect(screen.getByRole('dialog', { name: 'Dune phone' })).toBeTruthy();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('gives admins Connect phone with the QR and the Recordings list', async () =>
    {
        stubFetch([]);
        render(<LiveScreen user={admin} bar={bar} connect={{ url: 'https://192.168.1.20:3443/cam', qrSvg: '<svg data-testid="qr"></svg>' }} />);
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
        render(<LiveScreen user={admin} bar={bar} connect={null} />);
        const row = await screen.findByRole('listitem', { name: 'Dune phone' });
        expect(within(row).getByText(/last seen/)).toBeTruthy();
        expect(within(row).getByText('Camera B1')).toBeTruthy();
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

    it('hides the phones list from viewers', async () =>
    {
        stubFetch([phone]);
        render(<LiveScreen user={viewer} bar={bar} connect={null} />);
        expect(await screen.findByText('Dune phone')).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Devices' })).toBeNull();
    });
});

describe('camera boards', () =>
{
    it('shows the on-board motion badge and label on board tiles only', async () =>
    {
        stubFetch([board, { ...board, id: 'ckb2', name: 'Still board', motion: { ...board.motion, percent: 0.4, active: false, box: [0, 0, 0, 0] } }, phone]);
        render(<LiveScreen user={viewer} bar={bar} connect={null} />);
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
        render(<LiveScreen user={viewer} bar={bar} connect={null} />);
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
        render(<LiveScreen user={admin} bar={bar} connect={{ url: null, qrSvg: null }} />);
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
        render(<LiveScreen user={admin} bar={bar} connect={null} />);
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
        render(<LiveScreen user={admin} bar={bar} connect={null} />);
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
        render(<LiveScreen user={admin} bar={bar} connect={null} />);
        const row = await screen.findByRole('listitem', { name: 'Dune board' });
        fireEvent.click(within(row).getByRole('button', { name: 'Remove Dune board' }));
        expect(within(row).getByText('Remove Dune board? Its camera returns to the simulation loop and the board\'s token stops working. Add it again to get a new token.')).toBeTruthy();
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
