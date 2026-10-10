import { describe, expect, it, vi } from 'vitest';
import { FramePoller } from '@/features/phones/framePoller';

function harness(responses: Response[])
{
    const created: string[] = [];
    const revoked: string[] = [];
    const fetchMock = vi.fn(async () => responses.shift()!);
    const poller = new FramePoller('ck1', {
        fetch: fetchMock as unknown as typeof fetch,
        createObjectURL: () => { const url = `blob:${created.length + 1}`; created.push(url); return url; },
        revokeObjectURL: url => revoked.push(url),
    });
    return { poller, fetchMock, revoked };
}
const frame = (at: number) => new Response(new Blob([new Uint8Array([0xff, 0xd8, at])]), { status: 200, headers: { ETag: `"${at}"` } });

describe('FramePoller', () =>
{
    it('swaps object URLs, keeps one spare and revokes the rest', async () =>
    {
        const { poller, fetchMock, revoked } = harness([frame(1), new Response(null, { status: 304 }), frame(2), frame(3)]);
        expect(await poller.poll()).toBe(true);
        expect(poller).toMatchObject({ url: 'blob:1', state: 'live' });
        expect(await poller.poll()).toBe(false);
        expect((fetchMock.mock.calls[1] as unknown[])[1]).toMatchObject({ headers: { 'If-None-Match': '"1"' } });
        await poller.poll();
        await poller.poll();
        expect(poller.url).toBe('blob:3');
        expect(revoked).toEqual(['blob:1']);
        poller.stop();
        expect(revoked).toEqual(['blob:1', 'blob:2', 'blob:3']);
        expect(poller.url).toBeNull();
    });

    it('reports offline on 404 and signed-out on 401', async () =>
    {
        const { poller } = harness([frame(1), new Response(null, { status: 404 }), new Response(null, { status: 401 })]);
        await poller.poll();
        expect(await poller.poll()).toBe(true);
        expect(poller.state).toBe('offline');
        await poller.poll();
        expect(poller.state).toBe('signed-out');
    });

    it('asks for the frame of its own device without caching', async () =>
    {
        const { poller, fetchMock } = harness([frame(1)]);
        await poller.poll();
        expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe('/api/live/frame/ck1');
        expect((fetchMock.mock.calls[0] as unknown[])[1]).toMatchObject({ cache: 'no-store' });
    });

    it('leaks no object URL when stopped while a frame request is in flight', async () =>
    {
        const created: string[] = [];
        const revoked: string[] = [];
        let release!: (response: Response) => void;
        let seen: AbortSignal | undefined;
        const poller = new FramePoller('ck1', {
            fetch: ((_url: string, init?: RequestInit) =>
            {
                seen = init?.signal ?? undefined;
                return new Promise<Response>(resolve => { release = resolve; });
            }) as unknown as typeof fetch,
            createObjectURL: () => { const url = `blob:${created.length + 1}`; created.push(url); return url; },
            revokeObjectURL: url => revoked.push(url),
        });
        const pending = poller.poll();
        poller.stop();
        expect(seen?.aborted).toBe(true);
        release(frame(1));
        expect(await pending).toBe(false);
        expect(revoked).toEqual(created);
        expect(poller.url).toBeNull();
        expect(await poller.poll()).toBe(false);
        expect(created).toEqual([]);
    });

    it('revokes a frame whose body finished after stop', async () =>
    {
        const created: string[] = [];
        const revoked: string[] = [];
        let poller!: FramePoller;
        const response = frame(1);
        const blob = response.blob.bind(response);
        // Stop lands between the response headers and the body.
        response.blob = async () => { poller.stop(); return blob(); };
        poller = new FramePoller('ck1', {
            fetch: (async () => response) as unknown as typeof fetch,
            createObjectURL: () => { const url = `blob:${created.length + 1}`; created.push(url); return url; },
            revokeObjectURL: url => revoked.push(url),
        });
        expect(await poller.poll()).toBe(false);
        expect(revoked).toEqual(created);
        expect(poller.url).toBeNull();
    });

    it('treats a frame request that hangs past the timeout as offline', async () =>
    {
        const hang = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) =>
        {
            init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        }));
        const poller = new FramePoller('ck1', { fetch: hang as unknown as typeof fetch, createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }, 20);
        poller.state = 'live';
        expect(await poller.poll()).toBe(true);
        expect(poller.state).toBe('offline');
        expect(await poller.poll()).toBe(false);
    });

    it('reports offline on a network error', async () =>
    {
        const poller = new FramePoller('ck1', { fetch: (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch, createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
        expect(await poller.poll()).toBe(true);
        expect(poller.state).toBe('offline');
    });
});
