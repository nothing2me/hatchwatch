import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CameraView } from '@/lib/types';

let live: { url: string | null; state: string } = { url: null, state: 'idle' };
vi.mock('@/features/phones/useLiveFrame', () => ({ useLiveFrame: (id: string | null) => (id ? live : { url: null, state: 'idle' }) }));
const detections = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/features/phones/useDeviceDetections', () => ({ useDeviceDetections: () => detections.value }));
vi.mock('@/app/(app)/camera-actions', () => ({ setCameraSource: vi.fn(async () => ({ ok: true, code: 'B1' })) }));
const { CameraPanel } = await import('@/features/cameras/CameraPanel');

const camera = {
    id: 'c1', code: 'B1', zoneCode: 'B', position: [-97.06, 27.81], headingDeg: 113, fovDeg: 44, rangeM: 350, status: 'ONLINE', calibrated: false,
    video: { id: 'v1', source: 'SIMULATION', durationS: 40, hasMotion: true, simRunId: 'A-demo-1' },
    liveDevice: { id: 'ck1', name: 'Dune phone' },
} as unknown as CameraView;

beforeEach(() => { localStorage.clear(); detections.value = null; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('CameraPanel with a linked phone', () =>
{
    it('shows the live picture with a LIVE badge and a motion-view link while the phone sends', () =>
    {
        live = { url: 'blob:1', state: 'live' };
        render(<CameraPanel camera={camera} onClose={() => undefined} />);
        expect(screen.getByRole('img', { name: 'Live picture from Dune phone' }).getAttribute('src')).toBe('blob:1');
        expect(screen.getByText('LIVE')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Motion view' }).getAttribute('href')).toBe('/cameras/motion?device=ck1');
        expect(document.querySelector('video')).toBeNull();
    });

    it('falls back to the simulation loop and says the phone is offline', () =>
    {
        live = { url: 'blob:1', state: 'offline' };
        render(<CameraPanel camera={camera} onClose={() => undefined} />);
        expect(screen.queryByText('LIVE')).toBeNull();
        expect(document.querySelector('video')).not.toBeNull();
        expect(screen.getByText('Phone offline · Dune phone')).toBeTruthy();
    });

    it('says Board offline for a linked camera board', () =>
    {
        live = { url: null, state: 'offline' };
        render(<CameraPanel camera={{ ...camera, liveDevice: { id: 'cb1', name: 'Dune board', kind: 'BOARD' } }} onClose={() => undefined} />);
        expect(screen.getByText('Board offline · Dune board')).toBeTruthy();
        expect(screen.queryByText(/Phone offline/)).toBeNull();
    });

    it('offers the Source picker to admins only', () =>
    {
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ devices: [] })));
        live = { url: null, state: 'loading' };
        const { rerender } = render(<CameraPanel camera={camera} onClose={() => undefined} />);
        expect(screen.queryByLabelText('Source')).toBeNull();
        rerender(<CameraPanel camera={camera} onClose={() => undefined} canEditSource />);
        expect(screen.getByLabelText('Source')).toBeTruthy();
    });

    it('switches from the expanded loop to the live picture and back to the panel loop when the phone stops', () =>
    {
        live = { url: null, state: 'offline' };
        const { rerender } = render(<CameraPanel camera={camera} onClose={() => undefined} />);
        fireEvent.click(screen.getByRole('button', { name: 'Expand camera view' }));
        expect(screen.getByText('Playing in expanded view')).toBeTruthy();
        expect(screen.getByRole('dialog')).toBeTruthy();
        live = { url: 'blob:2', state: 'live' };
        rerender(<CameraPanel camera={camera} onClose={() => undefined} />);
        expect(screen.getByRole('img', { name: 'Live picture from Dune phone' })).toBeTruthy();
        expect(screen.queryByText('Playing in expanded view')).toBeNull();
        expect(screen.queryByRole('dialog')).toBeNull();
        live = { url: 'blob:2', state: 'offline' };
        rerender(<CameraPanel camera={camera} onClose={() => undefined} />);
        expect(screen.queryByText('Playing in expanded view')).toBeNull();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.querySelector('video')).not.toBeNull();
        expect(screen.getByText('Phone offline · Dune phone')).toBeTruthy();
    });

    it('draws detections over the live picture with the counts, Detection off, and nothing when switched off', () =>
    {
        live = { url: 'blob:1', state: 'live' };
        detections.value = { at: 1, dark: false, width: 320, height: 240, objects: [{ track: 'P1', label: 'person', score: 0.82, box: [1, 2, 3, 4] }], trails: [] };
        const { container, unmount } = render(<CameraPanel camera={camera} onClose={() => undefined} />);
        expect(screen.getByText('person 0.82')).toBeTruthy();
        expect(container.querySelector('svg[viewBox="0 0 320 240"] rect[data-track="P1"]')).toBeTruthy();
        expect(screen.getByText('People 1 · Possible turtles 0')).toBeTruthy();
        expect(screen.getByText('Detection is a viewing aid; it can miss people and mistake objects.')).toBeTruthy();
        unmount();

        detections.value = null;
        const second = render(<CameraPanel camera={camera} onClose={() => undefined} />);
        expect(screen.getByText('Detection off')).toBeTruthy();
        second.unmount();

        // Turned off before the HatchWatch rename: still off, and moved to the new key.
        localStorage.setItem('nesttrace.detections', 'off');
        detections.value = { at: 1, dark: false, width: 320, height: 240, objects: [{ track: 'P1', label: 'person', score: 0.82, box: [1, 2, 3, 4] }], trails: [] };
        render(<CameraPanel camera={camera} onClose={() => undefined} />);
        expect(screen.queryByText('person 0.82')).toBeNull();
        expect(screen.queryByText('People 1 · Possible turtles 0')).toBeNull();
        expect(screen.queryByText('Detection off')).toBeNull();
        expect(localStorage.getItem('hatchwatch.detections')).toBe('off');
        expect(localStorage.getItem('nesttrace.detections')).toBeNull();
    });

    it('greys a person outside the linked camera\'s watch area', () =>
    {
        live = { url: 'blob:1', state: 'live' };
        detections.value = { at: 1, dark: false, width: 320, height: 240, objects: [{ track: 'P1', label: 'person', score: 0.82, box: [194, 104, 31, 86] }], trails: [] };
        const { container } = render(<CameraPanel camera={{ ...camera, mask: [[0, 0], [0.4, 0], [0.4, 0.4], [0, 0.4]] }} onClose={() => undefined} />);
        expect(screen.getByText('person 0.82 · outside watch area')).toBeTruthy();
        expect(container.querySelector('rect[data-track="P1"]')!.getAttribute('data-outside')).toBe('true');
        expect(container.querySelector('[data-testid="watch-area"]')).toBeTruthy();
    });

    it('shows no detection lines while the camera plays the simulation loop', () =>
    {
        live = { url: null, state: 'offline' };
        render(<CameraPanel camera={camera} onClose={() => undefined} />);
        expect(screen.queryByText('Detection off')).toBeNull();
    });
});
