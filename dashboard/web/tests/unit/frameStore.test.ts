import { describe, expect, it } from 'vitest';
import { FrameStore, MAX_FRAME_BYTES, MAX_FRAMES_PER_SECOND, ONLINE_MS, TOUCH_EVERY_MS } from '@/lib/phones/frameStore';

const jpeg = (n: number) => Buffer.from([0xff, 0xd8, n]);

describe('FrameStore', () =>
{
    it('pins the spec limits', () =>
    {
        expect(MAX_FRAME_BYTES).toBe(500 * 1024);
        expect(MAX_FRAMES_PER_SECOND).toBe(10);
        expect(ONLINE_MS).toBe(10_000);
        expect(TOUCH_EVERY_MS).toBe(5_000);
    });

    it('keeps only the newest frame per device', () =>
    {
        const store = new FrameStore();
        store.put('d1', jpeg(1), 1_000);
        store.put('d1', jpeg(2), 1_200);
        store.put('d2', jpeg(9), 1_300);
        expect(store.latest('d1', 1_300)).toEqual({ jpeg: jpeg(2), at: 1_200 });
        expect(store.latest('d2', 1_300)?.jpeg).toEqual(jpeg(9));
    });

    it('goes offline 10 s after the last frame', () =>
    {
        const store = new FrameStore();
        store.put('d1', jpeg(1), 0);
        expect(store.latest('d1', 9_999)).not.toBeNull();
        expect(store.isOnline('d1', 10_000)).toBe(true);
        expect(store.latest('d1', 10_001)).toBeNull();
        expect(store.onlineIds(10_001)).toEqual([]);
        expect(store.lastFrameAt('d1')).toBe(0);
    });

    it('accepts 10 frames in any one second per device and refuses the 11th', () =>
    {
        const store = new FrameStore();
        for (let i = 0; i < 10; i++)
        {
            expect(store.put('d1', jpeg(i), 5_000 + i * 50).ok).toBe(true);
        }
        expect(store.put('d1', jpeg(10), 5_500)).toEqual({ ok: false, reason: 'rate' });
        expect(store.latest('d1', 5_500)?.jpeg).toEqual(jpeg(9));
        expect(store.put('d1', jpeg(11), 6_001).ok).toBe(true);
        expect(store.put('d2', jpeg(0), 5_500).ok).toBe(true);
    });

    it('asks for a lastSeenAt write at most once per 5 s', () =>
    {
        const store = new FrameStore();
        const touches = [0, 1_000, 4_999, 5_000, 9_000, 10_100].map(t =>
        {
            const result = store.put('d1', jpeg(0), t);
            return result.ok && result.touch;
        });
        expect(touches).toEqual([true, false, false, true, false, true]);
    });

    it('gives every stored frame a strictly later time so ETags change', () =>
    {
        const store = new FrameStore();
        const a = store.put('d1', jpeg(1), 2_000);
        const b = store.put('d1', jpeg(2), 2_000);
        expect(a.ok && b.ok && b.at > a.at).toBe(true);
    });

    it('forgets a removed device and prunes devices silent for a minute', () =>
    {
        const store = new FrameStore();
        store.put('d1', jpeg(1), 0);
        store.put('d2', jpeg(1), 0);
        store.forget('d1');
        expect(store.latest('d1', 1)).toBeNull();
        store.onlineIds(60_001);
        expect(store.lastFrameAt('d2')).toBeNull();
    });
});
