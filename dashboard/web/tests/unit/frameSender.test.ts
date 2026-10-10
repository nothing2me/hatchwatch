import { describe, expect, it, vi } from 'vitest';
import { MAX_FRAME_BYTES, startFrameSender, type FrameSenderOptions, type SenderUpdate } from '@/features/phones/frameSender';
import { MESSAGES } from '@/features/phones/camMessages';

type Reply = number | 'offline';

function blob(size = 1000): Blob
{
    return new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
}

// A fake clock: sleeping advances time instantly; each POST takes `postMs`.
function harness(replies: Reply[], overrides: Partial<FrameSenderOptions> = {}, postMs = 20)
{
    let clock = 0;
    const posts: number[] = [];
    const sleeps: number[] = [];
    const updates: SenderUpdate[] = [];
    let sender: ReturnType<typeof startFrameSender> | null = null;
    const fetchFrame = vi.fn(async (url: string, init: RequestInit) =>
    {
        posts.push(clock);
        clock += postMs;
        const reply = replies.shift();
        if (reply === undefined)
        {
            sender?.stop();
            return { ok: true, status: 200, json: async () => ({ cameraCode: null }) };
        }
        if (reply === 'offline')
        {
            throw new TypeError('Failed to fetch');
        }
        return { ok: reply === 200, status: reply, json: async () => ({ at: clock, cameraCode: reply === 200 ? 'B1' : null, recording: false }) };
    });
    const options: FrameSenderOptions = {
        deviceId: 'ck1',
        jpegQuality: 0.7,
        encode: vi.fn(async () => blob()),
        fetch: fetchFrame,
        now: () => clock,
        sleep: async ms =>
        {
            sleeps.push(ms);
            clock += ms;
        },
        onUpdate: update => updates.push(update),
        ...overrides,
    };
    sender = startFrameSender(options);
    return { sender, posts, sleeps, updates, fetchFrame, options };
}

describe('frame sender', () =>
{
    it('posts JPEG frames to the device and paces them at no more than 5 a second', async () =>
    {
        const { sender, posts, updates, fetchFrame } = harness([200, 200, 200, 200, 200, 200, 200]);
        await sender.done;
        expect(fetchFrame.mock.calls[0][0]).toBe('/api/live/frame/ck1');
        expect(fetchFrame.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'image/jpeg' } });
        for (let index = 1; index < posts.length; index += 1)
        {
            expect(posts[index] - posts[index - 1]).toBeGreaterThanOrEqual(200);
        }
        const sent = updates.filter(update => update.kind === 'sent');
        expect(sent[0]).toEqual({ kind: 'sent', cameraCode: 'B1', fps: 1 });
        // Frames 200 ms apart: five fall within the last second.
        expect(Math.max(...sent.map(update => update.kind === 'sent' ? update.fps : 0))).toBe(5);
    });

    it('waits one interval and retries quietly on 429', async () =>
    {
        const { sender, posts, sleeps, updates } = harness([429, 200]);
        await sender.done;
        expect(posts.length).toBeGreaterThanOrEqual(2);
        expect(sleeps[0]).toBe(200);
        expect(updates.some(update => update.kind !== 'sent')).toBe(false);
    });

    it.each([
        [401, MESSAGES.signedOut],
        [403, MESSAGES.refused],
        [413, MESSAGES.tooLarge],
        [415, 'The server refused a frame (error 415).'],
    ])('stops on %i with a plain-word message', async (status, message) =>
    {
        const { sender, fetchFrame, updates } = harness([status, 200, 200]);
        await sender.done;
        expect(fetchFrame).toHaveBeenCalledTimes(1);
        expect(updates).toEqual([{ kind: 'stopped', status, message }]);
    });

    it('shows a retry message and waits 2 s on a network error or other status, then clears it', async () =>
    {
        const { sender, sleeps, updates } = harness(['offline', 500, 200]);
        await sender.done;
        expect(updates[0]).toEqual({ kind: 'retrying', message: MESSAGES.offline });
        expect(updates[1]).toEqual({ kind: 'retrying', message: 'The server refused a frame (error 500).' });
        expect(sleeps.slice(0, 2)).toEqual([2000, 2000]);
        expect(updates[2]).toMatchObject({ kind: 'sent', cameraCode: 'B1' });
    });

    it('re-encodes an oversize frame once at 0.6 and skips it if still too large', async () =>
    {
        const big = blob(MAX_FRAME_BYTES + 1);
        const encode = vi.fn()
            .mockResolvedValueOnce(big).mockResolvedValueOnce(blob())
            .mockResolvedValueOnce(big).mockResolvedValueOnce(big)
            .mockResolvedValue(blob());
        const { sender, fetchFrame } = harness([200, 200], { encode });
        await sender.done;
        expect(encode.mock.calls.slice(0, 4).map(call => call[0])).toEqual([0.7, 0.6, 0.7, 0.6]);
        // Frame 1 sent after re-encode, frame 2 skipped, frame 3 sent, then the harness stops.
        expect((fetchFrame.mock.calls[0][1] as RequestInit).body).not.toBe(big);
        expect(fetchFrame).toHaveBeenCalledTimes(3);
    });

    it('stop() halts the loop, even mid-wait, with no further posts or updates', async () =>
    {
        let release: () => void = () => {};
        const { sender, fetchFrame, updates } = harness([200, 200, 200], {
            sleep: () => new Promise<void>(resolve =>
            {
                release = resolve;
            }),
        });
        await vi.waitFor(() => expect(fetchFrame).toHaveBeenCalledTimes(1));
        sender.stop();
        release();
        await sender.done;
        expect(fetchFrame).toHaveBeenCalledTimes(1);
        expect(updates).toHaveLength(1);
    });
});
