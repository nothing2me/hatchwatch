'use client';

import { useCallback, useEffect, useState } from 'react';

// Boolean UI preference kept in localStorage. Storage can be blocked or
// cleared, so every access is guarded and the initial value always works.
export function useStoredBoolean(key: string, initial: boolean): [boolean, (next: boolean) => void]
{
    const [value, setValue] = useState(initial);

    useEffect(() =>
    {
        try
        {
            const stored = localStorage.getItem(key);
            if (stored === 'true' || stored === 'false')
            {
                setValue(stored === 'true');
            }
        }
        catch
        {
            // Keep the initial value.
        }
    }, [key]);

    const update = useCallback((next: boolean) =>
    {
        setValue(next);
        try
        {
            localStorage.setItem(key, String(next));
        }
        catch
        {
            // Preference just won't persist.
        }
    }, [key]);

    return [value, update];
}
