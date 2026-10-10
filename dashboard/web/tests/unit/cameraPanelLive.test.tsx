import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CameraView } from '@/lib/types';

let live: { url: string | null; state: string } = { url: null, state: 'idle' };
vi.mock('@/features/phones/useLiveFrame', () => ({ useLiveFrame: (id: string | null) => (id ? live : { url: null, state: 'idle' }) }));
vi.mock('@/app/(app)/camera-actions', () => ({ setCameraSource: vi.fn(async () => ({ ok: true, code: 'B1' })) }));
const { CameraPanel } = await import('@/features/cameras/CameraPanel');

const camera = {
    id: 'c1', code: 'B1', zoneCode: 'B', position: [-97.06, 27.81], headingDeg: 113, fovDeg: 44, rangeM: 350, status: 'ONLINE', calibrated: false,
    video: { id: 'v1', source: 'SIMULATION', durationS: 40, hasMotion: true, simRunId: 'A-demo-1' },
    liveDevice: { id: 'ck1', name: 'Dune phone' },
} as unknown as CameraView;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('CameraPanel with a linked phone', () =>
{
    it('shows the live picture with a LIVE badge and a motion-view link while the phone sends', () =>
    {
        live = { url: 'blob:1', state: 'live' };
        render(<CameraPanel camera={camera} onClose={() => undefined} />);
        expect(screen.getByRole('img', { name: 'Live picture from Dune phone' }).getAttribute('src')).toBe('blob:1');
        expect(screen.getByText('LIVE')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Motion view' }).getAttribute('href')).toBe('/live/motion?device=ck1');
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
});
