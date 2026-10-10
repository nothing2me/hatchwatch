import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CamStreamer } from '@/app/cam/CamStreamer';

const getUserMedia = vi.fn();
const fetchMock = vi.fn();

function setSecure(value: boolean)
{
    Object.defineProperty(window, 'isSecureContext', { value, configurable: true });
}

beforeEach(() =>
{
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    vi.stubGlobal('fetch', fetchMock);
    setSecure(true);
});

afterEach(() =>
{
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
});

describe('CamStreamer', () =>
{
    it('shows the signed-in user and the start button', () =>
    {
        render(<CamStreamer userName="Vera" />);
        expect(screen.getByText('Signed in as Vera')).toBeTruthy();
        expect(screen.getByRole('button', { name: /start streaming/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Rear' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('explains a denied camera permission and registers nothing', async () =>
    {
        getUserMedia.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
        render(<CamStreamer userName="Vera" />);
        fireEvent.click(screen.getByRole('button', { name: /start streaming/i }));
        expect((await screen.findByRole('alert')).textContent).toMatch(/permission/i);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: /start streaming/i })).toBeTruthy();
    });

    it('asks for https on an insecure page without touching the camera', async () =>
    {
        setSecure(false);
        render(<CamStreamer userName="Vera" />);
        fireEvent.click(screen.getByRole('button', { name: /start streaming/i }));
        expect((await screen.findByRole('alert')).textContent).toMatch(/https/i);
        expect(getUserMedia).not.toHaveBeenCalled();
    });

    it('stops the camera and reports when the device cannot be registered', async () =>
    {
        const stopTrack = vi.fn();
        getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: stopTrack }], getVideoTracks: () => [] });
        fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
        render(<CamStreamer userName="Vera" />);
        fireEvent.click(screen.getByRole('button', { name: /start streaming/i }));
        expect((await screen.findByRole('alert')).textContent).toMatch(/could not register/i);
        expect(stopTrack).toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledWith('/api/live/devices', expect.objectContaining({ method: 'POST' }));
    });
});
