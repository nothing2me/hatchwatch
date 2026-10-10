import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const addCameraPairToZone = vi.fn();
const addCameraPairNewZone = vi.fn();
const updateCamera = vi.fn();
const deleteCamera = vi.fn();
const faceOcean = vi.fn();
const mergeZoneInto = vi.fn();
vi.mock('@/app/(app)/actions', () => ({ logoutAction: vi.fn() }));
vi.mock('@/app/(app)/camera-actions', () => ({ addCameraPairToZone, addCameraPairNewZone, updateCamera, deleteCamera, faceOcean, mergeZoneInto, setCameraSource: vi.fn() }));

const { CamerasScreen } = await import('@/features/cameras/CamerasScreen');

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const admin = { id: 'a', email: 'admin@x.y', name: 'Admin', role: 'ADMIN' as const };
const bar = { camerasOnline: 3, camerasTotal: 3, activeSites: 0 };
const zones = [
    { code: 'B', name: 'Zone B', suggested: [-97.0645, 27.8166] as [number, number], mergeable: false },
    { code: 'D', name: 'Zone D', suggested: [-97.059, 27.8227] as [number, number], mergeable: true },
];
const row = { fovDeg: 44, rangeM: 350, status: 'ONLINE' as const, footage: 1, alerts: 0, liveDeviceId: null, liveDeviceName: null, mask: null };
const cameras = [
    { ...row, code: 'B1', zoneCode: 'B', lng: -97.062796, lat: 27.81816, headingDeg: 203, liveSlot: true },
    { ...row, code: 'B2', zoneCode: 'B', lng: -97.065525, lat: 27.815179, headingDeg: 56, liveSlot: true },
    { ...row, code: 'D3', zoneCode: 'D', lng: -97.0571, lat: 27.8241, headingDeg: 149, liveSlot: false, footage: 0 },
];

describe('CamerasScreen', () =>
{
    it('groups cameras by zone with position, heading and footage', () =>
    {
        render(<CamerasScreen user={admin} zones={zones} cameras={cameras} bar={bar} />);
        const zoneB = screen.getByRole('region', { name: /Zone B/ });
        expect(within(zoneB).getByText('27.818160')).toBeTruthy();
        expect(within(zoneB).getByText('SSW')).toBeTruthy();
        expect(within(zoneB).getByRole('button', { name: /Face ocean B1·B2/ })).toBeTruthy();
        const zoneD = screen.getByRole('region', { name: /Zone D/ });
        expect(within(zoneD).getByText('0 videos · 0 alerts')).toBeTruthy();
    });

    it('edits latitude and longitude and sends only what changed', async () =>
    {
        updateCamera.mockResolvedValue({ ok: true, code: 'D3' });
        render(<CamerasScreen user={admin} zones={zones} cameras={cameras} bar={bar} />);
        fireEvent.click(screen.getByRole('button', { name: 'Edit D3' }));
        fireEvent.change(screen.getByLabelText('Latitude for D3'), { target: { value: '27.8245' } });
        fireEvent.change(screen.getByLabelText('Longitude for D3'), { target: { value: '-97.0569' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(updateCamera).toHaveBeenCalledWith('D3', { lat: 27.8245, lng: -97.0569 });
        expect(await screen.findByText('D3 saved')).toBeTruthy();
    });

    it('shows validation messages and does not save a bad value', () =>
    {
        render(<CamerasScreen user={admin} zones={zones} cameras={cameras} bar={bar} />);
        fireEvent.click(screen.getByRole('button', { name: 'Edit D3' }));
        fireEvent.change(screen.getByLabelText('Latitude for D3'), { target: { value: '95' } });
        fireEvent.change(screen.getByLabelText('FOV for D3'), { target: { value: '5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(updateCamera).not.toHaveBeenCalled();
        const alert = screen.getByRole('alert');
        expect(alert.textContent).toContain('Latitude must be between -90 and 90.');
        expect(alert.textContent).toContain('Field of view must be between 10 and 120.');
    });

    it('locks the code of a live-feed camera', () =>
    {
        render(<CamerasScreen user={admin} zones={zones} cameras={cameras} bar={bar} />);
        fireEvent.click(screen.getByRole('button', { name: 'Edit B1' }));
        expect((screen.getByLabelText('Code for B1') as HTMLInputElement).disabled).toBe(true);
    });

    it('adds a pair to the chosen zone at the prefilled point', async () =>
    {
        addCameraPairToZone.mockResolvedValue({ ok: true, codes: ['D4', 'D5'], zoneCode: 'D' });
        render(<CamerasScreen user={admin} zones={zones} cameras={cameras} bar={bar} />);
        fireEvent.change(screen.getByLabelText('Zone'), { target: { value: 'D' } });
        expect((screen.getByLabelText('Centre latitude') as HTMLInputElement).value).toBe('27.8227');
        fireEvent.click(screen.getByRole('button', { name: 'Add pair' }));
        expect(addCameraPairToZone).toHaveBeenCalledWith('D', -97.059, 27.8227);
        expect(await screen.findByText('D4 · D5 added to Zone D, facing the sea')).toBeTruthy();
    });

    it('makes a new zone at a typed point when that is chosen, and shows refusals', async () =>
    {
        addCameraPairNewZone.mockResolvedValueOnce({ ok: true, codes: ['E1', 'E2'], zoneCode: 'E', newZone: true });
        render(<CamerasScreen user={admin} zones={zones} cameras={cameras} bar={bar} />);
        expect((screen.getByRole('radio', { name: 'Add to zone' }) as HTMLInputElement).checked).toBe(true);
        fireEvent.click(screen.getByRole('radio', { name: 'New zone at this location' }));
        expect(screen.queryByLabelText('Zone')).toBeNull();
        expect(screen.getByTestId('next-zone').textContent).toBe('Zone E');
        fireEvent.change(screen.getByLabelText('Centre latitude'), { target: { value: '27.8312' } });
        fireEvent.change(screen.getByLabelText('Centre longitude'), { target: { value: '-97.0512' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add pair' }));
        expect(addCameraPairNewZone).toHaveBeenCalledWith(-97.0512, 27.8312);
        expect(addCameraPairToZone).not.toHaveBeenCalled();
        expect(await screen.findByText('New Zone E · E1 · E2 facing the sea')).toBeTruthy();
        addCameraPairNewZone.mockResolvedValueOnce({ ok: false, error: 'Too close to Zone D — click inside it to join, or further away for a new zone' });
        await waitFor(() => expect((screen.getByRole('button', { name: 'Add pair' }) as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(screen.getByRole('button', { name: 'Add pair' }));
        expect(addCameraPairNewZone).toHaveBeenCalledTimes(2);
        expect(await screen.findByText(/Too close to Zone D/)).toBeTruthy();
    });

    it('turns a pair to face the ocean and shows refusals', async () =>
    {
        faceOcean.mockResolvedValue({ ok: true, codes: ['B1', 'B2'] });
        deleteCamera.mockResolvedValue({ ok: false, error: 'Camera B1 has footage or alerts; it cannot be removed.' });
        render(<CamerasScreen user={admin} zones={zones} cameras={cameras} bar={bar} />);
        fireEvent.click(screen.getByRole('button', { name: /Face ocean B1·B2/ }));
        expect(faceOcean).toHaveBeenCalledWith('B1');
        expect(await screen.findByText('B1 · B2 now face the sea')).toBeTruthy();
        const remove = screen.getByRole('button', { name: 'Delete B1' }) as HTMLButtonElement;
        await waitFor(() => expect(remove.disabled).toBe(false));
        fireEvent.click(remove);
        expect(await screen.findByText('Camera B1 has footage or alerts; it cannot be removed.')).toBeTruthy();
    });

    it('asks before merging a zone into its nearest neighbour', async () =>
    {
        mergeZoneInto.mockResolvedValue({ ok: true, targetCode: 'B', moved: [{ from: 'D3', to: 'B3' }] });
        render(<CamerasScreen user={admin} zones={zones} cameras={cameras} bar={bar} />);
        // Built-in zones offer no merge.
        expect(within(screen.getByRole('region', { name: /Zone B/ })).queryByRole('button', { name: /Merge into nearest zone/ })).toBeNull();
        const zoneD = screen.getByRole('region', { name: /Zone D/ });
        fireEvent.click(within(zoneD).getByRole('button', { name: /Merge into nearest zone/ }));
        expect(mergeZoneInto).not.toHaveBeenCalled();
        fireEvent.click(within(zoneD).getByRole('button', { name: 'Merge zone' }));
        expect(mergeZoneInto).toHaveBeenCalledWith('D');
        expect(await screen.findByText('Zone D merged into Zone B: D3 → B3')).toBeTruthy();
    });

    it('offers a watch mask on every camera, not only the live slots', () =>
    {
        const more = [
            ...cameras,
            { ...row, code: 'C3', zoneCode: 'D', lng: -97.0572, lat: 27.8242, headingDeg: 149, liveSlot: false },
            { ...row, code: 'E1', zoneCode: 'D', lng: -97.0573, lat: 27.8243, headingDeg: 149, liveSlot: false, mask: [[0.1, 0.1], [0.9, 0.1], [0.5, 0.9]] as [number, number][] },
        ];
        render(<CamerasScreen user={admin} zones={zones} cameras={more} bar={bar} />);
        for (const code of ['B1', 'B2', 'D3', 'C3', 'E1'])
        {
            expect(screen.getByRole('button', { name: `Edit watch mask for ${code}` })).toBeTruthy();
        }
        expect(screen.getByRole('button', { name: 'Edit watch mask for E1' }).textContent).toBe('Mask · set');
        expect(screen.getByRole('button', { name: 'Edit watch mask for C3' }).textContent).toBe('Mask');
    });
});
