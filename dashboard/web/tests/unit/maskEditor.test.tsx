import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const frame = { url: null as string | null };
vi.mock('@/features/phones/useLiveFrame', () => ({ useLiveFrame: (id: string | null) => ({ url: id ? frame.url : null, state: id && frame.url ? 'live' : 'idle' }) }));

const { MaskEditor } = await import('@/features/cameras/MaskEditor');

const triangle: [number, number][] = [[0.1, 0.1], [0.9, 0.1], [0.5, 0.9]];
const fetchMock = vi.fn();

beforeEach(() =>
{
    frame.url = null;
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, code: 'E1', polygon: triangle, researchFile: 'written' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const bodyOf = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body as string);

describe('MaskEditor', () =>
{
    it('says the mask is for this camera only and how simulated clips share masks', () =>
    {
        render(<MaskEditor code="E1" liveDeviceId={null} videoId={null} initial={null} onSaved={vi.fn()} />);
        expect(screen.getByText('This mask applies to camera E1 only. People whose feet are outside it are drawn in grey and never raise a camera alert. With no mask, the whole picture counts.')).toBeTruthy();
        expect(screen.getByText('Simulated clips: the simulator uses one watch area for all odd-numbered cameras and one for all even-numbered cameras, taken from the most recently saved mask of each kind.')).toBeTruthy();
        expect(screen.getByText('No picture yet; you can still draw the area.')).toBeTruthy();
    });

    it('draws over the live picture when a device is linked, else the latest clip', () =>
    {
        frame.url = 'blob:live-frame';
        const { container, unmount } = render(<MaskEditor code="E1" liveDeviceId="dev-1" videoId="vid-1" initial={null} onSaved={vi.fn()} />);
        expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:live-frame');
        expect(container.querySelector('video')).toBeNull();
        unmount();
        const clip = render(<MaskEditor code="E1" liveDeviceId={null} videoId="vid-1" initial={null} onSaved={vi.fn()} />);
        expect(clip.container.querySelector('video')?.getAttribute('src')).toBe('/api/media/video/vid-1?variant=raw');
        expect(clip.container.querySelector('img')).toBeNull();
    });

    it('saves the normalised polygon for this camera code', async () =>
    {
        const onSaved = vi.fn();
        render(<MaskEditor code="E1" liveDeviceId={null} videoId={null} initial={triangle} onSaved={onSaved} />);
        fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
        await screen.findByText('Saved.');
        expect(fetchMock).toHaveBeenCalledWith('/api/cameras/masks', expect.objectContaining({ method: 'PUT' }));
        expect(bodyOf(0)).toEqual({ code: 'E1', polygon: triangle });
        expect(onSaved).toHaveBeenCalledWith(triangle);
    });

    it('adds a point where the picture is clicked, in picture coordinates', async () =>
    {
        render(<MaskEditor code="E1" liveDeviceId={null} videoId={null} initial={triangle} onSaved={vi.fn()} />);
        const svg = screen.getByLabelText('Edit E1 watch mask') as unknown as SVGSVGElement;
        svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
        fireEvent.click(svg, { clientX: 100, clientY: 75 });
        fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
        await screen.findByText('Saved.');
        expect(bodyOf(0).polygon).toEqual([...triangle, [0.5, 0.75]]);
    });

    it('disables Save with fewer than 3 points', () =>
    {
        const { container } = render(<MaskEditor code="E1" liveDeviceId={null} videoId={null} initial={triangle} onSaved={vi.fn()} />);
        fireEvent.doubleClick(container.querySelectorAll('[data-handle]')[0]);
        expect(container.querySelectorAll('[data-handle]')).toHaveLength(2);
        expect((screen.getByRole('button', { name: /^Save/ }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('clears the mask with Use whole picture and warns when the simulator file failed', async () =>
    {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, code: 'E1', polygon: null, researchFile: 'failed' }), { status: 200 }));
        const onSaved = vi.fn();
        render(<MaskEditor code="E1" liveDeviceId={null} videoId={null} initial={triangle} onSaved={onSaved} />);
        fireEvent.click(screen.getByRole('button', { name: 'Use whole picture' }));
        await screen.findByText('Saved. The simulator\'s mask file could not be written (check MASKS_ROOT).');
        expect(bodyOf(0)).toEqual({ code: 'E1', polygon: null });
        expect(onSaved).toHaveBeenCalledWith(null);
    });

    it('starts over from the default beach strip', async () =>
    {
        const { container } = render(<MaskEditor code="E1" liveDeviceId={null} videoId={null} initial={triangle} onSaved={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
        await waitFor(() => expect(container.querySelectorAll('[data-handle]')).toHaveLength(4));
    });
});
