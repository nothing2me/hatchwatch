import { bearingBetween, destinationPoint } from '@/lib/geo';
import type { LngLat, ZoneView } from '@/lib/types';

export class PlacementError extends Error {}

export interface PairPlan
{
    cameras: { code: string; position: LngLat; headingDeg: number }[];
}

// Cameras in a new pair stand this far apart along the shore, centred on the click.
const PAIR_SPACING_M = 40;
export const MAX_CLICK_DISTANCE_M = 2000;
// Holiday Beach runs about 39° with the Gulf to the south-east (used only for a degenerate ring).
const DEFAULT_ALONG = 39;
// Cameras look out to sea, turned this far toward their partner (spec §7: seaward ± 20°).
const TOE_IN_DEG = 20;
const EARTH_RADIUS_M = 6371008.8;
const CAMERA_CODE = /^([A-Z])([0-9]{1,2})$/;

const norm = (degrees: number) => ((degrees % 360) + 360) % 360;
const angleGap = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const midpoint = (a: LngLat, b: LngLat): LngLat => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const corners = (ring: LngLat[]) => (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring);

// Beach direction and seaward bearing of a zone. Rings run land-north, land-south, sea-south, sea-north.
export function zoneOrientation(zone: ZoneView): { along: number; seaward: number }
{
    const ring = corners(zone.ring);
    if (ring.length < 4)
    {
        return { along: DEFAULT_ALONG, seaward: norm(DEFAULT_ALONG + 90) };
    }
    const along = bearingBetween(ring[1], ring[0]);
    const toSea = bearingBetween(midpoint(ring[0], ring[1]), midpoint(ring[2], ring[3]));
    const [left, right] = [norm(along - 90), norm(along + 90)];
    return { along, seaward: angleGap(right, toSea) <= angleGap(left, toSea) ? right : left };
}

// Seaward bearing turned TOE_IN_DEG toward a partner camera (or point), whichever side gets closer to it.
export function seawardToward(position: LngLat, toward: LngLat, seaward: number): number
{
    const target = bearingBetween(position, toward);
    const [plus, minus] = [norm(seaward + TOE_IN_DEG), norm(seaward - TOE_IN_DEG)];
    return angleGap(plus, target) <= angleGap(minus, target) ? plus : minus;
}

// Local flat metres around a reference latitude; fine over the few kilometres of a beach.
function toMetres([lng, lat]: LngLat, refLat: number): [number, number]
{
    const k = Math.PI / 180;
    return [lng * k * Math.cos(refLat * k) * EARTH_RADIUS_M, lat * k * EARTH_RADIUS_M];
}

function segmentDistance(p: [number, number], a: [number, number], b: [number, number]): number
{
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const length2 = dx * dx + dy * dy;
    const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// Metres from a point to a zone outline; 0 inside it.
export function distanceToZone(point: LngLat, zone: ZoneView): number
{
    const ring = corners(zone.ring);
    if (ring.length === 0)
    {
        return Infinity;
    }
    const p = toMetres(point, point[1]);
    const pts = ring.map(corner => toMetres(corner, point[1]));
    let inside = false;
    let best = Infinity;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    {
        const [a, b] = [pts[i], pts[j]];
        if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0])
        {
            inside = !inside;
        }
        best = Math.min(best, segmentDistance(p, a, b));
    }
    return inside && pts.length >= 3 ? 0 : best;
}

// The zone whose outline is closest to the click; refuses clicks more than 2 km from every zone.
export function nearestZone(click: LngLat, zones: ZoneView[]): ZoneView
{
    const ranked = zones
        .map(zone => ({ zone, distance: distanceToZone(click, zone) }))
        .sort((a, b) => a.distance - b.distance || a.zone.code.localeCompare(b.zone.code));
    if (ranked.length === 0 || ranked[0].distance > MAX_CLICK_DISTANCE_M)
    {
        throw new PlacementError('Click closer to the beach');
    }
    return ranked[0].zone;
}

// Next free camera numbers in a zone: D1, D2 in use gives D3, D4.
export function nextCameraCodes(zoneCode: string, existingCodes: string[], count: number): string[]
{
    const numbers = existingCodes
        .map(code => CAMERA_CODE.exec(code))
        .filter((match): match is RegExpExecArray => match !== null && match[1] === zoneCode)
        .map(match => Number(match[2]));
    const start = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;
    if (start + count - 1 > 99)
    {
        throw new PlacementError(`Zone ${zoneCode} has no camera numbers left.`);
    }
    return Array.from({ length: count }, (_, i) => `${zoneCode}${start + i}`);
}

// Two cameras 40 m apart along the zone's shore direction, centred on the click,
// both facing the sea, each turned 20° toward the other.
export function planPairOnZone(click: LngLat, zone: ZoneView, existingCodes: string[]): PairPlan
{
    const { along, seaward } = zoneOrientation(zone);
    const [northCode, southCode] = nextCameraCodes(zone.code, existingCodes, 2);
    const north = destinationPoint(click, along, PAIR_SPACING_M / 2);
    const south = destinationPoint(click, along + 180, PAIR_SPACING_M / 2);
    return {
        cameras: [
            { code: northCode, position: north, headingDeg: seawardToward(north, south, seaward) },
            { code: southCode, position: south, headingDeg: seawardToward(south, north, seaward) },
        ],
    };
}

// The other camera of a pair: odd numbers pair with the next even one (B1·B2, D3·D4).
export function partnerCode(code: string): string | null
{
    const match = CAMERA_CODE.exec(code);
    if (!match)
    {
        return null;
    }
    const n = Number(match[2]);
    return `${match[1]}${n % 2 === 1 ? n + 1 : n - 1}`;
}
