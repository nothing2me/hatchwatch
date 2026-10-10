import { randomUUID } from 'node:crypto';
import { MAX_VIEWERS, type HubEvent, type SignalMessage } from './protocol';

export interface PeerSink
{
    send(event: HubEvent): void;
    close(): void;
}

interface Peer
{
    id: string;
    role: 'device' | 'viewer';
    deviceId: string;
    userId: string;
    sink: PeerSink;
}

// Routes WebRTC signalling between one device and its viewers; the video itself goes browser to browser.
// In memory, so it only works with a single web process.
export class LiveHub
{
    private peers = new Map<string, Peer>();
    private devices = new Map<string, string>();          // deviceId -> device peerId
    private viewers = new Map<string, Set<string>>();     // deviceId -> viewer peerIds

    // A newer connection for the same device (a reload, a second tab) replaces the older one.
    connectDevice(deviceId: string, userId: string, sink: PeerSink): string
    {
        const previous = this.devices.get(deviceId);
        if (previous)
        {
            this.disconnect(previous);
        }
        const id = randomUUID();
        this.peers.set(id, { id, role: 'device', deviceId, userId, sink });
        this.devices.set(deviceId, id);
        sink.send({ type: 'hello', peerId: id });
        for (const viewerId of this.viewers.get(deviceId) ?? [])
        {
            sink.send({ type: 'join', from: viewerId });
        }
        return id;
    }

    // Null when the device is not connected or already has MAX_VIEWERS; the sink is told why and closed.
    connectViewer(deviceId: string, userId: string, sink: PeerSink): string | null
    {
        const devicePeer = this.devices.get(deviceId);
        if (!devicePeer)
        {
            sink.send({ type: 'device-offline' });
            sink.close();
            return null;
        }
        const set = this.viewers.get(deviceId) ?? new Set<string>();
        if (set.size >= MAX_VIEWERS)
        {
            sink.send({ type: 'full' });
            sink.close();
            return null;
        }
        const id = randomUUID();
        this.peers.set(id, { id, role: 'viewer', deviceId, userId, sink });
        set.add(id);
        this.viewers.set(deviceId, set);
        sink.send({ type: 'hello', peerId: id });
        this.peers.get(devicePeer)!.sink.send({ type: 'join', from: id });
        return id;
    }

    disconnect(peerId: string): void
    {
        const peer = this.peers.get(peerId);
        if (!peer)
        {
            return;
        }
        this.peers.delete(peerId);
        peer.sink.close();
        if (peer.role === 'device')
        {
            if (this.devices.get(peer.deviceId) === peerId)
            {
                this.devices.delete(peer.deviceId);
            }
            for (const viewerId of this.viewers.get(peer.deviceId) ?? [])
            {
                this.peers.get(viewerId)?.sink.send({ type: 'leave', from: peerId });
            }
        }
        else
        {
            const set = this.viewers.get(peer.deviceId);
            set?.delete(peerId);
            if (set && set.size === 0)
            {
                this.viewers.delete(peer.deviceId);
            }
            const devicePeer = this.devices.get(peer.deviceId);
            if (devicePeer)
            {
                this.peers.get(devicePeer)?.sink.send({ type: 'leave', from: peerId });
            }
        }
    }

    // `senderUserId` is the signed-in user posting the message: a peer can only speak as itself,
    // and only to the other side of its own device.
    relay(senderUserId: string, message: SignalMessage): 'ok' | 'forbidden' | 'unknown-peer'
    {
        const sender = this.peers.get(message.from);
        if (!sender)
        {
            return 'unknown-peer';
        }
        if (sender.userId !== senderUserId || sender.deviceId !== message.deviceId)
        {
            return 'forbidden';
        }
        const targetId = sender.role === 'viewer' ? this.devices.get(sender.deviceId) : message.to;
        const target = targetId ? this.peers.get(targetId) : undefined;
        if (!target)
        {
            return 'unknown-peer';
        }
        if (target.deviceId !== sender.deviceId || target.role === sender.role)
        {
            return 'forbidden';
        }
        if (message.type === 'leave')
        {
            target.sink.send({ type: 'leave', from: sender.id });
        }
        else
        {
            target.sink.send({ type: message.type, from: sender.id, payload: message.payload });
        }
        return 'ok';
    }

    viewerCount(deviceId: string): number
    {
        return this.viewers.get(deviceId)?.size ?? 0;
    }
}

const globalForHub = globalThis as unknown as { liveHub?: LiveHub };
export const liveHub = globalForHub.liveHub ??= new LiveHub();
