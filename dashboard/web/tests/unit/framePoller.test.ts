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
});
