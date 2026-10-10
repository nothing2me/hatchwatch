'use client';

import { useCallback, useEffect, useState } from 'react';

export const PANEL_MIN = 304;
export const PANEL_MAX = 720;
export const PANEL_STEP = 24;
const KEY = 'nesttrace.panel.width';

export function clampWidth(value: number): number
{
    if (!Number.isFinite(value))
    {
        return PANEL_MIN;
    }
    return Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(value)));
}

// Camera panel width, remembered per browser. Storage can be blocked, so every access is guarded.
export function usePanelWidth(): { width: number; setWidth: (next: number) => void; nudge: (delta: number) => void }
{
    const [width, setState] = useState(PANEL_MIN);

    useEffect(() =>
    {
        try
        {
            const stored = localStorage.getItem(KEY);
            if (stored !== null && Number.isFinite(Number(stored)))
            {
                setState(clampWidth(Number(stored)));
            }
        }
        catch
        {
            // Keep the default width.
        }
    }, []);

    const setWidth = useCallback((next: number) =>
    {
        const clamped = clampWidth(next);
        setState(clamped);
        try
        {
            localStorage.setItem(KEY, String(clamped));
        }
        catch
        {
            // Width just won't persist.
        }
    }, []);

    const nudge = useCallback((delta: number) =>
    {
        setState(current =>
        {
            const next = clampWidth(current + delta);
            try
            {
                localStorage.setItem(KEY, String(next));
            }
            catch
            {
                // Width just won't persist.
            }
            return next;
        });
    }, []);

    return { width, setWidth, nudge };
}
