// Pixel math for the motion page. Works on small grayscale frames (a few
// hundred pixels wide) so it runs comfortably many times a second.
//
// Nothing here comes from the research pipeline (see agent.md); this is a
// plain viewing aid for live feeds, not the detector.

// Converts RGBA pixels to grayscale (0-255) and softens them with a 3x3 box
// blur, which hides most JPEG block noise before differencing.
export function toBlurredGray(rgba, width, height)
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

// True when two frames are pixel-for-pixel identical, meaning no new frame
// arrived from the camera since the last check.
export function isSameFrame(first, second)
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

// Moves the background a small step toward the current frame, so slow
// changes (clouds, tide, dusk) fade into it while fast motion stands out.
export function updateBackground(background, frame, learningRate)
{
    for (let pixel = 0; pixel < frame.length; pixel += 1)
    {
        background[pixel] += (frame[pixel] - background[pixel]) * learningRate;
    }
}

// Paints |frame - reference| into `output` (RGBA): black where nothing
// changed, a heat color (amber to white) where the change passes the
// threshold. Returns the share of pixels (0-1) that changed.
export function paintDifference(frame, reference, output, threshold)
{
    let movingPixels = 0;

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
            movingPixels += 1;
            // 0 at the threshold, 1 at a change of 4x the threshold or more.
            const strength = Math.min(1, (change - threshold) / (threshold * 3));
            output[at] = 255;
            output[at + 1] = 120 + 135 * strength;
            output[at + 2] = 255 * strength * strength;
        }

        output[at + 3] = 255;
    }

    return movingPixels / frame.length;
}
