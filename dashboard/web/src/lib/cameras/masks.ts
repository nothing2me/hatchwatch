// Per-camera watch-mask geometry (source-frame pixels, 1280x720).
//
// A mask is the operator-drawn beach area a camera should watch: motion signals
// are computed only inside it at extraction. Pure helpers here (no I/O) are
// unit-testable; the shared file lives in the PUBLIC artifacts dir
// artifacts/public/camera-masks.json, read by the runner and edited by admins.

export const MASK_FRAME: [number, number] = [1280, 720];
export const MAX_MASK_POINTS = 32;

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