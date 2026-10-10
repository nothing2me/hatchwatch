import { describe, expect, it } from 'vitest';
import { LiveHub } from '@/lib/live/hub';
import type { HubEvent } from '@/lib/live/protocol';

function sink()
{
    const events: HubEvent[] = [];
    let closed = false;
    return { events, get closed() { return closed; }, send: (event: HubEvent) => { events.push(event); }, close: () => { closed = true; } };
}

describe('LiveHub', () =>
{
    it('tells the device when a viewer joins and relays offer/answer between them only', () =>
    {
        const hub = new LiveHub();
        const device = sink();
        const viewer = sink();
        const other = sink();
        const devicePeer = hub.connectDevice('d1', 'owner', device);
        const viewerPeer = hub.connectViewer('d1', 'alice', viewer)!;
        hub.connectDevice('d2', 'owner2', other);

        expect(viewer.events[0]).toEqual({ type: 'hello', peerId: viewerPeer });
        expect(device.events).toContainEqual({ type: 'join', from: viewerPeer });
        expect(hub.relay('owner', { from: devicePeer, to: viewerPeer, deviceId: 'd1', type: 'offer', payload: { sdp: 'x' } })).toBe('ok');
        expect(viewer.events).toContainEqual({ type: 'offer', from: devicePeer, payload: { sdp: 'x' } });
        expect(hub.relay('alice', { from: viewerPeer, deviceId: 'd1', type: 'answer', payload: { sdp: 'y' } })).toBe('ok');
        expect(device.events).toContainEqual({ type: 'answer', from: viewerPeer, payload: { sdp: 'y' } });
        expect(other.events.filter(e => e.type !== 'hello')).toEqual([]);
    });

    it('rejects spoofed senders and cross-device targets', () =>
    {
        const hub = new LiveHub();
        const devicePeer = hub.connectDevice('d1', 'owner', sink());
        const viewerPeer = hub.connectViewer('d1', 'alice', sink())!;
        const foreignViewer = sink();
        expect(hub.connectViewer('d2', 'bob', foreignViewer)).toBeNull();     // d2 has no device connected
        expect(foreignViewer.events).toEqual([{ type: 'device-offline' }]);
        expect(foreignViewer.closed).toBe(true);
        const d2 = hub.connectDevice('d2', 'owner2', sink());
        const bobPeer = hub.connectViewer('d2', 'bob', sink())!;
        expect(hub.relay('mallory', { from: viewerPeer, deviceId: 'd1', type: 'answer', payload: {} })).toBe('forbidden');
        expect(hub.relay('owner', { from: devicePeer, to: bobPeer, deviceId: 'd1', type: 'offer', payload: {} })).toBe('forbidden');
        expect(hub.relay('owner2', { from: d2, to: viewerPeer, deviceId: 'd2', type: 'offer', payload: {} })).toBe('forbidden');
        expect(hub.relay('alice', { from: viewerPeer, deviceId: 'd2', type: 'answer', payload: {} })).toBe('forbidden');
        expect(hub.relay('owner', { from: devicePeer, to: devicePeer, deviceId: 'd1', type: 'offer', payload: {} })).toBe('forbidden');
        expect(hub.relay('owner', { from: 'nope', deviceId: 'd1', type: 'offer', payload: {} })).toBe('unknown-peer');
        expect(hub.relay('owner', { from: devicePeer, deviceId: 'd1', type: 'offer', payload: {} })).toBe('unknown-peer');
    });

    it('caps viewers at four and tells the fifth', () =>
    {
        const hub = new LiveHub();
        hub.connectDevice('d1', 'owner', sink());
        for (let i = 0; i < 4; i++) expect(hub.connectViewer('d1', `u${i}`, sink())).not.toBeNull();
        const fifth = sink();
        expect(hub.connectViewer('d1', 'u5', fifth)).toBeNull();
        expect(fifth.events).toContainEqual({ type: 'full' });
        expect(fifth.closed).toBe(true);
        expect(hub.viewerCount('d1')).toBe(4);
    });

    it('notifies viewers when the device disconnects and the device when a viewer leaves', () =>
    {
        const hub = new LiveHub();
        const device = sink();
        const viewer = sink();
        const devicePeer = hub.connectDevice('d1', 'owner', device);
        const viewerPeer = hub.connectViewer('d1', 'alice', viewer)!;
        hub.disconnect(viewerPeer);
        expect(device.events).toContainEqual({ type: 'leave', from: viewerPeer });
        expect(hub.viewerCount('d1')).toBe(0);
        const again = hub.connectViewer('d1', 'alice', sink())!;
        hub.disconnect(devicePeer);
        expect(device.closed).toBe(true);
        expect(hub.relay('alice', { from: again, deviceId: 'd1', type: 'answer', payload: {} })).toBe('unknown-peer');
    });

    it('a reconnecting device replaces the old one and is introduced to waiting viewers', () =>
    {
        const hub = new LiveHub();
        const first = sink();
        const viewer = sink();
        const firstPeer = hub.connectDevice('d1', 'owner', first);
        const viewerPeer = hub.connectViewer('d1', 'alice', viewer)!;
        const second = sink();
        hub.connectDevice('d1', 'owner', second);
        expect(first.closed).toBe(true);
        expect(viewer.events).toContainEqual({ type: 'leave', from: firstPeer });
        expect(second.events).toContainEqual({ type: 'join', from: viewerPeer });
    });
});
