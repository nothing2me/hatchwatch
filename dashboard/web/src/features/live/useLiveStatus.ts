'use client';

import { useEffect, useState } from 'react';

// Camera code -> the live device assigned to it and whether that device is heartbeating.
export type LiveStatus = Record<string, { deviceId: string; name: string; online: boolean }>;

const EMPTY: LiveStatus = {};

// Polls /api/live/status; keeps the last good answer through network errors.
export function useLiveStatus(intervalMs = 5_000): LiveStatus
{
    const [status, setStatus] = useState<LiveStatus>(EMPTY);

    useEffect(() =>
    {
        let stopped = false;
        const load = async () =>
        {
            try
            {
                const response = await fetch('/api/live/status', { cache: 'no-store' });
                if (response.ok && !stopped)
                {
                    const body = await response.json() as { cameras?: unknown };
                    const cameras = body?.cameras;
                    if (cameras && typeof cameras === 'object' && !Array.isArray(cameras))
                    {
                        setStatus(current => (JSON.stringify(current) === JSON.stringify(cameras) ? current : cameras as LiveStatus));
                    }
                }
            }
            catch
            {
                // Keep showing the last known state.
            }
        };
        void load();
        const timer = setInterval(load, intervalMs);
        return () =>
        {
            stopped = true;
            clearInterval(timer);
        };
    }, [intervalMs]);

    return status;
}
