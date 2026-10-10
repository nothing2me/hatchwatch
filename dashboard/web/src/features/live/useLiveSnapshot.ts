'use client';

import { useEffect, useState } from 'react';
import type { MapSnapshot } from '@/lib/types';

const DEBOUNCE_MS = 300;

// Server pushes "something changed"; the client pulls the whole snapshot again.
// EventSource reconnects on its own; a reopened stream re-fetches in case changes were missed.
export function useLiveSnapshot(initial: MapSnapshot): MapSnapshot
{
    const [snapshot, setSnapshot] = useState(initial);

    useEffect(() =>
    {
        if (typeof EventSource === 'undefined')
        {
            return undefined;
        }
        let timer: ReturnType<typeof setTimeout> | null = null;
        let requested = 0;
        let applied = 0;
        let opened = false;
        let disposed = false;

        const refresh = async () =>
        {
            const sequence = ++requested;
            try
            {
                const response = await fetch('/api/snapshot', { cache: 'no-store' });
                if (!response.ok)
                {
                    return;
                }
                const next = await response.json() as MapSnapshot;
                // A slow older response must not overwrite a newer one.
                if (!disposed && sequence > applied)
                {
                    applied = sequence;
                    setSnapshot(next);
                }
            }
            catch
            {
                // Offline or signed out: keep the last snapshot; the next change retries.
            }
        };
        const schedule = () =>
        {
            if (timer)
            {
                clearTimeout(timer);
            }
            timer = setTimeout(() => { timer = null; void refresh(); }, DEBOUNCE_MS);
        };

        const source = new EventSource('/api/stream');
        source.onopen = () =>
        {
            if (opened)
            {
                schedule();
            }
            opened = true;
        };
        source.onmessage = event =>
        {
            try
            {
                if ((JSON.parse(event.data) as { type?: string }).type === 'snapshot')
                {
                    schedule();
                }
            }
            catch
            {
                // Not ours; ignore.
            }
        };

        return () =>
        {
            disposed = true;
            if (timer)
            {
                clearTimeout(timer);
            }
            source.close();
        };
    }, []);

    return snapshot;
}
