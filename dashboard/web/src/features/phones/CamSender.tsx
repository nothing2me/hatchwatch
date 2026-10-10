'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Camera, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GlassPanel } from '@/components/ui/glass-panel';
import type { Role } from '@/lib/types';
import { cn } from '@/lib/cn';
import { readStored, STORAGE_KEYS } from '@/lib/storageKeys';
import { describeFrameStatus, describeMediaError, MESSAGES, QUALITY_PRESETS, type QualityName } from './camMessages';
import { startFrameSender, type FrameSender } from './frameSender';

type Facing = 'environment' | 'user';
type Notice = { tone: 'bad' | 'warning'; text: string; signIn?: boolean };

const field = 'mt-1 h-11 w-full rounded-lg border border-white/10 bg-night-900 px-3 text-base outline-none focus:border-amber';

function loadPhoneName(): string
{
    try
    {
        return readStored(localStorage, 'phoneName') ?? '';
    }
    catch
    {
        return '';
    }
}

function wait(ms: number): Promise<void>
{
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function CamSender({ user }: { user: { name: string; role: Role } })
{
    const canSend = user.role === 'VOLUNTEER' || user.role === 'ADMIN';
    const [name, setName] = useState(loadPhoneName);
    const [facing, setFacing] = useState<Facing>('environment');
    const [quality, setQuality] = useState<QualityName>('standard');
    const [phase, setPhase] = useState<'form' | 'starting' | 'live'>('form');
    const [notice, setNotice] = useState<Notice | null>(null);
    const [cameraCode, setCameraCode] = useState<string | null>(null);
    const [fps, setFps] = useState(0);

    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const wakeLockRef = useRef<WakeLockSentinel | null>(null);
    const senderRef = useRef<FrameSender | null>(null);
    // Bumped by every Start and Stop so a stale start or loop never touches the page again.
    const runIdRef = useRef(0);

    async function keepScreenOn()
    {
        try
        {
            wakeLockRef.current = (await navigator.wakeLock?.request('screen')) ?? null;
        }
        catch
        {
            // Not supported or refused: the phone may dim and the browser may pause the camera.
        }
    }

    function release()
    {
        runIdRef.current += 1;
        senderRef.current?.stop();
        senderRef.current = null;
        streamRef.current?.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        if (videoRef.current)
        {
            videoRef.current.srcObject = null;
        }
        wakeLockRef.current?.release().catch(() => {});
        wakeLockRef.current = null;
    }

    function stop()
    {
        release();
        setPhase('form');
    }

    async function start(event: FormEvent<HTMLFormElement>)
    {
        event.preventDefault();
        setNotice(null);
        const runId = ++runIdRef.current;
        const preset = QUALITY_PRESETS[quality];
        const phoneName = name.trim();

        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        {
            setNotice({ tone: 'bad', text: MESSAGES.https });
            return;
        }

        setPhase('starting');
        let stream: MediaStream;
        try
        {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: { facingMode: { ideal: facing }, width: { ideal: preset.width }, height: { ideal: preset.height } },
            });
        }
        catch (error)
        {
            setNotice({ tone: 'bad', text: describeMediaError(error) });
            setPhase('form');
            return;
        }
        if (runId !== runIdRef.current)
        {
            stream.getTracks().forEach(track => track.stop());
            return;
        }
        streamRef.current = stream;

        let deviceId: string;
        try
        {
            const response = await fetch('/api/live/devices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: phoneName }),
            });
            const body = await response.json().catch(() => null) as { id?: string; cameraCode?: string | null; error?: string } | null;
            if (!response.ok || !body?.id)
            {
                const text = response.status === 400 && body?.error ? body.error : describeFrameStatus(response.status) ?? MESSAGES.offline;
                release();
                setNotice({ tone: 'bad', text, signIn: response.status === 401 });
                setPhase('form');
                return;
            }
            deviceId = body.id;
            setCameraCode(body.cameraCode ?? null);
        }
        catch
        {
            release();
            setNotice({ tone: 'bad', text: 'Could not reach the server. Check the Wi-Fi and press Start again.' });
            setPhase('form');
            return;
        }
        if (runId !== runIdRef.current)
        {
            return;
        }

        try
        {
            localStorage.setItem(STORAGE_KEYS.phoneName, phoneName);
        }
        catch
        {
            // Not remembered; nothing else depends on it.
        }

        const video = videoRef.current!;
        video.srcObject = stream;
        try
        {
            await video.play();
        }
        catch
        {
            // Autoplay of a muted inline video is allowed; frames are still drawn once it starts.
        }
        await keepScreenOn();
        if (runId !== runIdRef.current)
        {
            return;
        }

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        setFps(0);
        setPhase('live');
        senderRef.current = startFrameSender({
            deviceId,
            jpegQuality: preset.jpegQuality,
            encode: jpegQuality =>
            {
                const width = video.videoWidth;
                const height = video.videoHeight;
                if (!context || !width || !height)
                {
                    return Promise.resolve(null);
                }
                // Scale down to the preset width, keeping the camera's shape.
                const scale = Math.min(1, preset.width / width);
                canvas.width = Math.round(width * scale);
                canvas.height = Math.round(height * scale);
                context.drawImage(video, 0, 0, canvas.width, canvas.height);
                return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', jpegQuality));
            },
            fetch: (url, init) => fetch(url, init),
            now: () => performance.now(),
            sleep: wait,
            onUpdate: update =>
            {
                if (runId !== runIdRef.current)
                {
                    return;
                }
                if (update.kind === 'sent')
                {
                    setCameraCode(update.cameraCode);
                    setFps(update.fps);
                    setNotice(null);
                }
                else if (update.kind === 'retrying')
                {
                    setNotice({ tone: 'warning', text: update.message });
                }
                else
                {
                    release();
                    setNotice({ tone: 'bad', text: update.message, signIn: update.status === 401 });
                    setPhase('form');
                }
            },
        });
    }

    // The wake lock drops whenever the page is hidden; take it back on return.
    useEffect(() =>
    {
        function onVisibility()
        {
            if (document.visibilityState === 'visible' && senderRef.current)
            {
                void keepScreenOn();
            }
        }
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, []);

    // Release the camera if the page is left while sending.
    useEffect(() => release, []);

    const live = phase === 'live';

    return (
        <main className="relative min-h-full overflow-x-hidden bg-night-950 px-4 py-6">
            {/* Faint shoreline gradient as the backdrop */}
            <div aria-hidden className="fixed inset-0 bg-[linear-gradient(118deg,#0a1118_0%,#111c25_45%,#16303f_52%,#0a1118_100%)]" />
            <div className="relative mx-auto flex w-full max-w-md flex-col gap-4">
                <header className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-xs font-semibold tracking-[0.2em] text-ink-muted">HATCHWATCH</p>
                        <h1 className="mt-1 text-xl font-semibold">HatchWatch camera</h1>
                        <p className="mt-0.5 truncate text-sm text-ink-muted">Signed in as {user.name}</p>
                    </div>
                    <span className={cn('mt-1 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs',
                        live ? 'bg-alarm/15 text-alarm ring-1 ring-alarm/30' : 'bg-white/5 text-ink-muted')}>
                        <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-alarm motion-safe:animate-pulse' : 'bg-ink-muted')} />
                        {live ? 'Live' : 'Not sending'}
                    </span>
                </header>

                <GlassPanel className={cn('overflow-hidden', !live && 'hidden')}>
                    <video ref={videoRef} muted playsInline className="aspect-video w-full bg-black object-contain" />
                </GlassPanel>

                {!canSend ? (
                    <GlassPanel className="p-5">
                        <p className="text-sm">{MESSAGES.viewer}</p>
                        <Link href="/" className="mt-4 inline-flex h-11 items-center rounded-lg border border-white/10 bg-white/5 px-4 text-sm hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-amber">
                            Back to the dashboard
                        </Link>
                    </GlassPanel>
                ) : live ? (
                    <GlassPanel className="space-y-4 p-5">
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium" role="status">
                                {cameraCode ? `Live · linked to ${cameraCode}` : 'Live · not linked yet'}
                            </p>
                            <p className="shrink-0 font-mono text-sm tabular-nums text-ink-muted">{fps} fps sent</p>
                        </div>
                        <p className="text-sm text-ink-muted">Keep this page open with the screen on and the phone charging.</p>
                        {notice && <p role="alert" className={cn('text-sm', notice.tone === 'bad' ? 'text-danger' : 'text-amber')}>{notice.text}</p>}
                        <Button onClick={stop} className="h-11 w-full">
                            <Square aria-hidden className="h-4 w-4" />Stop
                        </Button>
                    </GlassPanel>
                ) : (
                    <GlassPanel className="p-5">
                        <form onSubmit={start} className="space-y-4">
                            <label className="block text-sm">
                                <span className="text-ink-muted">Phone name</span>
                                <input value={name} onChange={event => setName(event.target.value)} maxLength={60} required
                                    placeholder="e.g. Dune phone north" autoComplete="off" className={field} />
                            </label>
                            <label className="block text-sm">
                                <span className="text-ink-muted">Camera</span>
                                <select value={facing} onChange={event => setFacing(event.target.value as Facing)} className={field}>
                                    <option value="environment">Rear (default)</option>
                                    <option value="user">Front</option>
                                </select>
                            </label>
                            <label className="block text-sm">
                                <span className="text-ink-muted">Quality</span>
                                <select value={quality} onChange={event => setQuality(event.target.value as QualityName)} className={field}>
                                    {(Object.keys(QUALITY_PRESETS) as QualityName[]).map(key => (
                                        <option key={key} value={key}>{QUALITY_PRESETS[key].label}</option>
                                    ))}
                                </select>
                            </label>
                            {notice && (
                                <p role="alert" className={cn('text-sm', notice.tone === 'bad' ? 'text-danger' : 'text-amber')}>
                                    {notice.text}
                                    {notice.signIn && <> <Link href="/login?next=/cam" className="underline">Sign in</Link></>}
                                </p>
                            )}
                            <Button type="submit" variant="primary" className="h-11 w-full" disabled={phase === 'starting'}>
                                <Camera aria-hidden className="h-4 w-4" />Start
                            </Button>
                        </form>
                    </GlassPanel>
                )}
            </div>
        </main>
    );
}
