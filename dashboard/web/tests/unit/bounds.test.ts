import { describe, expect, it } from 'vitest';
import { FALLBACK_BOUNDS, fitPadding, initialBounds } from '@/features/map/bounds';
import type { MapSnapshot } from '@/lib/types';

const empty: MapSnapshot = { zones: [], cameras: [], alerts: [], camerasOnline: 0, camerasTotal: 0, activeAlertCount: 0, inactiveCount: 0, outcomes: { saved: 0, notSaved: 0, pending: 0 }, fadeMinutes: 5 };

describe('initialBounds', () =>
{
    it('fits all zone points', () =>
    {
        const snapshot: MapSnapshot = {
            ...empty,
            zones: [
                { id: 'a', code: 'A', name: 'A', activityLevel: 'LOW', ring: [[-97.07, 27.81], [-97.06, 27.81], [-97.06, 27.82], [-97.07, 27.81]] },
                { id: 'b', code: 'B', name: 'B', activityLevel: 'HIGH', ring: [[-97.05, 27.83], [-97.04, 27.83], [-97.05, 27.83]] },
            ],
        };
        expect(initialBounds(snapshot)).toEqual([[-97.07, 27.81], [-97.04, 27.83]]);
    });

    it('also keeps cameras that sit just outside the zones in view', () =>
    {
        const snapshot: MapSnapshot = {
            ...empty,
            zones: [{ id: 'a', code: 'A', name: 'A', activityLevel: 'LOW', ring: [[-97.07, 27.81], [-97.06, 27.81], [-97.06, 27.82], [-97.07, 27.81]] }],
            cameras: [{ id: 'c', code: 'A1', zoneCode: 'A', position: [-97.075, 27.825], headingDeg: 0, fovDeg: 40, rangeM: 100, status: 'ONLINE', calibrated: false, video: null }],
        };
        expect(initialBounds(snapshot)).toEqual([[-97.075, 27.81], [-97.06, 27.825]]);
    });

    it('falls back to a fixed box around Holiday Beach when there are no zones', () =>
    {
        expect(initialBounds(empty)).toEqual([[-97.0705, 27.8100], [-97.0560, 27.8245]]);
        expect(FALLBACK_BOUNDS).toEqual([[-97.0705, 27.8100], [-97.0560, 27.8245]]);
    });

    it('falls back when zones have empty rings', () =>
    {
        const snapshot: MapSnapshot = { ...empty, zones: [{ id: 'a', code: 'A', name: 'A', activityLevel: 'LOW', ring: [] }] };
        const bounds = initialBounds(snapshot);
        expect(bounds.flat().every(Number.isFinite)).toBe(true);
        expect(bounds).toEqual([[-97.0705, 27.8100], [-97.0560, 27.8245]]);
    });
});

describe('fitPadding', () =>
{
    it('clears the top bar, the alerts column and the controls on wide screens', () =>
    {
        const padding = fitPadding(1440, 900);
        expect(padding.top).toBeGreaterThanOrEqual(72);
        expect(padding.left).toBeGreaterThan(300);
        expect(padding.right).toBeGreaterThanOrEqual(60);
    });

    it('keeps the bottom sheet clear on phones without collapsing the map', () =>
    {
        const padding = fitPadding(390, 844);
        expect(padding.left).toBeLessThan(60);
        expect(padding.bottom).toBeGreaterThan(150);
        expect(390 - padding.left - padding.right).toBeGreaterThan(250);
    });
});
