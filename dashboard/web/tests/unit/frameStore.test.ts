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

    it('keeps the board motion beside the newest frame and drops it with the frame', () =>
    {
        const store = new FrameStore();
        const moving = { percent: 4.2, active: true, box: [1, 2, 3, 4] as [number, number, number, number] };
        store.put('b1', jpeg(1), 1_000, moving);
        expect(store.motion('b1', 1_000)).toEqual({ ...moving, at: 1_000 });
        store.put('b1', jpeg(2), 1_200);
        expect(store.motion('b1', 1_200)).toBeNull();
        store.put('b1', jpeg(3), 1_400, moving);
        expect(store.motion('b1', 1_400 + 10_001)).toBeNull();
        for (let i = 0; i < 10; i++) store.put('b2', jpeg(i), 2_000 + i, moving);
        expect(store.put('b2', jpeg(99), 2_050, { ...moving, percent: 50 }).ok).toBe(false);
        expect(store.motion('b2', 2_050)?.percent).toBe(4.2);
    });

    it('keeps detections beside the newest frame, across new frames, and drops them with the device', () =>
    {
        const store = new FrameStore();
        const result = (at: number) => ({ at, dark: false, width: 320, height: 240, objects: [], trails: [] });
        expect(store.putDetections('d1', result(1_000), 1_000)).toBe('offline');
        store.put('d1', jpeg(1), 1_000);
        expect(store.putDetections('d1', result(1_000), 1_100)).toBe('stored');
        expect(store.putDetections('d1', result(1_000), 1_200)).toBe('stale');
        store.put('d1', jpeg(2), 1_500);
        expect(store.detections('d1', 1_600)).toEqual(result(1_000));
        // A stopped worker: the device keeps sending, but no result for more than 10 s → null ("Detection off").
        store.put('d1', jpeg(3), 11_200);
        expect(store.detections('d1', 11_100)).toEqual(result(1_000));
        expect(store.detections('d1', 11_200)).toBeNull();
        // An offline device has none, whatever was stored.
        expect(store.putDetections('d1', result(11_200), 11_300)).toBe('stored');
        expect(store.detections('d1', 11_300)).toEqual(result(11_200));
        expect(store.detections('d1', 11_200 + 10_001)).toBeNull();
        store.forget('d1');
        expect(store.detections('d1', 11_300)).toBeNull();
    });
});
