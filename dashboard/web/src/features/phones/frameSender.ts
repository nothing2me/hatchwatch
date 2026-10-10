import { describeFrameStatus, MESSAGES, SEND_FPS } from './camMessages';

// The server refuses anything larger (413).
export const MAX_FRAME_BYTES = 500 * 1024;
const RETRY_QUALITY = 0.6;
const RETRY_DELAY_MS = 2000;
const STOP_STATUSES = new Set([401, 403, 413, 415]);

export type SenderUpdate =
    | { kind: 'sent'; cameraCode: string | null; fps: number }
    | { kind: 'retrying'; message: string }
    | { kind: 'stopped'; status: number; message: string };

interface FrameReply
{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
}

export interface FrameSenderOptions
{
    deviceId: string;
    jpegQuality: number;
    fps?: number;
    // Draws the current camera picture and encodes it as JPEG at `quality`; null when nothing could be drawn.
    encode: (quality: number) => Promise<Blob | null>;
    fetch: (url: string, init: RequestInit) => Promise<FrameReply>;
    now: () => number;
    sleep: (ms: number) => Promise<void>;
    onUpdate: (update: SenderUpdate) => void;
}

export interface FrameSender
{
    stop(): void;
    done: Promise<void>;
}

async function encodeWithinLimit(options: FrameSenderOptions): Promise<Blob | null>
{
    const first = await options.encode(options.jpegQuality).catch(() => null);
    if (!first || first.size <= MAX_FRAME_BYTES)
    {
        return first;
    }
    const second = await options.encode(RETRY_QUALITY).catch(() => null);
    return second && second.size <= MAX_FRAME_BYTES ? second : null;
}

// One frame in flight at a time, at most `fps` a second, until stop() or a status that cannot recover.
export function startFrameSender(options: FrameSenderOptions): FrameSender
{
    const interval = 1000 / (options.fps ?? SEND_FPS);
    const url = `/api/live/frame/${encodeURIComponent(options.deviceId)}`;
    const sentAt: number[] = [];
    let stopped = false;

    async function sendOne(): Promise<void>
    {
        const startedAt = options.now();
        const jpeg = await encodeWithinLimit(options);
        if (stopped)
        {
            return;
        }
        if (jpeg)
        {
            let reply: FrameReply;
            try
            {
                reply = await options.fetch(url, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: jpeg });
            }
            catch
            {
                if (!stopped)
                {
                    options.onUpdate({ kind: 'retrying', message: MESSAGES.offline });
                    await options.sleep(RETRY_DELAY_MS);
                }
                return;
            }
            if (stopped)
            {
                return;
            }
            if (reply.status === 429)
            {
                await options.sleep(interval);
                return;
            }
            if (!reply.ok)
            {
                const message = describeFrameStatus(reply.status) ?? '';
                if (STOP_STATUSES.has(reply.status))
                {
                    stopped = true;
                    options.onUpdate({ kind: 'stopped', status: reply.status, message });
                    return;
                }
                options.onUpdate({ kind: 'retrying', message });
                await options.sleep(RETRY_DELAY_MS);
                return;
            }
            const body = await reply.json().catch(() => null) as { cameraCode?: unknown } | null;
            if (stopped)
            {
                return;
            }
            const now = options.now();
            sentAt.push(now);
            while (sentAt.length > 0 && sentAt[0] <= now - 1000)
            {
                sentAt.shift();
            }
            options.onUpdate({ kind: 'sent', cameraCode: typeof body?.cameraCode === 'string' ? body.cameraCode : null, fps: sentAt.length });
        }
        await options.sleep(Math.max(0, interval - (options.now() - startedAt)));
    }

    async function run(): Promise<void>
    {
        while (!stopped)
        {
            await sendOne();
        }
    }

    return {
        stop()
        {
            stopped = true;
        },
        done: run(),
    };
}
