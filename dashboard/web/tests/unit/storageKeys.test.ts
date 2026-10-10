import { beforeEach, describe, expect, it } from 'vitest';
import { LEGACY_STORAGE_KEYS } from '@/lib/legacyNames';
import { readStored, STORAGE_KEYS } from '@/lib/storageKeys';

// Node tests have no localStorage; a Map-backed Storage behaves the same for these calls.
class MemoryStorage implements Storage
{
    private readonly items = new Map<string, string>();
    get length(): number { return this.items.size; }
    clear(): void { this.items.clear(); }
    getItem(key: string): string | null { return this.items.get(key) ?? null; }
    key(index: number): string | null { return [...this.items.keys()][index] ?? null; }
    removeItem(key: string): void { this.items.delete(key); }
    setItem(key: string, value: string): void { this.items.set(key, String(value)); }
}

let localStorage: Storage;

describe('readStored', () =>
{
    beforeEach(() => { localStorage = new MemoryStorage(); });

    it('moves an old NestTrace value to the HatchWatch key and removes the old key', () =>
    {
        localStorage.setItem('nesttrace.panel.width', '400');
        expect(readStored(localStorage, 'panelWidth')).toBe('400');
        expect(localStorage.getItem('hatchwatch.panel.width')).toBe('400');
        expect(localStorage.getItem('nesttrace.panel.width')).toBeNull();
        expect(readStored(localStorage, 'panelWidth')).toBe('400');
    });

    it('lets a new value win over an old one and leaves the old one alone', () =>
    {
        localStorage.setItem('hatchwatch.detections', 'on');
        localStorage.setItem('nesttrace.detections', 'off');
        expect(readStored(localStorage, 'detections')).toBe('on');
        expect(localStorage.getItem('nesttrace.detections')).toBe('off');
    });

    it('returns null when neither key is set', () =>
    {
        expect(readStored(localStorage, 'phoneName')).toBeNull();
        expect(localStorage.length).toBe(0);
    });

    it('maps every key from the old name to the new one', () =>
    {
        expect(Object.keys(STORAGE_KEYS)).toEqual(Object.keys(LEGACY_STORAGE_KEYS));
        for (const [name, key] of Object.entries(STORAGE_KEYS))
        {
            expect(key).toBe(LEGACY_STORAGE_KEYS[name as keyof typeof STORAGE_KEYS].replace('nesttrace.', 'hatchwatch.'));
        }
    });
});
