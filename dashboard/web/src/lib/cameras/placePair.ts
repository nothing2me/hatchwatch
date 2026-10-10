import { bearingBetween, destinationPoint, distanceBetween } from '@/lib/geo';
import type { LngLat, ZoneView } from '@/lib/types';

export interface PairPlan
{
    code: string;
    ring: LngLat[];
    cameras: { code: string; position: LngLat; headingDeg: number }[];
}

export class PlacementError extends Error {}

const ZONE_LENGTH_M = 120;
const ZONE_DEPTH_M = 60;
const MAX_CLICK_DISTANCE_M = 2000;
const SEAWARD_PROBE_M = 30;
// Holiday Beach runs about 39° with the Gulf to the south-east.
const DEFAULT_ALONG = 39;
const DEFAULT_SEAWARD = 129;

// Next single-letter zone code after the highest one in use.
export function nextZoneCode(codes: string[]): string
{
    const letters = codes.filter(code => /^[A-Z]$/.test(code)).map(code => code.charCodeAt(0));
    const highest = letters.length > 0 ? Math.max(...letters) : 'A'.charCodeAt(0) - 1;
    if (highest >= 'Z'.charCodeAt(0))
    {
        throw new PlacementError('No zone letters left (Z is taken).');
    }
    return String.fromCharCode(highest + 1);
}

const corners = (ring: LngLat[]) => (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring);

function centroid(ring: LngLat[]): LngLat
{
    const points = corners(ring);
    return [points.reduce((sum, p) => sum + p[0], 0) / points.length, points.reduce((sum, p) => sum + p[1], 0) / points.length];
}

const midpoint = (a: LngLat, b: LngLat): LngLat => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

const norm = (degrees: number) => ((degrees % 360) + 360) % 360;

// Beach direction and seaward side from the zone nearest the click.
function orientation(click: LngLat, zones: ZoneView[]): { along: number; seaward: number }
{
    const candidates = zones.filter(zone => corners(zone.ring).length >= 4);
    if (candidates.length === 0)
    {
        return { along: DEFAULT_ALONG, seaward: DEFAULT_SEAWARD };
    }
    const nearest = candidates
        .map(zone => ({ zone, distance: distanceBetween(click, centroid(zone.ring)) }))
        .sort((a, b) => a.distance - b.distance)[0];
    if (nearest.distance > MAX_CLICK_DISTANCE_M)
    {
        throw new PlacementError('Click closer to the beach');
    }
    const ring = nearest.zone.ring;
    const along = bearingBetween(ring[1], ring[0]);
    const seaMid = midpoint(ring[2], ring[3]);
    const [left, right] = [norm(along - 90), norm(along + 90)];
    const closer = (bearing: number) => distanceBetween(destinationPoint(click, bearing, SEAWARD_PROBE_M), seaMid);
    return { along, seaward: closer(right) <= closer(left) ? right : left };
}

// A new 120 m × 60 m zone whose land edge is centred on the click, with a camera
// at each land-edge end looking at the zone's centre (so out to sea).
export function planCameraPair(click: LngLat, zones: ZoneView[], codes: string[]): PairPlan
{
    const { along, seaward } = orientation(click, zones);
    const code = nextZoneCode(codes);
    const half = ZONE_LENGTH_M / 2;
    const landNorth = destinationPoint(click, along, half);
    const landSouth = destinationPoint(click, along + 180, half);
    const seaSouth = destinationPoint(landSouth, seaward, ZONE_DEPTH_M);
    const seaNorth = destinationPoint(landNorth, seaward, ZONE_DEPTH_M);
    const ring: LngLat[] = [landNorth, landSouth, seaSouth, seaNorth, landNorth];
    const centre = centroid(ring);
    return {
        code,
        ring,
        cameras: [
            { code: `${code}1`, position: landNorth, headingDeg: bearingBetween(landNorth, centre) },
            { code: `${code}2`, position: landSouth, headingDeg: bearingBetween(landSouth, centre) },
        ],
    };
}
