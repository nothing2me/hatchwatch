'use client';

import { useCallback, useEffect, useState } from 'react';
import { readStored, STORAGE_KEYS, type StorageKeyName } from '@/lib/storageKeys';

// Boolean UI preference kept in localStorage. Storage can be blocked or
// cleared, so every access is guarded and the initial value always works.
export function useStoredBoolean(name: StorageKeyName, initial: boolean): [boolean, (next: boolean) => void]
{
    const [value, setValue] = useState(initial);

    useEffect(() =>
    {
        try
        {
            const stored = readStored(localStorage, name);
            if (stored === 'true' || stored === 'false')
            {
                setValue(stored === 'true');
            }
        }
        catch
        {
            // Keep the initial value.
        }
    }, [name]);

    const update = useCallback((next: boolean) =>
    {
        setValue(next);
        try
        {
            localStorage.setItem(STORAGE_KEYS[name], String(next));
        }
        catch
        {
            // Preference just won't persist.
        }
    }, [name]);

    return [value, update];
}
