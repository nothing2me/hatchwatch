// Camera watch-mask geometry. Pure helpers (no I/O), safe in the browser.
//
// Each dashboard camera stores its own mask in normalised 0-1 picture coordinates
// (Camera.maskPolygon). The research runner's file and runner chunks use
// source-frame pixels (1280x720); the pixel helpers below convert between the two.

export type MaskPoint = [number, number];

export const MASK_FRAME: [number, number] = [1280, 720];
export const MAX_MASK_POINTS = 64;
/** Smallest mask area, as a fraction of the picture. */
export const MIN_MASK_AREA = 0.0001;

/** Keeps a polygon inside the source frame; pixels rounded to integers. */
export function clampPolygon(points: readonly [number, number][], frame: readonly [number, number] = MASK_FRAME): [number, number][]
{
    const [width, height] = frame;
    return points.map(([x, y]) => [Math.max(0, Math.min(width, Math.round(x))), Math.max(0, Math.min(height, Math.round(y)))] as [number, number]);
}

/** A mask must be a closed shape inside the frame with enough vertices to draw. */
export function validMaskPoints(points: readonly unknown[], frame: readonly [number, number] = MASK_FRAME): points is [number, number][]
{
    const [width, height] = frame;
    return Array.isArray(points)
        && points.length >= 3
        && points.length <= MAX_MASK_POINTS
        && points.every(point => Array.isArray(point)
            && point.length === 2
            && typeof point[0] === 'number' && Number.isFinite(point[0])
            && typeof point[1] === 'number' && Number.isFinite(point[1])
            && point[0] >= 0 && point[0] <= width
            && point[1] >= 0 && point[1] <= height);
}

/** Frame-size default covering the visible beach strip; the editor lets users reshape it per camera. */
export const DEFAULT_MASK: [number, number][] = [[70, 320], [1210, 320], [1210, 705], [70, 705]];

/** Converts pixel points to 0..1 for a resolution-independent editor canvas. */
export function toNormalized(points: readonly [number, number][], frame: readonly [number, number] = MASK_FRAME): [number, number][]
{
    return points.map(([x, y]) => [x / frame[0], y / frame[1]] as [number, number]);
}

/** Converts editor coordinates back to source-frame pixels. */
export function toPixels(points: readonly [number, number][], frame: readonly [number, number] = MASK_FRAME): [number, number][]
{
    return clampPolygon(points.map(([x, y]) => [x * frame[0], y * frame[1]]));
}

/** Drops a repeated closing point, so [a, b, c, a] and [a, b, c] are the same mask. */
export function openRing(points: readonly MaskPoint[]): MaskPoint[]
{
    const first = points[0];
    const last = points[points.length - 1];
    const closed = points.length > 1 && first[0] === last[0] && first[1] === last[1];
    return (closed ? points.slice(0, -1) : points).map(([x, y]) => [x, y] as MaskPoint);
}

/** Shoelace area, always positive whatever the winding. */
export function polygonArea(points: readonly MaskPoint[]): number
{
    let twice = 0;
    points.forEach(([x1, y1], index) =>
    {
        const [x2, y2] = points[(index + 1) % points.length];
        twice += x1 * y2 - x2 * y1;
    });
    return Math.abs(twice) / 2;
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/** A per-camera mask: 3-64 finite points inside 0-1 (closing repeat allowed) enclosing a non-zero area, judged as stored (rounded). */
export function validCameraMask(value: unknown): value is MaskPoint[]
{
    if (!Array.isArray(value) || !value.every(point => Array.isArray(point)
        && point.length === 2
        && typeof point[0] === 'number' && Number.isFinite(point[0]) && point[0] >= 0 && point[0] <= 1
        && typeof point[1] === 'number' && Number.isFinite(point[1]) && point[1] >= 0 && point[1] <= 1))
    {
        return false;
    }
    // Rounding can merge points or shrink the area, so check the polygon that would be saved.
    const ring = openRing(openRing(value as MaskPoint[]).map(([x, y]) => [round4(x), round4(y)] as MaskPoint));
    return ring.length >= 3 && ring.length <= MAX_MASK_POINTS && polygonArea(ring) >= MIN_MASK_AREA;
}

/** The stored form: open ring, coordinates rounded to 4 decimals. */
export function cleanCameraMask(points: readonly MaskPoint[]): MaskPoint[]
{
    return openRing(openRing(points).map(([x, y]) => [round4(x), round4(y)] as MaskPoint));
}

/** A stored Camera.maskPolygon as a mask, or null (whole picture) when absent or invalid. */
export function asCameraMask(value: unknown): MaskPoint[] | null
{
    return validCameraMask(value) ? openRing(value) : null;
}

/** Starting outline for a new mask: the repository default beach strip, normalised. */
export const DEFAULT_CAMERA_MASK: MaskPoint[] = toNormalized(DEFAULT_MASK);
