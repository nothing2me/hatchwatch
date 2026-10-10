'use client';

import { useEffect, useState } from 'react';

// Wall clock that re-renders every `intervalMs`, for relative times and ageing pins.
export function useNow(intervalMs = 30_000): number
{
    const [now, setNow] = useState(() => Date.now());
    useEffect(() =>
    {
        const timer = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(timer);
    }, [intervalMs]);
    return now;
}
