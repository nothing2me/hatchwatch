// Pixel math for the live motion view. Works on small grayscale frames (a few hundred pixels wide)
// so it runs many times a second in the browser. A viewing aid only: nothing is stored or sent,
// and it is not the research detector (see agent.md).

// RGBA -> grayscale (0-255), softened with a 3x3 box blur that hides most compression noise.
export function toBlurredGray(rgba: ArrayLike<number>, width: number, height: number): Float32Array
{
    const gray = new Float32Array(width * height);
    for (let pixel = 0, at = 0; pixel < gray.length; pixel += 1, at += 4)
    {
        gray[pixel] = 0.299 * rgba[at] + 0.587 * rgba[at + 1] + 0.114 * rgba[at + 2];
    }

    const blurred = new Float32Array(gray.length);
    for (let y = 0; y < height; y += 1)
    {
        for (let x = 0; x < width; x += 1)
        {
            let sum = 0;
            let count = 0;
            for (let dy = -1; dy <= 1; dy += 1)
            {
                const row = y + dy;
                if (row < 0 || row >= height)
                {
                    continue;
                }
                for (let dx = -1; dx <= 1; dx += 1)
                {
                    const column = x + dx;
                    if (column >= 0 && column < width)
                    {
                        sum += gray[row * width + column];
                        count += 1;
                    }
                }
            }
            blurred[y * width + x] = sum / count;
        }
    }
    return blurred;
}

// True when two frames match (sampled), meaning no new picture arrived since the last check.
export function isSameFrame(first: Float32Array | null, second: Float32Array): boolean
{
    if (!first || first.length !== second.length)
    {
        return false;
    }
    for (let pixel = 0; pixel < first.length; pixel += 7)
    {
        if (first[pixel] !== second[pixel])
        {
            return false;
        }
    }
    return true;
}

// Moves the background a small step toward the frame, so slow changes (light, tide) fade into it
// while fast motion stands out.
export function updateBackground(background: Float32Array, frame: Float32Array, learningRate: number): void
{
    for (let pixel = 0; pixel < frame.length; pixel += 1)
    {
        background[pixel] += (frame[pixel] - background[pixel]) * learningRate;
    }
}

// Paints |frame - reference| into `output` (RGBA): black where nothing changed, amber to white where
// the change passes the threshold. Returns the share of pixels (0-1) that changed.
export function paintDifference(frame: Float32Array, reference: Float32Array, output: Uint8ClampedArray, threshold: number): number
{
    let moving = 0;
    for (let pixel = 0, at = 0; pixel < frame.length; pixel += 1, at += 4)
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
            moving += 1;
            // 0 at the threshold, 1 at four times the threshold or more.
            const strength = Math.min(1, (change - threshold) / (threshold * 3));
            output[at] = 255;
            output[at + 1] = 120 + 135 * strength;
            output[at + 2] = 255 * strength * strength;
        }
        output[at + 3] = 255;
    }
    return moving / frame.length;
}
