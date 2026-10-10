// React hook that keeps the latest frame of one camera as an image URL.
//
// It asks the relay for the newest frame several times a second with short
// requests instead of holding an MJPEG stream open. Browsers allow only six
// open connections per site over HTTP/1.1, and every open stream used one,
// so a few feeds were enough to stall new pages. It also pauses while the
// tab is hidden, and sends the access key in a header rather than the URL.

import { useEffect, useState } from 'react';
import { fetchLatestFrame } from './liveCameraClient.js';

function wait(milliseconds)
{
    return new Promise(function resolveLater(resolve)
    {
        setTimeout(resolve, milliseconds);
    });
}

// Returns an object URL for the newest frame, or null before the first one.
export function useLiveFrame(cameraIdentifier, accessKey, { framesPerSecond = 5, enabled = true } = {})
{
    const [frameUrl, setFrameUrl] = useState(null);

    useEffect(function followCamera()
    {
        if (!enabled || !cameraIdentifier || !accessKey)
        {
            setFrameUrl(null);
            return undefined;
        }

        let isActive = true;
        // The shown frame and the one before it; older ones are released.
        // Keeping one spare means an <img> still loading the previous frame never loses it.
        let currentUrl = null;
        let previousUrl = null;
        let lastFrameTag = null;
        // randomUUID needs HTTPS; plain-HTTP local viewing falls back to Math.random.
        const viewerId = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
        const interval = 1000 / framesPerSecond;

        async function fetchFrames()
        {
            while (isActive)
            {
                const startedAt = performance.now();

                if (document.visibilityState === 'visible')
                {
                    try
                    {
                        const result = await fetchLatestFrame(cameraIdentifier, accessKey, lastFrameTag, viewerId);

                        // null means the camera has not sent anything new.
                        if (result && isActive)
                        {
                            lastFrameTag = result.frameTag;
                            const newUrl = URL.createObjectURL(result.jpeg);
                            setFrameUrl(newUrl);

                            if (previousUrl)
                            {
                                URL.revokeObjectURL(previousUrl);
                            }

                            previousUrl = currentUrl;
                            currentUrl = newUrl;
                        }
                    }
                    catch
                    {
                        // Network hiccup or camera gone; the status poll reports it. Try again shortly.
                        await wait(1000);
                    }
                }

                await wait(Math.max(0, interval - (performance.now() - startedAt)));
            }
        }

        fetchFrames();

        return function stopFollowing()
        {
            isActive = false;

            for (const url of [previousUrl, currentUrl])
            {
                if (url)
                {
                    URL.revokeObjectURL(url);
                }
            }

            setFrameUrl(null);
        };
    }, [cameraIdentifier, accessKey, framesPerSecond, enabled]);

    return frameUrl;
}
