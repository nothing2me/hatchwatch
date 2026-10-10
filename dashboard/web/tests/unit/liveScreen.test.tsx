import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('@/features/phones/useLiveFrame', () => ({ useLiveFrame: () => ({ url: null, state: 'loading' }) }));
vi.mock('@/app/(app)/actions', () => ({ logoutAction: vi.fn() }));
const { LiveScreen } = await import('@/features/phones/LiveScreen');
const { RecordingsPanel, formatStart } = await import('@/features/phones/RecordingsPanel');

const bar = { camerasOnline: 1, camerasTotal: 2, activeSites: 0 };
const admin = { id: 'a', email: 'a@x.y', name: 'Ad', role: 'ADMIN' as const };
const viewer = { ...admin, id: 'v', role: 'VIEWER' as const };
const phone = { id: 'ck1', name: 'Dune phone', ownerName: 'Vo', cameraCode: 'B1', online: true, recording: true, lastSeenAt: '2026-10-10T20:00:00.000Z' };

function stubFetch(devices: unknown[])
{
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.startsWith('/api/live/devices')
        ? Response.json({ devices })
        : Response.json({ enabled: true, convertsToMp4: true, recordings: [] })));
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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
