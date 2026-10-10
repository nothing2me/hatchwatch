import { boundsOf } from '@/lib/geo';
import type { LngLat, MapSnapshot } from '@/lib/types';

// Holiday Beach, Port Aransas. Used when no zones are configured so the map
// never receives the infinite bounds boundsOf([]) produces.
export const FALLBACK_BOUNDS: [LngLat, LngLat] = [[-97.0705, 27.8100], [-97.0560, 27.8245]];

// Fits every zone, plus the cameras on the dune line just outside them.
export function initialBounds(snapshot: MapSnapshot): [LngLat, LngLat]
{
    const zonePoints = snapshot.zones.flatMap(zone => zone.ring);
    if (zonePoints.length === 0)
    {
        return FALLBACK_BOUNDS;
    }
    return boundsOf([...zonePoints, ...snapshot.cameras.map(camera => camera.position)]);
}

export interface FitPadding
{
    top: number;
    right: number;
    bottom: number;
    left: number;
}

// Map padding that keeps fitted zones clear of the floating panels: the top bar,
// the alerts column (left, desktop) or bottom sheet (phone), and the controls.
export function fitPadding(width: number, height: number): FitPadding
{
    if (width < 768)
    {
        return { top: 72, right: 60, bottom: Math.round(height * 0.3), left: 24 };
    }
    return { top: 88, right: 88, bottom: 56, left: 336 };
}
