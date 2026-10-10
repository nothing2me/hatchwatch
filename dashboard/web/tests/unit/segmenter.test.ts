import { describe, expect, it } from 'vitest';
import { Segmenter, type SegmentStart, type SegmenterOptions } from '@/lib/phones/segmenter';
import { fakeJpeg } from './aviTestUtils';

const T0 = Date.UTC(2026, 9, 10, 7, 5, 9);
const meta = { deviceName: 'Dune phone', cameraCode: 'E1' };

function harness(overrides: Partial<SegmenterOptions> = {})
{
    const segments: { start: SegmentStart; frames: number[]; closed: number | null }[] = [];
    const segmenter = new Segmenter({
        fps: 5, segmentMs: 600_000, maxGapMs: 10_000, maxBytes: 900 * 1024 * 1024, ...overrides,
        open(start)
        {
            const record = { start, frames: [] as number[], closed: null as number | null };
            segments.push(record);
            return { bytes: 0, write: jpeg => record.frames.push(jpeg[jpeg.length - 1]), close: count => { record.closed = count; } };
        },
    });
    const add = (tag: number, at: number, m = meta, size: [number, number] = [960, 540]) => segmenter.addFrame('d1', fakeJpeg(size[0], size[1], tag), at, m);
    return { segmenter, segments, add };
}

describe('Segmenter', () =>
{
    it('lays frames on a 5 fps wall-clock timeline, repeating the newest frame into empty slots', () =>
    {
        const { segments, add } = harness();
        add(1, T0);
        add(2, T0 + 100);   // same 200 ms slot: not written, but becomes the newest frame
        add(3, T0 + 600);   // slot 3: slots 1 and 2 repeat frame 2
        expect(segments).toHaveLength(1);
        expect(segments[0].frames).toEqual([1, 2, 2, 3]);
        expect(segments[0].start).toMatchObject({ deviceId: 'd1', startedAt: T0, fps: 5, width: 960, height: 540, deviceName: 'Dune phone', cameraCode: 'E1' });
    });

    it('fills a 10 s gap but closes the segment on a longer one', () =>
    {
        const { segments, add } = harness();
        add(1, T0);
        add(2, T0 + 10_000);
        expect(segments[0].frames).toHaveLength(51);
        expect(segments[0].frames.slice(-2)).toEqual([1, 2]);
        add(3, T0 + 20_001);
        expect(segments[0].closed).toBe(51);
        expect(segments[1].start.startedAt).toBe(T0 + 20_001);
        expect(segments[1].frames).toEqual([3]);
    });

    it('starts a new file every 10 minutes', () =>
    {
        const { segments, add } = harness();
        for (let t = 0; t <= 600_000; t += 200)
        {
            add(t / 200 % 250, T0 + t);
        }
        expect(segments).toHaveLength(2);
        expect(segments[0].closed).toBe(3000);
        expect(segments[1].start.startedAt).toBe(T0 + 600_000);
    });

    it('keeps the camera code from the segment start, and splits on a new picture size', () =>
    {
        const { segments, add } = harness();
        add(1, T0);
        add(2, T0 + 200, { deviceName: 'Dune phone', cameraCode: 'B1' });
        expect(segments[0].start.cameraCode).toBe('E1');
        add(3, T0 + 400, meta, [1280, 720]);
        expect(segments).toHaveLength(2);
        expect(segments[0].closed).toBe(2);
        expect(segments[1].start).toMatchObject({ width: 1280, height: 720 });
    });

    it('closes idle segments after 10 s of silence, and all of them on shutdown', () =>
    {
        const { segmenter, segments, add } = harness();
        add(1, T0);
        segmenter.closeIdle(T0 + 10_000);
        expect(segmenter.isRecording('d1')).toBe(true);
        segmenter.closeIdle(T0 + 10_001);
        expect(segmenter.isRecording('d1')).toBe(false);
        expect(segments[0].closed).toBe(1);
        add(2, T0 + 20_000);
        segmenter.closeAll();
        expect(segments[1].closed).toBe(1);
    });

    it('rolls over before a segment passes the size cap, and ignores non-JPEG input', () =>
    {
        const { segmenter, segments, add } = harness({ maxBytes: -1 });
        add(1, T0);
        add(2, T0 + 200);
        expect(segments).toHaveLength(2);
        segmenter.addFrame('d2', Buffer.from('nope'), T0, meta);
        expect(segmenter.isRecording('d2')).toBe(false);
    });
});
