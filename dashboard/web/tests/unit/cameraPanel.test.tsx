import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CameraView, LiveDeviceView } from '@/lib/types';

const assignCameraSource = vi.fn();
vi.mock('@/app/(app)/live-actions', () => ({ assignCameraSource: (...args: unknown[]) => assignCameraSource(...args) }));
vi.mock('@/features/live/LiveVideo', () => ({ LiveVideo: ({ deviceId }: { deviceId: string }) => <div>live {deviceId}</div> }));

const { CameraPanel } = await import('@/features/cameras/CameraPanel');

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const camera: CameraView = {
    id: 'c1', code: 'B1', zoneCode: 'B', position: [0, 0], headingDeg: 90, fovDeg: 44, rangeM: 300, status: 'ONLINE', calibrated: true,
    video: { id: 'v1', source: 'SIMULATION', durationS: 40, hasMotion: true, simRunId: 'R' }, liveDeviceId: null,
};
const devices: LiveDeviceView[] = [
    { id: 'd1', name: 'Pixel', online: true, cameraCode: null },
    { id: 'd2', name: 'Laptop', online: true, cameraCode: 'C1' },
    { id: 'd3', name: 'Asleep', online: false, cameraCode: null },
];
const panel = (props: Partial<Parameters<typeof CameraPanel>[0]> = {}) => <CameraPanel camera={camera} onClose={() => undefined} {...props} />;

describe('CameraPanel feeds', () =>
{
    it('plays a live feed with a LIVE badge and no loop controls', () =>
    {
        render(panel({ feed: { kind: 'live', deviceId: 'd1', deviceName: 'Pixel' } }));
        expect(screen.getByText('live d1')).toBeTruthy();
        expect(screen.getByText('LIVE · Pixel')).toBeTruthy();
        expect(screen.queryByTestId('camera-video')).toBeNull();
        expect(screen.queryByLabelText('Expand camera view')).toBeNull();
        expect(screen.getByText(/view only, not recorded or analysed/)).toBeTruthy();
    });

    it('keeps the loop when no feed is given', () =>
    {
        render(panel());
        expect(screen.getByTestId('camera-video')).toBeTruthy();
        expect(screen.queryByText(/LIVE/)).toBeNull();
    });

    it('says which device is offline while the loop plays', () =>
    {
        render(panel({ feed: { kind: 'sim', video: camera.video!, deviceOffline: 'Pixel' } }));
        expect(screen.getByTestId('camera-video')).toBeTruthy();
        expect(screen.getByText('Pixel offline · showing simulation')).toBeTruthy();
    });
});

describe('CameraPanel source picker', () =>
{
    it('is admin only', () =>
    {
        render(panel({ devices }));
        expect(screen.queryByLabelText('Source')).toBeNull();
    });

    it('lists the loop and online devices, disabling ones used by another camera', () =>
    {
        render(panel({ isAdmin: true, devices }));
        const options = Array.from((screen.getByLabelText('Source') as HTMLSelectElement).options).map(option => [option.textContent, option.disabled]);
        expect(options).toEqual([['Simulation loop', false], ['Pixel', false], ['Laptop (on C1)', true]]);
    });

    it('keeps an assigned device in the list while it is offline', () =>
    {
        render(panel({ isAdmin: true, devices, camera: { ...camera, liveDeviceId: 'd3' } }));
        const select = screen.getByLabelText('Source') as HTMLSelectElement;
        expect(select.value).toBe('d3');
        expect(Array.from(select.options).map(option => option.textContent)).toContain('Asleep · offline');
    });

    it('assigns the chosen device and shows a refusal inline', async () =>
    {
        assignCameraSource.mockResolvedValue({ ok: false, error: 'That device already feeds camera C1.' });
        render(panel({ isAdmin: true, devices }));
        fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'd1' } });
        expect(assignCameraSource).toHaveBeenCalledWith('B1', 'd1');
        expect((await screen.findByRole('alert')).textContent).toBe('That device already feeds camera C1.');
    });

    it('switches back to the loop with null', async () =>
    {
        assignCameraSource.mockResolvedValue({ ok: true });
        render(panel({ isAdmin: true, devices, camera: { ...camera, liveDeviceId: 'd1' } }));
        fireEvent.change(screen.getByLabelText('Source'), { target: { value: '' } });
        await waitFor(() => expect(assignCameraSource).toHaveBeenCalledWith('B1', null));
        expect(screen.queryByRole('alert')).toBeNull();
    });
});
