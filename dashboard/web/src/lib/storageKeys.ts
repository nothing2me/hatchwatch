import { LEGACY_STORAGE_KEYS } from '@/lib/legacyNames';

export const STORAGE_KEYS = {
    alertsOpen: 'hatchwatch.alerts.open', legendOpen: 'hatchwatch.legend.open', panelWidth: 'hatchwatch.panel.width',
    phoneName: 'hatchwatch.phoneName', detections: 'hatchwatch.detections',
} as const;

export type StorageKeyName = keyof typeof STORAGE_KEYS;

/** Reads a HatchWatch key; the first read moves an old NestTrace value across and removes the old key. Callers keep their try/catch. */
export function readStored(storage: Storage, name: StorageKeyName): string | null
{
    const key = STORAGE_KEYS[name];
    const value = storage.getItem(key);
    if (value !== null)
    {
        return value;
    }
    const old = storage.getItem(LEGACY_STORAGE_KEYS[name]);
    if (old !== null)
    {
        storage.setItem(key, old);
        storage.removeItem(LEGACY_STORAGE_KEYS[name]);
    }
    return old;
}
