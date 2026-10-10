'use client';

import type { HubEvent, SignalMessage } from '@/lib/live/protocol';

export interface SignalClient
{
    send(message: Omit<SignalMessage, 'from' | 'deviceId'>): Promise<void>;
    close(): void;
}

// One SSE stream in, POSTs out. Every (re)connection starts with `hello` carrying this peer's id;
// EventSource reconnects on its own after a drop, and messages always go out under the newest id.
export function openSignalClient(role: 'device' | 'viewer', deviceId: string, onEvent: (event: HubEvent) => void): SignalClient
{
    const source = new EventSource(`/api/live/events?role=${role}&device=${encodeURIComponent(deviceId)}`);
    let peerId: string | null = null;
    let waiting: (() => void)[] = [];

    source.onmessage = message =>
    {
        let event: HubEvent;
        try
        {
            event = JSON.parse(message.data) as HubEvent;
        }
        catch
        {
            return;
        }
        if (event.type === 'hello')
        {
            peerId = event.peerId;
            waiting.forEach(resolve => resolve());
            waiting = [];
        }
        onEvent(event);
    };

    return {
        async send(message)
        {
            if (!peerId)
            {
                await new Promise<void>(resolve => waiting.push(resolve));
            }
            await fetch('/api/live/signal', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ ...message, from: peerId, deviceId }),
            }).catch(() => undefined);
        },
        close()
        {
            source.close();
            waiting = [];
        },
    };
}
