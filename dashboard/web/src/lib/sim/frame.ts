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

const endMarginM = 6;

// Station visit order that keeps each new recording far from the last two (they may still be on the map).
function farApartOrder(count: number): number[]
{
    const order = [0];
    while (order.length < count)
    {
        const recent = order.slice(-2);
        let best = -1;
        let bestGap = -1;
        for (let station = 0; station < count; station++)
        {
            if (order.includes(station)) continue;
            const gap = Math.min(...recent.map(previous => Math.abs(station - previous)));
            if (gap > bestGap)
            {
                best = station;
                bestGap = gap;
            }
        }
        order.push(best);
    }
    return order;
}

// Deterministic number in [0, 1) from a chunk sequence (FNV-1a), for the small placement shift.
function unitFrom(sequence: number): number
{
    let hash = 0x811c9dc5;
    for (const character of `placement:${sequence}`)
    {
        hash ^= character.codePointAt(0)!;
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash / 0x1_0000_0000;
}

/**
 * Along-shore placement of a true-scale recording in its zone. The zone is cut into as many non-overlapping
 * footprint-wide stations as fit (at least one); a zone's successive recordings visit them far-apart first, each
 * shifted a little within its station's spare length, so recordings still on the map rarely overlap.
 */
export function recordingOffsetM(ring: LngLat[], sequence: number, zoneCount: number, groundWidthM: number): number
{
    const usableM = Math.max(0, distanceBetween(ring[0], ring[1]) - 2 * endMarginM);
    const stations = Math.max(1, Math.floor(usableM / Math.max(1, groundWidthM)));
    const visit = Math.floor(sequence / Math.max(1, zoneCount));
    const station = farApartOrder(stations)[visit % stations];
    const spacingM = usableM / stations;
    const centreM = -usableM / 2 + spacingM * (station + 0.5);
    const slackM = Math.max(0, (spacingM - groundWidthM) / 2);
    return centreM + (unitFrom(sequence) * 2 - 1) * slackM;
}

/** Fixed recording stations within a long monitored beach, spaced at true scale. */
export function stationOffsetM(ring: LngLat[], station: number, count = 3, groundWidthM = 24): number
{
    const reachM = Math.max(0, Math.min(90, distanceBetween(ring[0], ring[1]) / 2 - groundWidthM / 2 - 6));
    return count <= 1 ? 0 : -reachM + station * (2 * reachM / (count - 1));
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
