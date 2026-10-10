import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { MapSnapshot } from '@/lib/types';
import { useLiveSnapshot } from '@/features/live/useLiveSnapshot';

class FakeEventSource
{
    static instances: FakeEventSource[] = [];
    onmessage: ((event: MessageEvent) => void) | null = null;
    onopen: (() => void) | null = null;
    closed = false;
    constructor(public url: string) { FakeEventSource.instances.push(this); }
    close() { this.closed = true; }
    emit(data: string) { this.onmessage?.(new MessageEvent('message', { data })); }
}

const base: MapSnapshot = {
    zones: [], cameras: [], alerts: [], camerasOnline: 0, camerasTotal: 0, inactiveCount: 0,
    outcomes: { saved: 0, notSaved: 0, pending: 0 }, fadeMinutes: 5, tracks: [], dangerCount: 0, dangerTotal: 0,
};

function Probe({ initial }: { initial: MapSnapshot })
{
    const snapshot = useLiveSnapshot(initial);
    return <span data-testid="count">{snapshot.inactiveCount}</span>;
}

function deferred<T>()
{
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
}

const reply = (count: number) => ({ ok: true, json: async () => ({ ...base, inactiveCount: count }) }) as Response;

beforeEach(() =>
{
    FakeEventSource.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() =>
{
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('useLiveSnapshot', () =>
{
    it('subscribes to the stream and re-fetches the snapshot after a debounced change', async () =>
    {
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => reply(4));
        vi.stubGlobal('fetch', fetchMock);
        render(<Probe initial={base} />);
        expect(FakeEventSource.instances[0].url).toBe('/api/stream');
        expect(screen.getByTestId('count').textContent).toBe('0');

        act(() =>
        {
            FakeEventSource.instances[0].emit('{"type":"snapshot"}');
            FakeEventSource.instances[0].emit('{"type":"snapshot"}');
        });
        expect(fetchMock).not.toHaveBeenCalled();
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('/api/snapshot');
        expect(screen.getByTestId('count').textContent).toBe('4');
    });

    it('ignores a response that arrives after a newer one', async () =>
    {
        const first = deferred<Response>();
        const second = deferred<Response>();
        const fetchMock = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        vi.stubGlobal('fetch', fetchMock);
        render(<Probe initial={base} />);
        const source = FakeEventSource.instances[0];

        act(() => source.emit('{"type":"snapshot"}'));
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        act(() => source.emit('{"type":"snapshot"}'));
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        expect(fetchMock).toHaveBeenCalledTimes(2);

        await act(async () => { second.resolve(reply(9)); await Promise.resolve(); });
        expect(screen.getByTestId('count').textContent).toBe('9');
        await act(async () => { first.resolve(reply(2)); await Promise.resolve(); });
        expect(screen.getByTestId('count').textContent).toBe('9');
    });

    it('ignores other message types and failed fetches', async () =>
    {
        const fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({}) }) as Response);
        vi.stubGlobal('fetch', fetchMock);
        render(<Probe initial={base} />);
        act(() => FakeEventSource.instances[0].emit('{"type":"other"}'));
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        expect(fetchMock).not.toHaveBeenCalled();
        act(() => FakeEventSource.instances[0].emit('{"type":"snapshot"}'));
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('count').textContent).toBe('0');
    });

    it('catches up after a reconnect and closes the stream on unmount', async () =>
    {
        const fetchMock = vi.fn(async () => reply(3));
        vi.stubGlobal('fetch', fetchMock);
        const view = render(<Probe initial={base} />);
        const source = FakeEventSource.instances[0];
        act(() => source.onopen?.());
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        expect(fetchMock).not.toHaveBeenCalled();
        act(() => source.onopen?.());
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        view.unmount();
        expect(source.closed).toBe(true);
    });
});
