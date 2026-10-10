import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CameraView } from '@/lib/types';

vi.mock('@/app/(app)/camera-actions', () => ({ setCameraSource: vi.fn() }));
const { CameraPanel } = await import('@/features/cameras/CameraPanel');

afterEach(() =>
{
    cleanup();
    localStorage.clear();
});

const camera = {
    id: 'c1', code: 'B1', zoneCode: 'Z1', status: 'ONLINE', calibrated: true, headingDeg: 90, fovDeg: 70, rangeM: 30,
    video: { id: 'v1', source: 'SIMULATION', durationS: 60, hasMotion: true, simRunId: 'R1' },
} as unknown as CameraView;

describe('expanded camera view', () =>
{
    it('keeps a single player: the panel yields to the overlay and takes it back on Escape', () =>
    {
        render(<CameraPanel camera={camera} onClose={() => undefined} />);
        expect(screen.getAllByTestId('camera-video')).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Expand camera view' }));
        expect(screen.getByRole('dialog')).toBeTruthy();
        expect(screen.getAllByTestId('camera-video')).toHaveLength(1);
        expect(screen.getByText('Playing in expanded view')).toBeTruthy();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getAllByTestId('camera-video')).toHaveLength(1);
        expect(screen.queryByText('Playing in expanded view')).toBeNull();
    });

    it('resumes the panel from the last reported time', () =>
    {
        vi.useFakeTimers();
        const onTime = vi.fn();
        render(<CameraPanel camera={camera} onClose={() => undefined} onTime={onTime} />);
        fireEvent.click(screen.getByRole('button', { name: 'Expand camera view' }));
        const big = screen.getByTestId('camera-video') as HTMLVideoElement;
        fireEvent(big, new Event('loadedmetadata'));
        big.currentTime = 17;
        vi.advanceTimersByTime(300);
        expect(onTime).toHaveBeenLastCalledWith(17);
        fireEvent.click(screen.getByRole('button', { name: 'Close expanded view' }));
        const small = screen.getByTestId('camera-video') as HTMLVideoElement;
        fireEvent(small, new Event('loadedmetadata'));
        expect(small.currentTime).toBeCloseTo(17);
        vi.useRealTimers();
    });

    it('offers no expand button without footage', () =>
    {
        render(<CameraPanel camera={{ ...camera, video: null } as unknown as CameraView} onClose={() => undefined} />);
        expect(screen.queryByRole('button', { name: 'Expand camera view' })).toBeNull();
    });

    it('resizes with arrow keys and remembers the width', () =>
    {
        const { unmount } = render(<CameraPanel camera={camera} onClose={() => undefined} />);
        const handle = screen.getByRole('separator');
        expect(handle.getAttribute('aria-valuenow')).toBe('304');
        fireEvent.keyDown(handle, { key: 'ArrowLeft' });
        expect(handle.getAttribute('aria-valuenow')).toBe('328');
        expect(localStorage.getItem('nesttrace.panel.width')).toBe('328');
        unmount();
        render(<CameraPanel camera={camera} onClose={() => undefined} />);
        expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('328');
    });
});

describe('expanded view fixes', () =>
{
    it('keeps Raw/Motion across expand and close', () =>
    {
        render(<CameraPanel camera={camera} onClose={() => undefined} />);
        fireEvent.click(screen.getByRole('radio', { name: 'Motion diff' }));
        fireEvent.click(screen.getByRole('button', { name: 'Expand camera view' }));
        expect(screen.getByTestId('camera-video').getAttribute('src')).toContain('variant=motion');
        fireEvent.click(screen.getByRole('button', { name: 'Close expanded view' }));
        expect(screen.getByTestId('camera-video').getAttribute('src')).toContain('variant=motion');
    });

    it('does not carry a hand-off to another camera when keyed by camera', () =>
    {
        vi.useFakeTimers();
        const other = { ...camera, id: 'c2', code: 'B2', video: { ...(camera.video as object), id: 'v2' } } as unknown as CameraView;
        const view = (c: CameraView) => <CameraPanel key={c.id} camera={c} onClose={() => undefined} onTime={() => undefined} />;
        const { rerender } = render(view(camera));
        fireEvent.click(screen.getByRole('button', { name: 'Expand camera view' }));
        const big = screen.getByTestId('camera-video') as HTMLVideoElement;
        fireEvent(big, new Event('loadedmetadata'));
        big.currentTime = 40;
        vi.advanceTimersByTime(300);
        fireEvent.click(screen.getByRole('button', { name: 'Close expanded view' }));
        rerender(view(other));
        const next = screen.getByTestId('camera-video') as HTMLVideoElement;
        fireEvent(next, new Event('loadedmetadata'));
        expect(next.currentTime).toBe(0);
        vi.useRealTimers();
    });
});
