'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveDeviceView } from '@/lib/types';

// Phones known to the server, refreshed every `intervalMs` while the tab is visible. A failed refresh keeps the last list.
export function useLiveDevices(intervalMs = 3000): { devices: LiveDeviceView[]; error: string | null; refresh(): void }
{
    const [devices, setDevices] = useState<LiveDeviceView[]>([]);
    const [error, setError] = useState<string | null>(null);
    const active = useRef(true);

    const refresh = useCallback(async () =>
    {
        try
        {
            const response = await fetch('/api/live/devices', { cache: 'no-store' });
            if (!response.ok)
            {
                throw new Error(String(response.status));
            }
            const body = await response.json() as { devices: LiveDeviceView[] };
            if (active.current)
            {
                setDevices(body.devices);
                setError(null);
            }
        }
        catch
        {
            if (active.current)
            {
                setError('Could not load phones.');
            }
        }
    }, []);

    useEffect(() =>
    {
        active.current = true;
        void refresh();
        const timer = setInterval(() =>
        {
            if (document.visibilityState === 'visible')
            {
                void refresh();
            }
        }, intervalMs);
        return () =>
        {
            active.current = false;
            clearInterval(timer);
        };
    }, [intervalMs, refresh]);

    return { devices, error, refresh: () => void refresh() };
}
