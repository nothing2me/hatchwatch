'use client';

import { useCallback, useSyncExternalStore } from 'react';

export const DETECTIONS_KEY = 'nesttrace.detections';

const listeners = new Set<() => void>();
// Used only when localStorage is blocked, so the choice still holds until the page reloads.
let memory = true;

function subscribe(listener: () => void): () => void
{
    listeners.add(listener);
    window.addEventListener('storage', listener);
    return () =>
    {
        listeners.delete(listener);
        window.removeEventListener('storage', listener);
    };
}

function read(): boolean
{
    try
    {
        return window.localStorage.getItem(DETECTIONS_KEY) !== 'off';
    }
    catch
    {
        return memory;
    }
}

// Detections on or off, shared by every tile and the camera panel and remembered in this browser. Default on.
export function useDetectionsToggle(): [boolean, (on: boolean) => void]
{
    const on = useSyncExternalStore(subscribe, read, () => true);
    const set = useCallback((next: boolean) =>
    {
        memory = next;
        try
        {
            window.localStorage.setItem(DETECTIONS_KEY, next ? 'on' : 'off');
        }
        catch
        {
            // Storage blocked: `memory` carries the choice.
        }
        for (const listener of listeners)
        {
            listener();
        }
    }, []);
    return [on, set];
}
