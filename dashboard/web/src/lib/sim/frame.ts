import { bearingBetween, destinationPoint } from '@/lib/geo';
import type { LngLat } from '@/lib/types';

export interface ZoneFrame
{
    origin: LngLat;
    alongBearing: number;
}

// Simulator ground frame placed on a zone: x along the shore (land-south → land-north),
// y inland, true scale, origin at the corner centroid.
export function zoneFrame(ring: LngLat[]): ZoneFrame
{
    const corners = ring.slice(0, 4);
    const origin: LngLat = [
        corners.reduce((sum, point) => sum + point[0], 0) / corners.length,
        corners.reduce((sum, point) => sum + point[1], 0) / corners.length,
    ];
    return { origin, alongBearing: bearingBetween(ring[1], ring[0]) };
}

export function simPointToLngLat(frame: ZoneFrame, [x, y]: [number, number]): LngLat
{
    if (x === 0 && y === 0)
    {
        return frame.origin;
    }
    const along = x === 0 ? frame.origin : destinationPoint(frame.origin, x >= 0 ? frame.alongBearing : frame.alongBearing + 180, Math.abs(x));
    return y === 0 ? along : destinationPoint(along, y >= 0 ? frame.alongBearing - 90 : frame.alongBearing + 90, Math.abs(y));
}
