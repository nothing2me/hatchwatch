import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MapSnapshot } from '@/lib/types';

// MapLibre needs WebGL; replace MapView with a stub that exposes camera buttons.
vi.mock('@/features/map/MapView', async () =>
{
    const React = await import('react');
    return {
        initialBounds: () => [[0, 0], [1, 1]],
        MapView: React.forwardRef(function MapViewStub(props: { snapshot: MapSnapshot; onSelectCamera: (id: string) => void }, ref)
        {
            React.useImperativeHandle(ref, () => ({ zoomIn: vi.fn(), zoomOut: vi.fn(), fitBounds: vi.fn() }));
            return <div>{props.snapshot.cameras.map(camera => <button key={camera.id} onClick={() => props.onSelectCamera(camera.id)}>cam {camera.code}</button>)}</div>;
        }),
    };
});
vi.mock('@/app/(app)/actions', () => ({ logoutAction: vi.fn() }));

const { MapScreen } = await import('@/features/map/MapScreen');

const snapshot: MapSnapshot = {
    zones: [{ id: 'z', code: 'B', name: 'Holiday', activityLevel: 'HIGH', ring: [[0, 0], [1, 0], [1, 1], [0, 0]] }],
    cameras: [{ id: 'c1', code: 'B1', zoneCode: 'B', position: [0.5, 0.5], headingDeg: 203, fovDeg: 44, rangeM: 350, status: 'ONLINE', calibrated: false, video: null }],
    alerts: [],
    camerasOnline: 1, camerasTotal: 1, activeAlertCount: 0,
};
const user = { id: 'u', email: 'v@x.y', name: 'V', role: 'VIEWER' as const };

afterEach(() => { cleanup(); localStorage.clear(); });

describe('MapScreen', () =>
{
    it('opens the camera panel when a camera is selected and closes it', () =>
    {
        render(<MapScreen snapshot={snapshot} user={user} />);
        expect(screen.queryByText('Camera B1')).toBeNull();
        fireEvent.click(screen.getByText('cam B1'));
        expect(screen.getByText('Camera B1')).toBeTruthy();
        expect(screen.getByText('No footage yet')).toBeTruthy();
        fireEvent.click(screen.getByLabelText('Close camera panel'));
        expect(screen.queryByText('Camera B1')).toBeNull();
    });

    it('hides Setup link for viewers', () =>
    {
        render(<MapScreen snapshot={snapshot} user={user} />);
        expect(screen.queryByText('Setup')).toBeNull();
    });

    it('shows zoom, fit, and layer controls and an empty alerts state', () =>
    {
        render(<MapScreen snapshot={snapshot} user={user} />);
        expect(screen.getByLabelText('Zoom in')).toBeTruthy();
        expect(screen.getByLabelText('Zoom out')).toBeTruthy();
        expect(screen.getByLabelText('Fit beach')).toBeTruthy();
        expect(screen.getByText('No alerts yet.')).toBeTruthy();
    });

    it('lets the alerts feed collapse so the map is usable on phones', () =>
    {
        render(<MapScreen snapshot={snapshot} user={user} />);
        fireEvent.click(screen.getByLabelText('Collapse alerts'));
        expect(screen.queryByText('No alerts yet.')).toBeNull();
    });
});
