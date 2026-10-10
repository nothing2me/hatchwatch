'use client';

import { useEffect, useState } from 'react';
import type { LiveDeviceView } from '@/lib/types';

// Registered live devices for the admin Source picker, refreshed every few seconds while enabled.
export function useLiveDevices(enabled: boolean, intervalMs = 5_000): LiveDeviceView[]
{
    const [devices, setDevices] = useState<LiveDeviceView[]>([]);

    useEffect(() =>
    {
        if (!enabled)
        {
            return undefined;
        }
        let stopped = false;
        const load = async () =>
        {
            try
            {
                const response = await fetch('/api/live/devices', { cache: 'no-store' });
                if (response.ok && !stopped)
                {
                    const body = await response.json() as { devices?: unknown };
                    if (Array.isArray(body?.devices))
                    {
                        const next = body.devices as LiveDeviceView[];
                        setDevices(current => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
                    }
                }
            }
            catch
            {
                // Keep the last list.
            }
        };
        void load();
        const timer = setInterval(load, intervalMs);
        return () =>
        {
            stopped = true;
            clearInterval(timer);
        };
    }, [enabled, intervalMs]);

    return devices;
}
