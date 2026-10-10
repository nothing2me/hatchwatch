'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveDeviceView } from '@/lib/types';

// Phones known to the server, refreshed every `intervalMs` while the tab is visible (null: not polled). A failed refresh keeps the last list.
// `loaded` turns true with the first successful response, so callers never call a device offline before they know.
export function useLiveDevices(intervalMs: number | null = 3000): { devices: LiveDeviceView[]; loaded: boolean; error: string | null; refresh(): void }
{
    const [devices, setDevices] = useState<LiveDeviceView[]>([]);
    const [loaded, setLoaded] = useState(false);
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
                setLoaded(true);
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
        if (intervalMs === null)
        {
            // Paused: forget the list so a later resume never shows an old one.
            setDevices(previous => previous.length > 0 ? [] : previous);
            setLoaded(false);
            return () =>
            {
                active.current = false;
            };
        }
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

    return { devices, loaded, error, refresh: () => void refresh() };
}
