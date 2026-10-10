// Pixel maths for the motion view: small grey frames (ANALYSIS_WIDTH wide) so it runs several times a second.
// A viewing aid only, worked out in the browser from the live picture. It is not the digging detector,
// shares nothing with the research pipeline and raises no alerts.

export type MotionMode = 'background' | 'previous';

// Share of the gap to the current frame the background closes per new frame; a still object fades in about 3 s at 5 fps.
export const BACKGROUND_RATE = 0.1;
export const DEFAULT_THRESHOLD = 20;
export const ANALYSIS_WIDTH = 320;

// Grey (0–255) softened with a 3×3 box blur, which hides most JPEG block noise before differencing.
export function toBlurredGray(rgba: Uint8ClampedArray, width: number, height: number): Float32Array
{
    const gray = new Float32Array(width * height);
    for (let pixel = 0, at = 0; pixel < gray.length; pixel++, at += 4)
    {
        gray[pixel] = 0.299 * rgba[at] + 0.587 * rgba[at + 1] + 0.114 * rgba[at + 2];
    }
    const blurred = new Float32Array(gray.length);
    for (let y = 0; y < height; y++)
    {
        for (let x = 0; x < width; x++)
        {
            let sum = 0;
            let count = 0;
            for (let dy = -1; dy <= 1; dy++)
            {
                const row = y + dy;
                if (row < 0 || row >= height)
                {
                    continue;
                }
                for (let dx = -1; dx <= 1; dx++)
                {
                    const column = x + dx;
                    if (column >= 0 && column < width)
                    {
                        sum += gray[row * width + column];
                        count++;
                    }
                }
            }
            blurred[y * width + x] = sum / count;
        }
    }
    return blurred;
}

// True when no new frame arrived since the last check (sampled every 7th pixel).
export function isSameFrame(a: Float32Array | null, b: Float32Array): boolean
{
    if (!a || a.length !== b.length)
    {
        return false;
    }
    for (let pixel = 0; pixel < a.length; pixel += 7)
    {
        if (a[pixel] !== b[pixel])
        {
            return false;
        }
    }
    return true;
}

// Moves the background a step toward the frame, so slow changes (clouds, tide, dusk) and still objects fade into it.
export function updateBackground(background: Float32Array, frame: Float32Array, rate = BACKGROUND_RATE): void
{
    for (let pixel = 0; pixel < frame.length; pixel++)
    {
        background[pixel] += (frame[pixel] - background[pixel]) * rate;
    }
}

// Paints |frame − reference| into RGBA `output`: black below the threshold, amber at it, white at four times it.
// Returns the share of pixels (0–1) at or above the threshold.
export function paintDifference(frame: Float32Array, reference: Float32Array, output: Uint8ClampedArray, threshold: number): number
{
    let moving = 0;
    for (let pixel = 0, at = 0; pixel < frame.length; pixel++, at += 4)
    {
        const change = Math.abs(frame[pixel] - reference[pixel]);
        if (change < threshold)
        {
            output[at] = 0;
            output[at + 1] = 0;
            output[at + 2] = 0;
        }
        else
        {
            moving++;
            const strength = Math.min(1, (change - threshold) / (threshold * 3));
            output[at] = 255;
            output[at + 1] = 120 + 135 * strength;
            output[at + 2] = 255 * strength * strength;
        }
        output[at + 3] = 255;
    }
    return moving / frame.length;
}
