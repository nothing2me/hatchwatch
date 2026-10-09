import type { LngLat } from './types';

const EARTH_RADIUS_M = 6371008.8;
const toRad = (degrees: number) => (degrees * Math.PI) / 180;
const toDeg = (radians: number) => (radians * 180) / Math.PI;

// Great-circle destination from origin along a compass bearing.
export function destinationPoint([lng, lat]: LngLat, bearingDeg: number, distanceM: number): LngLat
{
    const angular = distanceM / EARTH_RADIUS_M;
    const bearing = toRad(bearingDeg);
    const lat1 = toRad(lat);
    const lng1 = toRad(lng);
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
    const lng2 = lng1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
    return [toDeg(lng2), toDeg(lat2)];
}

// Pie-slice polygon for a camera's field of view, as a closed ring.
export function viewCone(origin: LngLat, bearingDeg: number, fovDeg: number, rangeM: number, steps = 16): LngLat[]
{
    const start = bearingDeg - fovDeg / 2;
    const arc: LngLat[] = [];
    for (let i = 0; i <= steps; i++)
    {
        arc.push(destinationPoint(origin, start + (fovDeg * i) / steps, rangeM));
    }
    return [origin, ...arc, origin];
}

export function boundsOf(points: LngLat[]): [LngLat, LngLat]
{
    const lngs = points.map(point => point[0]);
    const lats = points.map(point => point[1]);
    return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

// Nearest 16-point compass name for a bearing in degrees.
export function compassPoint(bearingDeg: number): string
{
    const normalised = ((bearingDeg % 360) + 360) % 360;
    return COMPASS[Math.round(normalised / 22.5) % 16];
}

// Initial great-circle bearing from one point to another, degrees clockwise from north.
export function bearingBetween([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number
{
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δλ = toRad(lng2 - lng1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
