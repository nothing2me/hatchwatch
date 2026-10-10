'use client';

import { useEffect, useState } from 'react';
import { FramePoller, type LiveFrameState } from './framePoller';

const RETRY_MS = 1000;

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// The newest frame of one phone as an object URL, polled about `fps` times a second while the tab is visible.
export function useLiveFrame(deviceId: string | null, fps = 5): { url: string | null; state: LiveFrameState | 'idle' }
{
    // Keyed by device so a switch never shows the previous phone's (revoked) picture.
    const [frame, setFrame] = useState<{ deviceId: string | null; url: string | null; state: LiveFrameState }>({ deviceId: null, url: null, state: 'loading' });

    useEffect(() =>
    {
        if (!deviceId)
        {
            return;
        }
        let active = true;
        const poller = new FramePoller(deviceId, {
            fetch: (input, init) => fetch(input, init),
            createObjectURL: blob => URL.createObjectURL(blob),
            revokeObjectURL: url => URL.revokeObjectURL(url),
        });

        async function loop()
        {
            while (active)
            {
                const started = performance.now();
                if (document.visibilityState === 'visible')
                {
                    try
                    {
                        if (await poller.poll() && active)
                        {
                            setFrame({ deviceId, url: poller.url, state: poller.state });
                        }
                    }
                    catch
                    {
                        // A network error looks the same as a phone that stopped sending.
                        poller.state = 'offline';
                        if (active)
                        {
                            setFrame(previous => previous.deviceId === deviceId && previous.state === 'offline' ? previous : { deviceId, url: poller.url, state: 'offline' });
                        }
                    }
                }
                const live = poller.state === 'live' || poller.state === 'loading';
                await wait(live ? Math.max(0, 1000 / fps - (performance.now() - started)) : RETRY_MS);
            }
        }
        void loop();

        return () =>
        {
            active = false;
            poller.stop();
        };
    }, [deviceId, fps]);

    if (!deviceId)
    {
        return { url: null, state: 'idle' };
    }
    return frame.deviceId === deviceId ? { url: frame.url, state: frame.state } : { url: null, state: 'loading' };
}
