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
});
