'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cn } from '@/lib/cn';
import { openSignalClient } from './signalClient';

type State = 'connecting' | 'live' | 'full' | 'offline';

const MESSAGES: Record<Exclude<State, 'live'>, string> = {
    connecting: 'Connecting to device…',
    full: 'Too many viewers on this device',
    offline: 'Device offline',
};

// Plays one device's camera straight from the device over WebRTC. The server only relays signalling.
// `badge` sits over the top-left of the picture (the map panel's header has no room for it).
// `videoRef` hands the playing element to callers that read its frames (the motion view).
export function LiveVideo({ deviceId, large = false, badge, videoRef }: { deviceId: string; large?: boolean; badge?: ReactNode; videoRef?: RefObject<HTMLVideoElement | null> })
{
    const ownRef = useRef<HTMLVideoElement>(null);
    const ref = videoRef ?? ownRef;
    const [state, setState] = useState<State>('connecting');

    useEffect(() =>
    {
        let pc: RTCPeerConnection | null = null;
        // ICE can arrive before the offer has been applied; hold it until the connection can take it.
        let pending: RTCIceCandidateInit[] = [];

        const reset = () =>
        {
            pc?.close();
            pc = null;
            pending = [];
            if (ref.current)
            {
                ref.current.srcObject = null;
            }
        };

        const client = openSignalClient('viewer', deviceId, event =>
        {
            if (event.type === 'offer')
            {
                reset();
                const conn = new RTCPeerConnection({ iceServers: [] });
                pc = conn;
                conn.ontrack = track =>
                {
                    if (ref.current)
                    {
                        ref.current.srcObject = track.streams[0] ?? new MediaStream([track.track]);
                    }
                    setState('live');
                };
                conn.onicecandidate = candidate =>
                {
                    if (candidate.candidate)
                    {
                        void client.send({ type: 'ice', payload: candidate.candidate.toJSON() });
                    }
                };
                conn.onconnectionstatechange = () =>
                {
                    if (conn.connectionState === 'failed' && pc === conn)
                    {
                        reset();
                        setState('offline');
                    }
                };
                (async () =>
                {
                    await conn.setRemoteDescription(event.payload as RTCSessionDescriptionInit);
                    for (const candidate of pending.splice(0))
                    {
                        await conn.addIceCandidate(candidate).catch(() => undefined);
                    }
                    await conn.setLocalDescription(await conn.createAnswer());
                    await client.send({ type: 'answer', payload: conn.localDescription?.toJSON() });
                })().catch(() =>
                {
                    if (pc === conn)
                    {
                        reset();
                        setState('offline');
                    }
                });
            }
            else if (event.type === 'ice')
            {
                if (pc?.remoteDescription)
                {
                    pc.addIceCandidate(event.payload as RTCIceCandidateInit).catch(() => undefined);
                }
                else
                {
                    pending.push(event.payload as RTCIceCandidateInit);
                }
            }
            else if (event.type === 'full')
            {
                // Stop retrying: four people are already watching.
                client.close();
                setState('full');
            }
            else if (event.type === 'device-offline' || event.type === 'leave')
            {
                // The stream reconnects on its own and picks the device up again when it comes back.
                reset();
                setState('offline');
            }
        });

        return () =>
        {
            client.close();
            reset();
        };
    }, [deviceId]);

    return (
        <div className={cn('relative mt-2 overflow-hidden rounded-lg border border-white/6 bg-night-950', !large && 'max-md:aspect-[5/2]')}>
            <video ref={ref} muted autoPlay playsInline data-testid="live-video" className={cn('aspect-video w-full bg-black object-contain', !large && 'max-md:h-full')} />
            {state !== 'live' && (
                <div className="absolute inset-0 grid place-items-center text-sm text-ink-muted" role="status">{MESSAGES[state]}</div>
            )}
            {badge && <div className="absolute top-2 left-2 max-w-[calc(100%-1rem)]">{badge}</div>}
        </div>
    );
}
