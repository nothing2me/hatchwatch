import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CameraVideo } from '@/features/cameras/CameraVideo';

afterEach(cleanup);

const video = { id: 'v1', source: 'SIMULATION' as const, durationS: 60, hasMotion: true, simRunId: 'R1' };

describe('CameraVideo', () =>
{
    it('loops the raw feed muted with a SIMULATED badge', () =>
    {
        render(<CameraVideo video={video} />);
        const element = screen.getByTestId('camera-video') as HTMLVideoElement;
        expect(element.getAttribute('src')).toBe('/api/media/video/v1?variant=raw');
        expect(element.loop).toBe(true);
        expect(element.muted).toBe(true);
        expect(screen.getByText('Simulated')).toBeTruthy();
    });

    it('switches to motion and resumes from the same time', () =>
    {
        render(<CameraVideo video={video} />);
        const element = screen.getByTestId('camera-video') as HTMLVideoElement;
        element.currentTime = 12.5;
        fireEvent.click(screen.getByRole('radio', { name: 'Motion' }));
        expect(element.getAttribute('src')).toBe('/api/media/video/v1?variant=motion');
        fireEvent(element, new Event('loadedmetadata'));
        expect(element.currentTime).toBeCloseTo(12.5);
    });

    it('hides the toggle when there is no motion variant', () =>
    {
        render(<CameraVideo video={{ ...video, hasMotion: false }} />);
        expect(screen.queryByRole('radio', { name: 'Motion' })).toBeNull();
    });

    it('reports the clock while playing', () =>
    {
        vi.useFakeTimers();
        const onTime = vi.fn();
        render(<CameraVideo video={video} onTime={onTime} />);
        const element = screen.getByTestId('camera-video') as HTMLVideoElement;
        element.currentTime = 3;
        vi.advanceTimersByTime(300);
        expect(onTime).toHaveBeenCalledWith(3);
        vi.useRealTimers();
    });

    it('holds the clock while a toggle waits for metadata and keeps the first resume time', () =>
    {
        vi.useFakeTimers();
        const onTime = vi.fn();
        render(<CameraVideo video={video} onTime={onTime} />);
        const element = screen.getByTestId('camera-video') as HTMLVideoElement;
        element.currentTime = 12.5;
        fireEvent.click(screen.getByRole('radio', { name: 'Motion' }));
        element.currentTime = 0;
        vi.advanceTimersByTime(600);
        expect(onTime).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('radio', { name: 'Raw' }));
        fireEvent(element, new Event('loadedmetadata'));
        expect(element.currentTime).toBeCloseTo(12.5);
        vi.advanceTimersByTime(300);
        expect(onTime).toHaveBeenCalledWith(12.5);
        vi.useRealTimers();
    });

    it('seeks to a requested time once metadata loads, and immediately when already loaded', () =>
    {
        const { rerender } = render(<CameraVideo video={video} seekTo={{ t: 8, nonce: 1 }} />);
        const element = screen.getByTestId('camera-video') as HTMLVideoElement;
        fireEvent(element, new Event('loadedmetadata'));
        expect(element.currentTime).toBeCloseTo(8);
        Object.defineProperty(element, 'readyState', { configurable: true, value: 1 });
        element.currentTime = 20;
        rerender(<CameraVideo video={video} seekTo={{ t: 8, nonce: 2 }} />);
        expect(element.currentTime).toBeCloseTo(8);
    });
});
