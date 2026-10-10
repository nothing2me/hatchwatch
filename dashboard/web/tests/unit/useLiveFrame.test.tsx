import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { useLiveFrame } from '@/features/phones/useLiveFrame';

const jpeg = () => new Response(new Blob([new Uint8Array([0xff, 0xd8, 1])]), { status: 200, headers: { ETag: '"1"' } });

function stubUrls()
{
    const created: string[] = [];
    const revoked: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { const url = `blob:${created.length + 1}`; created.push(url); return url; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => { revoked.push(url); });
    return { created, revoked };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('useLiveFrame', () =>
{
    it('is idle without a device', () =>
    {
        const { result } = renderHook(() => useLiveFrame(null));
        expect(result.current).toEqual({ url: null, state: 'idle' });
    });

    it('aborts the request in flight on unmount and leaks no object URL', async () =>
    {
        const { created, revoked } = stubUrls();
        let release!: (response: Response) => void;
        let signal: AbortSignal | undefined;
        vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) =>
        {
            signal = init?.signal ?? undefined;
            return new Promise<Response>(resolve => { release = resolve; });
        }));
        const { unmount } = renderHook(() => useLiveFrame('ck1'));
        await waitFor(() => expect(signal).toBeDefined());
        unmount();
        expect(signal?.aborted).toBe(true);
        release(jpeg());
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(revoked).toEqual(created);
    });

    it('shows a frame, then goes offline when the next request fails', async () =>
    {
        stubUrls();
        const responses = [jpeg()];
        vi.stubGlobal('fetch', vi.fn(async () =>
        {
            const next = responses.shift();
            if (!next)
            {
                throw new TypeError('Failed to fetch');
            }
            return next;
        }));
        const seen: unknown[] = [];
        const { result } = renderHook(() =>
        {
            const frame = useLiveFrame('ck1', 50);
            seen.push(frame);
            return frame;
        });
        await waitFor(() => expect(result.current.state).toBe('offline'));
        expect(seen).toContainEqual({ url: 'blob:1', state: 'live' });
        expect(result.current.url).toBe('blob:1');
    });
});
