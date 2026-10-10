// The browser data source must recover on its own when the backend
// restarts: both when EventSource gives up, and when a proxy keeps a dead
// connection open with nothing coming through.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveDataSource } from '../src/data/liveDataSource.js';

class FakeEventSource
{
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;
    static instances = [];

    constructor(url)
    {
        this.url = url;
        this.readyState = FakeEventSource.CONNECTING;
        this.listeners = {};
        FakeEventSource.instances.push(this);
    }

    addEventListener(name, listener)
    {
        (this.listeners[name] ??= []).push(listener);
    }

    emit(name, data)
    {
        if (name === 'open')
        {
            this.readyState = FakeEventSource.OPEN;
        }
        (this.listeners[name] ?? []).forEach((listener) => listener({ data: JSON.stringify(data) }));
    }

    close()
    {
        this.readyState = FakeEventSource.CLOSED;
        this.closed = true;
    }
}

test('reconnects after the browser gives up and after a silent dead connection', () =>
{
    mock.timers.enable({ apis: ['setTimeout'] });
    globalThis.EventSource = FakeEventSource;
    FakeEventSource.instances = [];
    try
    {
        const source = createLiveDataSource();
        const states = [];
        const snapshots = [];
        source.subscribeToConnection((state) => states.push(state));
        const unsubscribe = source.subscribe((snapshot) => snapshots.push(snapshot));

        const first = FakeEventSource.instances[0];
        assert.equal(first.url, '/api/stream');
        first.emit('open');
        first.emit('snapshot', { mode: 'live', n: 1 });
        assert.equal(states.at(-1), 'connected');
        assert.equal(snapshots.length, 1);

        // 1. The backend went away and EventSource closed itself: we retry.
        first.readyState = FakeEventSource.CLOSED;
        first.emit('error');
        assert.equal(states.at(-1), 'connecting');
        mock.timers.tick(3000);
        const second = FakeEventSource.instances[1];
        assert.ok(second, 'opened a new stream');
        second.emit('open');
        second.emit('snapshot', { mode: 'live', n: 2 });
        assert.equal(states.at(-1), 'connected');

        // 2. Heartbeats keep a quiet connection alive...
        mock.timers.tick(30000);
        second.emit('heartbeat', {});
        mock.timers.tick(30000);
        assert.equal(FakeEventSource.instances.length, 2);

        // ...but total silence means a dead connection: close it and reopen.
        mock.timers.tick(15000);
        assert.ok(second.closed);
        mock.timers.tick(3000);
        assert.equal(FakeEventSource.instances.length, 3);

        unsubscribe();
        assert.ok(FakeEventSource.instances[2].closed, 'closes once nobody is listening');
    }
    finally
    {
        mock.timers.reset();
        delete globalThis.EventSource;
    }
});
