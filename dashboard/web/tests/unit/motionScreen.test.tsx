import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MapSnapshot } from '@/lib/types';

let liveStatus: Record<string, { deviceId: string; name: string; online: boolean }> = {};
vi.mock('@/features/live/useLiveStatus', () => ({ useLiveStatus: () => liveStatus }));
vi.mock('@/features/live/useLiveSnapshot', () => ({ useLiveSnapshot: (snapshot: MapSnapshot) => snapshot }));
vi.mock('@/features/live/LiveVideo', () => ({ LiveVideo: ({ deviceId }: { deviceId: string }) => <div data-testid="live-player">live {deviceId}</div> }));
vi.mock('@/app/(app)/actions', () => ({ logoutAction: vi.fn() }));

const { MotionScreen } = await import('@/features/live/MotionScreen');

const camera = (code: string) => ({ id: code, code, zoneCode: code[0], position: [0, 0] as [number, number], headingDeg: 0, fovDeg: 44, rangeM: 300, status: 'ONLINE' as const, calibrated: false, video: null, liveDeviceId: null });
const snapshot: MapSnapshot = {
    zones: [], cameras: [camera('A1'), camera('B1')], alerts: [],
    camerasOnline: 2, camerasTotal: 2, inactiveCount: 0, outcomes: { saved: 0, notSaved: 0, pending: 0 }, fadeMinutes: 5,
    tracks: [], dangerCount: 0, dangerTotal: 0,
};
const user = { id: 'u', email: 'v@x.y', name: 'V', role: 'VIEWER' as const };

beforeEach(() => { liveStatus = {}; });
afterEach(() => { cleanup(); });

describe('MotionScreen', () =>
{
    it('explains how to get a live feed when the camera has none', () =>
    {
        render(<MotionScreen user={user} initialSnapshot={snapshot} initialCamera="A1" />);
        expect(screen.getAllByText('No live device on A1. Open it on the map and pick a phone under Source.')).toHaveLength(2);
        expect(screen.queryByTestId('live-player')).toBeNull();
        expect((screen.getByRole('button', { name: /reset background/i }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('opens the streaming camera by default and shows the feed next to the motion canvas', () =>
    {
        liveStatus = { B1: { deviceId: 'd1', name: 'Pixel', online: true } };
        render(<MotionScreen user={user} initialSnapshot={snapshot} initialCamera={null} />);
        expect(screen.getByTestId('live-player').textContent).toBe('live d1');
        expect(screen.getByRole('img', { name: /Motion in 0.0% of the picture/ })).toBeTruthy();
        expect(screen.getByText('Live feed · B1 · Pixel')).toBeTruthy();
        expect(Array.from((screen.getByLabelText('Camera') as HTMLSelectElement).options).map(option => option.textContent)).toEqual(['A1', 'B1 · LIVE Pixel']);
    });

    it('switches camera and comparison mode', () =>
    {
        liveStatus = { B1: { deviceId: 'd1', name: 'Pixel', online: true } };
        render(<MotionScreen user={user} initialSnapshot={snapshot} initialCamera="B1" />);
        fireEvent.click(screen.getByRole('button', { name: 'Since last frame' }));
        expect(screen.getByText('Motion · since last frame')).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Camera'), { target: { value: 'A1' } });
        expect(window.location.search).toBe('?camera=A1');
        expect(screen.queryByTestId('live-player')).toBeNull();
    });
});
