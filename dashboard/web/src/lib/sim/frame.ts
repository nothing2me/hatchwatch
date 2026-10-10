import { bearingBetween, destinationPoint, distanceBetween } from '@/lib/geo';
import type { LngLat } from '@/lib/types';

export interface ZoneFrame
{
    origin: LngLat;
    alongBearing: number;
}

// Simulator ground frame placed on a zone: x along the shore (land-north → land-south, so sim camera-0 at -x sits at the <pair>1 end),
// y inland, true scale, origin at the corner centroid.
export function zoneFrame(ring: LngLat[]): ZoneFrame
{
    const corners = ring.slice(0, 4);
    const origin: LngLat = [
        corners.reduce((sum, point) => sum + point[0], 0) / corners.length,
        corners.reduce((sum, point) => sum + point[1], 0) / corners.length,
    ];
    return { origin, alongBearing: bearingBetween(ring[0], ring[1]) };
}

/** Shift a true-scale recording along the shore without changing its 24 m camera footprint. */
export function shiftedZoneFrame(frame: ZoneFrame, offsetM: number): ZoneFrame
{
    if (offsetM === 0) return frame;
    return { ...frame, origin: destinationPoint(frame.origin, offsetM > 0 ? frame.alongBearing : frame.alongBearing + 180, Math.abs(offsetM)) };
}

/** Low-discrepancy placement for repeated demonstration clips in a long zone. */
export function recordingOffsetM(ring: LngLat[], sequence: number, zoneCount: number, groundWidthM: number): number
{
    const lengthM = distanceBetween(ring[0], ring[1]);
    const reachM = Math.max(0, lengthM / 2 - groundWidthM / 2 - 6);
    const visit = Math.floor(sequence / Math.max(1, zoneCount));
    const fraction = ((visit + 1) * 0.6180339887498949) % 1;
    return (fraction * 2 - 1) * reachM;
}

export function simPointToLngLat(frame: ZoneFrame, [x, y]: [number, number]): LngLat
{
    if (x === 0 && y === 0)
    {
        return frame.origin;
    }
    const along = x === 0 ? frame.origin : destinationPoint(frame.origin, x >= 0 ? frame.alongBearing : frame.alongBearing + 180, Math.abs(x));
    return y === 0 ? along : destinationPoint(along, y >= 0 ? frame.alongBearing + 90 : frame.alongBearing - 90, Math.abs(y));
}
