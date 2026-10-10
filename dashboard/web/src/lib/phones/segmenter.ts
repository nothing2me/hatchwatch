import { jpegSize } from './avi';

export interface SegmentMeta
{
    deviceName: string;
    cameraCode: string | null;
}

export interface SegmentStart extends SegmentMeta
{
    deviceId: string;
    startedAt: number;
    width: number;
    height: number;
    fps: number;
}

export interface SegmentSink
{
    readonly bytes: number;
    write(jpeg: Buffer): void;
    close(frameCount: number): void;
}

export interface SegmenterOptions
{
    fps: number;
    segmentMs: number;
    maxGapMs: number;
    maxBytes: number;
    open(start: SegmentStart): SegmentSink;
}

interface OpenSegment
{
    start: SegmentStart;
    sink: SegmentSink;
    frameCount: number;
    lastFrame: Buffer;
    lastFrameAt: number;
}

// Frames arrive whenever the phone manages to send them. Each segment is a fixed-rate timeline on the
// wall clock: a slot with no new frame repeats the newest one, so a video second is a real second.
export class Segmenter
{
    private segments = new Map<string, OpenSegment>();

    constructor(private options: SegmenterOptions) {}

    addFrame(deviceId: string, jpeg: Buffer, at: number, meta: SegmentMeta): void
    {
        const size = jpegSize(jpeg);
        if (!size)
        {
            return;
        }
        let segment = this.segments.get(deviceId);
        if (segment && (at - segment.lastFrameAt > this.options.maxGapMs
            || at - segment.start.startedAt >= this.options.segmentMs
            || segment.sink.bytes > this.options.maxBytes
            || size.width !== segment.start.width
            || size.height !== segment.start.height))
        {
            this.close(deviceId);
            segment = undefined;
        }
        if (!segment)
        {
            const start: SegmentStart = { deviceId, startedAt: at, width: size.width, height: size.height, fps: this.options.fps, deviceName: meta.deviceName, cameraCode: meta.cameraCode };
            segment = { start, sink: this.options.open(start), frameCount: 0, lastFrame: jpeg, lastFrameAt: at };
            this.segments.set(deviceId, segment);
        }
        const slot = Math.floor((at - segment.start.startedAt) * this.options.fps / 1000);
        while (segment.frameCount < slot)
        {
            segment.sink.write(segment.lastFrame);
            segment.frameCount += 1;
        }
        if (segment.frameCount === slot)
        {
            segment.sink.write(jpeg);
            segment.frameCount += 1;
        }
        segment.lastFrame = jpeg;
        segment.lastFrameAt = at;
    }

    closeIdle(now: number): void
    {
        for (const [deviceId, segment] of [...this.segments])
        {
            if (now - segment.lastFrameAt > this.options.maxGapMs)
            {
                this.close(deviceId);
            }
        }
    }

    closeAll(): void
    {
        for (const deviceId of [...this.segments.keys()])
        {
            this.close(deviceId);
        }
    }

    isRecording(deviceId: string): boolean
    {
        return this.segments.has(deviceId);
    }

    private close(deviceId: string): void
    {
        const segment = this.segments.get(deviceId);
        if (segment)
        {
            this.segments.delete(deviceId);
            segment.sink.close(segment.frameCount);
        }
    }
}
