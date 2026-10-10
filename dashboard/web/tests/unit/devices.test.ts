import { describe, expect, it } from 'vitest';
import { DEVICE_ONLINE_MS, isDeviceOnline } from '@/lib/live/devices';

describe('isDeviceOnline', () =>
{
    const now = new Date('2026-10-09T20:00:00Z');
    it('is online within 15 s of the last heartbeat', () =>
    {
        expect(DEVICE_ONLINE_MS).toBe(15_000);
        expect(isDeviceOnline(new Date(now.getTime() - 14_999), now)).toBe(true);
        expect(isDeviceOnline(new Date(now.getTime() - 15_001), now)).toBe(false);
    });
});
