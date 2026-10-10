'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Square, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GlassPanel } from '@/components/ui/glass-panel';
import { describeMediaError } from '@/features/live/mediaErrors';
import { openSignalClient, type SignalClient } from '@/features/live/signalClient';
import type { HubEvent } from '@/lib/live/protocol';

type Facing = 'environment' | 'user';
type Status = 'idle' | 'starting' | 'live' | 'error';

const NAME_KEY = 'hatchwatch.cam.name';
const DEVICE_KEY = 'hatchwatch.cam.device';
const HEARTBEAT_MS = 5_000;

interface Session
{
    stream: MediaStream;
    deviceId: string;
    client: SignalClient;
    peers: Map<string, RTCPeerConnection>;
    // Viewer ICE that arrived before that viewer's answer was applied.
    pendingIce: Map<string, RTCIceCandidateInit[]>;
    heartbeat: ReturnType<typeof setInterval>;
    wakeLock: { release(): Promise<void> } | null;
}

function readStored(key: string): string
{
    try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
}

function writeStored(key: string, value: string): void
{
    try { localStorage.setItem(key, value); } catch { /* private mode: the device is simply registered again next time */ }
}

function cameraConstraints(facing: Facing): MediaStreamConstraints
{
    return { video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
}

// The same browser keeps its device (and so its camera assignment) across reloads, as long as the name is unchanged.
async function deviceFor(name: string): Promise<string>
{
    const stored = readStored(DEVICE_KEY);
    if (stored && readStored(NAME_KEY) === name)
    {
        const beat = await fetch(`/api/live/devices/${encodeURIComponent(stored)}/heartbeat`, { method: 'POST' });
        if (beat.ok)
        {
            return stored;
        }
    }
    const response = await fetch('/api/live/devices', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    if (!response.ok)
    {
        throw new Error(response.status === 401 ? 'signed-out' : 'register');
    }
    const { id } = await response.json() as { id: string };
    writeStored(DEVICE_KEY, id);
    writeStored(NAME_KEY, name);
    return id;
}

export function CamStreamer({ userName }: { userName: string })
{
    const [name, setName] = useState('');
    const [facing, setFacing] = useState<Facing>('environment');
    const [status, setStatus] = useState<Status>('idle');
    const [error, setError] = useState<string | null>(null);
    const [viewers, setViewers] = useState(0);
    const previewRef = useRef<HTMLVideoElement>(null);
    const sessionRef = useRef<Session | null>(null);

    useEffect(() => { setName(readStored(NAME_KEY)); }, []);

    function stop()
    {
        const session = sessionRef.current;
        sessionRef.current = null;
        if (session)
        {
            session.peers.forEach(pc => pc.close());
            session.client.close();
            clearInterval(session.heartbeat);
            session.stream.getTracks().forEach(track => track.stop());
            session.wakeLock?.release().catch(() => undefined);
        }
        if (previewRef.current)
        {
            previewRef.current.srcObject = null;
        }
        setViewers(0);
        setStatus(current => (current === 'error' ? current : 'idle'));
    }

    // Stop streaming when the page goes away or the component unmounts.
    useEffect(() =>
    {
        window.addEventListener('pagehide', stop);
        return () =>
        {
            window.removeEventListener('pagehide', stop);
            stop();
        };
    }, []);

    function fail(message: string)
    {
        stop();
        setError(message);
        setStatus('error');
    }

    async function offerTo(session: Session, viewerId: string)
    {
        session.peers.get(viewerId)?.close();
        session.pendingIce.delete(viewerId);
        const pc = new RTCPeerConnection({ iceServers: [] });
        session.peers.set(viewerId, pc);
        setViewers(session.peers.size);
        session.stream.getTracks().forEach(track => pc.addTrack(track, session.stream));
        pc.onicecandidate = event =>
        {
            if (event.candidate)
            {
                void session.client.send({ to: viewerId, type: 'ice', payload: event.candidate.toJSON() });
            }
        };
        pc.onconnectionstatechange = () =>
        {
            if (pc.connectionState === 'failed' && session.peers.get(viewerId) === pc)
            {
                pc.close();
                session.peers.delete(viewerId);
                setViewers(session.peers.size);
            }
        };
        await pc.setLocalDescription(await pc.createOffer());
        await session.client.send({ to: viewerId, type: 'offer', payload: pc.localDescription?.toJSON() });
    }

    function onEvent(event: HubEvent)
    {
        const session = sessionRef.current;
        if (!session)
        {
            return;
        }
        if (event.type === 'join')
        {
            offerTo(session, event.from).catch(() => session.peers.get(event.from)?.close());
        }
        else if (event.type === 'answer')
        {
            const pc = session.peers.get(event.from);
            pc?.setRemoteDescription(event.payload as RTCSessionDescriptionInit)
                .then(async () =>
                {
                    const queued = session.pendingIce.get(event.from) ?? [];
                    session.pendingIce.delete(event.from);
                    for (const candidate of queued)
                    {
                        await pc.addIceCandidate(candidate).catch(() => undefined);
                    }
                })
                .catch(() => undefined);
        }
        else if (event.type === 'ice')
        {
            const pc = session.peers.get(event.from);
            if (pc?.remoteDescription)
            {
                pc.addIceCandidate(event.payload as RTCIceCandidateInit).catch(() => undefined);
            }
            else if (pc)
            {
                session.pendingIce.set(event.from, [...(session.pendingIce.get(event.from) ?? []), event.payload as RTCIceCandidateInit]);
            }
        }
        else if (event.type === 'leave')
        {
            session.peers.get(event.from)?.close();
            session.peers.delete(event.from);
            session.pendingIce.delete(event.from);
            setViewers(session.peers.size);
        }
    }

    async function start()
    {
        setError(null);
        setStatus('starting');
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        {
            fail(describeMediaError(null, window.isSecureContext));
            return;
        }
        let stream: MediaStream;
        try
        {
            stream = await navigator.mediaDevices.getUserMedia(cameraConstraints(facing));
        }
        catch (cause)
        {
            fail(describeMediaError(cause, window.isSecureContext));
            return;
        }
        if (previewRef.current)
        {
            previewRef.current.srcObject = stream;
        }

        const deviceName = name.trim() || 'Phone camera';
        let deviceId: string;
        try
        {
            deviceId = await deviceFor(deviceName);
        }
        catch (cause)
        {
            stream.getTracks().forEach(track => track.stop());
            fail((cause as Error).message === 'signed-out'
                ? 'You were signed out. Reload the page and sign in again.'
                : 'Could not register this device with the dashboard. Check the Wi-Fi and try again.');
            return;
        }
        setName(deviceName);

        const wakeLock = await (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } })
            .wakeLock?.request('screen').catch(() => null) ?? null;
        const heartbeat = setInterval(() =>
        {
            fetch(`/api/live/devices/${encodeURIComponent(deviceId)}/heartbeat`, { method: 'POST' })
                .then(response =>
                {
                    if (response.status === 401 || response.status === 404)
                    {
                        fail('The dashboard no longer accepts this device. Reload the page and sign in again.');
                    }
                })
                .catch(() => undefined);
        }, HEARTBEAT_MS);
        sessionRef.current = { stream, deviceId, client: openSignalClient('device', deviceId, onEvent), peers: new Map(), pendingIce: new Map(), heartbeat, wakeLock };
        setStatus('live');
    }

    // Swap the outgoing video track in place: viewers keep their connection.
    async function flip()
    {
        const session = sessionRef.current;
        if (!session)
        {
            return;
        }
        const next: Facing = facing === 'environment' ? 'user' : 'environment';
        let stream: MediaStream;
        try
        {
            session.stream.getVideoTracks().forEach(track => track.stop());
            stream = await navigator.mediaDevices.getUserMedia(cameraConstraints(next));
        }
        catch (cause)
        {
            fail(describeMediaError(cause, window.isSecureContext));
            return;
        }
        const track = stream.getVideoTracks()[0];
        await Promise.all([...session.peers.values()].flatMap(pc => pc.getSenders()
            .filter(sender => sender.track?.kind === 'video' || sender.track === null)
            .map(sender => sender.replaceTrack(track).catch(() => undefined))));
        session.stream = stream;
        if (previewRef.current)
        {
            previewRef.current.srcObject = stream;
        }
        setFacing(next);
    }

    const live = status === 'live';
    const busy = status === 'starting';

    return (
        <main className="min-h-dvh bg-night-950 p-4">
            <GlassPanel className="mx-auto flex w-full max-w-md flex-col gap-4 p-5">
                <header>
                    <p className="text-xs font-semibold tracking-[0.2em] text-ink-muted">HATCHWATCH</p>
                    <h1 className="mt-1 text-xl font-semibold">Camera</h1>
                    <p className="mt-1 text-sm text-ink-muted">Signed in as {userName}</p>
                </header>

                <div className={live ? 'relative overflow-hidden rounded-lg border border-white/8 bg-black' : 'hidden'}>
                    <video ref={previewRef} muted autoPlay playsInline className="aspect-video w-full object-cover" data-testid="cam-preview" />
                    {live && (
                        <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-danger/90 px-2 py-0.5 text-xs font-semibold text-white">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden />
                            LIVE
                        </span>
                    )}
                </div>

                {!live && (
                    <>
                        <label className="block text-sm">
                            <span className="text-ink-muted">Device name</span>
                            <input
                                value={name}
                                onChange={event => setName(event.target.value)}
                                maxLength={60}
                                placeholder="Phone camera"
                                disabled={busy}
                                className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-night-900 px-3 outline-none focus:border-amber"
                            />
                        </label>
                        <fieldset className="text-sm" disabled={busy}>
                            <legend className="text-ink-muted">Camera</legend>
                            <div className="mt-1 grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-night-900 p-1">
                                {(['environment', 'user'] as const).map(option => (
                                    <button
                                        key={option}
                                        type="button"
                                        aria-pressed={facing === option}
                                        onClick={() => setFacing(option)}
                                        className={facing === option ? 'h-8 rounded-md bg-white/10 font-medium' : 'h-8 rounded-md text-ink-muted'}
                                    >
                                        {option === 'environment' ? 'Rear' : 'Front'}
                                    </button>
                                ))}
                            </div>
                        </fieldset>
                        <Button variant="primary" className="h-12 w-full text-base" onClick={start} disabled={busy}>
                            <Video className="h-5 w-5" aria-hidden />
                            {busy ? 'Starting…' : 'Start streaming'}
                        </Button>
                    </>
                )}

                {live && (
                    <>
                        <p className="text-sm" aria-live="polite">
                            <span className="font-medium">{name}</span>
                            <span className="text-ink-muted"> · {viewers} {viewers === 1 ? 'viewer' : 'viewers'}</span>
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                            <Button onClick={flip}><RefreshCw className="h-4 w-4" aria-hidden />Flip</Button>
                            <Button onClick={stop}><Square className="h-4 w-4" aria-hidden />Stop</Button>
                        </div>
                        <p className="text-sm text-ink-muted">
                            Keep this page open and the screen on. Ask an admin to pick &lsquo;{name}&rsquo; as the source of a camera.
                            Video goes straight to the dashboard over Wi-Fi and is not recorded.
                        </p>
                    </>
                )}

                {error && (
                    <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>
                )}
            </GlassPanel>
        </main>
    );
}
