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
// A click this close to a zone (or inside it) adds a pair to that zone; farther from every zone it starts a new one.
export const JOIN_DISTANCE_M = 150;
// A zone made from a click: this long along the shore, this deep toward the sea, land edge centred on the click.
export const NEW_ZONE_LENGTH_M = 120;
export const NEW_ZONE_DEPTH_M = 60;
// Holiday Beach runs about 39° with the Gulf to the south-east (used only for a degenerate ring).
const DEFAULT_ALONG = 39;
const DEFAULT_SEAWARD = 129;
// Cameras look out to sea, turned this far toward their partner (spec §7: seaward ± 20°).
const TOE_IN_DEG = 20;
const EARTH_RADIUS_M = 6371008.8;
const CAMERA_CODE = /^([A-Z])([1-9][0-9]?)$/;

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

export type Placement = { kind: 'join'; zone: ZoneView } | { kind: 'new' };

// Join the closest zone when the click is inside it or within 150 m of its outline; otherwise make a new zone there.
export function placementFor(click: LngLat, zones: ZoneView[]): Placement
{
    const [closest] = zones
        .map(zone => ({ zone, distance: distanceToZone(click, zone) }))
        .sort((a, b) => a.distance - b.distance || a.zone.code.localeCompare(b.zone.code));
    return closest && closest.distance <= JOIN_DISTANCE_M ? { kind: 'join', zone: closest.zone } : { kind: 'new' };
}

// The letter after the highest single-letter zone code (A–D gives E); multi-letter codes are ignored.
export function nextZoneCode(zoneCodes: string[]): string
{
    const letters = zoneCodes.filter(code => /^[A-Z]$/.test(code)).map(code => code.charCodeAt(0));
    const highest = letters.length > 0 ? Math.max(...letters) : 'A'.charCodeAt(0) - 1;
    if (highest >= 'Z'.charCodeAt(0))
    {
        throw new PlacementError('Zone Z already exists, so there is no letter left for a new zone. Merge or delete a map-made zone first.');
    }
    return String.fromCharCode(highest + 1);
}

function edges(ring: LngLat[]): [LngLat, LngLat][]
{
    const points = corners(ring);
    return points.map((point, i) => [point, points[(i + 1) % points.length]] as [LngLat, LngLat]);
}

function crosses([a, b]: [LngLat, LngLat], [c, d]: [LngLat, LngLat]): boolean
{
    const side = (p: LngLat, q: LngLat, r: LngLat) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

function inside(point: LngLat, ring: LngLat[]): boolean
{
    const points = corners(ring);
    let result = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++)
    {
        const [a, b] = [points[i], points[j]];
        if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0])
        {
            result = !result;
        }
    }
    return result;
}

// Whether two zone outlines share any ground: crossing edges, or one inside the other.
export function zonesOverlap(a: LngLat[], b: LngLat[]): boolean
{
    if (corners(a).length < 3 || corners(b).length < 3)
    {
        return false;
    }
    return edges(a).some(edge => edges(b).some(other => crosses(edge, other)))
        || corners(a).some(point => inside(point, b))
        || corners(b).some(point => inside(point, a));
}

export interface NewZonePlan extends PairPlan
{
    code: string;
    ring: LngLat[];
}

function overlapCheck(ring: LngLat[], zones: ZoneView[])
{
    const hit = zones.find(zone => zonesOverlap(ring, zone.ring));
    if (hit)
    {
        throw new PlacementError(`Too close to Zone ${hit.code} — click inside it to join, or further away for a new zone`);
    }
}

// A new zone at a click: a 120 m × 60 m rectangle with its land edge centred on the click, shore and sea directions
// copied from the nearest zone (Holiday Beach's 39°/129° with none). Ring: land-north, land-south, sea-south,
// sea-north, land-north, like the seeded zones. Its cameras <code>1 and <code>2 stand on the land edge 40 m apart.
export function planNewZone(click: LngLat, zones: ZoneView[], zoneCodes: string[], cameraCodes: string[]): NewZonePlan
{
    const [nearest] = [...zones].sort((a, b) => distanceToZone(click, a) - distanceToZone(click, b));
    const { along, seaward } = nearest ? zoneOrientation(nearest) : { along: DEFAULT_ALONG, seaward: DEFAULT_SEAWARD };
    const landNorth = destinationPoint(click, along, NEW_ZONE_LENGTH_M / 2);
    const landSouth = destinationPoint(click, along + 180, NEW_ZONE_LENGTH_M / 2);
    const ring: LngLat[] = [landNorth, landSouth, destinationPoint(landSouth, seaward, NEW_ZONE_DEPTH_M), destinationPoint(landNorth, seaward, NEW_ZONE_DEPTH_M), landNorth];
    overlapCheck(ring, zones);
    const code = nextZoneCode(zoneCodes);
    const pair = planPairOnZone(click, { id: '', code, name: '', activityLevel: 'LOW', ring }, cameraCodes);
    return { code, ring, cameras: pair.cameras };
}

// Moves a zone outline and its cameras by the offset between two points (degrees; metres barely change over a beach).
export function translateZone(ring: LngLat[], points: LngLat[], from: LngLat, to: LngLat): { ring: LngLat[]; points: LngLat[] }
{
    const [dLng, dLat] = [to[0] - from[0], to[1] - from[1]];
    const shift = ([lng, lat]: LngLat): LngLat => [lng + dLng, lat + dLat];
    return { ring: ring.map(shift), points: points.map(shift) };
}

// Refuses a moved outline that would overlap another zone.
export function checkZoneClear(ring: LngLat[], others: ZoneView[])
{
    overlapCheck(ring, others);
}
