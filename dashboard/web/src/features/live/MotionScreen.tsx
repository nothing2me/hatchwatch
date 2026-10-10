'use client';

import { useEffect, useRef, useState } from 'react';
import { RotateCcw, VideoOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GlassPanel } from '@/components/ui/glass-panel';
import type { SessionUser } from '@/lib/auth/session';
import { cn } from '@/lib/cn';
import { isNestSite } from '@/lib/danger';
import type { MapSnapshot } from '@/lib/types';
import { feedFor } from '@/features/cameras/feed';
import { TopBar } from '@/features/shell/TopBar';
import { LiveVideo } from './LiveVideo';
import { isSameFrame, paintDifference, toBlurredGray, updateBackground } from './motionDifference';
import { useLiveSnapshot } from './useLiveSnapshot';
import { useLiveStatus } from './useLiveStatus';

type Mode = 'background' | 'previous';

// Width the difference is worked out at; the height follows the picture's shape.
const ANALYSIS_WIDTH = 320;
const ANALYSIS_MS = 100;
// How quickly the background adopts the current picture, per new frame.
const BACKGROUND_RATE = 0.03;

interface History
{
    previous: Float32Array | null;
    background: Float32Array | null;
    width: number;
    height: number;
}

const emptyHistory = (width = 0, height = 0): History => ({ previous: null, background: null, width, height });

// One live camera next to the motion in its picture. Worked out in this browser only: never stored,
// never sent, and not the research detector.
export function MotionScreen({ user, initialSnapshot, initialCamera }: { user: SessionUser; initialSnapshot: MapSnapshot; initialCamera: string | null })
{
    const snapshot = useLiveSnapshot(initialSnapshot);
    const live = useLiveStatus();
    const [code, setCode] = useState<string | null>(initialCamera);
    const [mode, setMode] = useState<Mode>('background');
    const [threshold, setThreshold] = useState(20);
    const [share, setShare] = useState(0);
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const history = useRef<History>(emptyHistory());
    // The analysis loop reads the controls through a ref so it never restarts.
    const settings = useRef({ mode, threshold });
    settings.current = { mode, threshold };

    // Without a camera in the address, open the first one that is streaming live.
    const firstLive = snapshot.cameras.find(camera => feedFor(camera, live).kind === 'live')?.code ?? null;
    const shownCode = code ?? firstLive ?? snapshot.cameras[0]?.code ?? null;
    const camera = snapshot.cameras.find(candidate => candidate.code === shownCode) ?? null;
    const feed = camera ? feedFor(camera, live) : null;
    const deviceId = feed?.kind === 'live' ? feed.deviceId : null;

    useEffect(() =>
    {
        history.current = emptyHistory();
        setShare(0);
        if (!deviceId)
        {
            return undefined;
        }
        const sample = document.createElement('canvas');
        const sampleContext = sample.getContext('2d', { willReadFrequently: true });
        const timer = setInterval(() =>
        {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            if (!video || !canvas || !sampleContext || video.readyState < 2 || !video.videoWidth)
            {
                return;
            }
            const width = ANALYSIS_WIDTH;
            const height = Math.max(1, Math.round(ANALYSIS_WIDTH * video.videoHeight / video.videoWidth));
            // A new picture size (the phone rotated or flipped camera) starts over.
            if (history.current.width !== width || history.current.height !== height || canvas.width !== width || canvas.height !== height)
            {
                sample.width = canvas.width = width;
                sample.height = canvas.height = height;
                history.current = emptyHistory(width, height);
            }
            sampleContext.drawImage(video, 0, 0, width, height);
            const frame = toBlurredGray(sampleContext.getImageData(0, 0, width, height).data, width, height);
            const current = history.current;
            if (isSameFrame(current.previous, frame))
            {
                return;
            }
            if (!current.previous || !current.background)
            {
                current.previous = frame;
                current.background = frame.slice();
                return;
            }
            const reference = settings.current.mode === 'previous' ? current.previous : current.background;
            const context = canvas.getContext('2d');
            if (!context)
            {
                return;
            }
            const output = context.createImageData(width, height);
            const moving = paintDifference(frame, reference, output.data, settings.current.threshold);
            context.putImageData(output, 0, 0);
            // The background keeps learning in both modes, so switching is instant.
            updateBackground(current.background, frame, BACKGROUND_RATE);
            current.previous = frame;
            setShare(moving);
        }, ANALYSIS_MS);
        return () => clearInterval(timer);
    }, [deviceId]);

    function chooseCamera(next: string)
    {
        setCode(next);
        window.history.replaceState(null, '', `/motion?camera=${encodeURIComponent(next)}`);
    }

    function resetBackground()
    {
        const current = history.current;
        current.background = current.previous ? current.previous.slice() : null;
    }

    const activeSites = snapshot.alerts.filter(alert => isNestSite(alert) && alert.site.active).length;
    const firstDangerId = snapshot.alerts.find(alert => alert.kind === 'DANGER' && alert.site.active)?.id ?? null;
    const percent = (share * 100).toFixed(1);
    const missing = (
        <div className="grid aspect-video place-content-center gap-2 rounded-lg bg-night-950 px-4 text-center text-sm text-ink-muted">
            <VideoOff aria-hidden className="mx-auto h-6 w-6" />
            {camera ? `No live device on ${camera.code}. Open it on the map and pick a phone under Source.` : 'No cameras yet.'}
        </div>
    );

    return (
        <main className="min-h-full bg-night-950">
            <div className="sticky top-0 z-20 bg-night-950/90 p-3 backdrop-blur-md">
                <TopBar user={user} current="cameras" camerasOnline={snapshot.camerasOnline} camerasTotal={snapshot.camerasTotal} activeSites={activeSites} dangerCount={snapshot.dangerCount} firstDangerId={firstDangerId} />
            </div>
            <div className="mx-auto max-w-[1500px] px-4 pt-4 pb-16 sm:px-6">
                <div className="mb-6 flex flex-wrap items-end gap-4">
                    <div>
                        <h1 className="text-3xl font-semibold tracking-tight text-ink">Motion view</h1>
                        <p className="mt-1.5 text-sm text-ink-muted">A live camera next to what is moving in its picture</p>
                    </div>
                    <label className="ml-auto flex items-center gap-2 text-sm">
                        <span className="text-ink-muted">Camera</span>
                        <select value={shownCode ?? ''} onChange={event => chooseCamera(event.target.value)} className="h-9 rounded-lg border border-white/10 bg-night-900 px-2 outline-none focus:border-amber">
                            {snapshot.cameras.map(option =>
                            {
                                const optionFeed = feedFor(option, live);
                                return <option key={option.id} value={option.code}>{option.code}{optionFeed.kind === 'live' ? ` · LIVE ${optionFeed.deviceName}` : ''}</option>;
                            })}
                        </select>
                    </label>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                    <GlassPanel className="min-w-0 p-3">
                        <h2 className="flex items-center gap-2 px-1 text-sm font-semibold">
                            <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', deviceId ? 'bg-ok' : 'bg-danger')} />
                            Live feed{camera ? ` · ${camera.code}` : ''}{feed?.kind === 'live' ? ` · ${feed.deviceName}` : ''}
                        </h2>
                        {deviceId ? <LiveVideo key={deviceId} deviceId={deviceId} videoRef={videoRef} large /> : <div className="mt-2">{missing}</div>}
                    </GlassPanel>
                    <GlassPanel className="min-w-0 p-3">
                        <h2 className="px-1 text-sm font-semibold">Motion · {mode === 'previous' ? 'since last frame' : 'against background'}</h2>
                        {deviceId
                            ? <canvas ref={canvasRef} role="img" aria-label={`Motion in ${percent}% of the picture`} className="mt-2 aspect-video w-full rounded-lg border border-white/6 bg-black object-contain" />
                            : <div className="mt-2">{missing}</div>}
                    </GlassPanel>
                </div>

                <GlassPanel className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 p-4 text-sm">
                    <div className="flex min-w-48 flex-1 items-center gap-3">
                        <span>Motion <strong className="font-mono tabular-nums">{percent}%</strong> of the picture</span>
                        <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
                            <span className="block h-full rounded-full bg-amber transition-[width]" style={{ width: `${Math.min(100, share * 400)}%` }} />
                        </span>
                    </div>
                    <div role="group" aria-label="Compare with" className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-night-900 p-1">
                        {([['background', 'Against background'], ['previous', 'Since last frame']] as const).map(([value, label]) => (
                            <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}
                                className={cn('h-8 rounded-md px-3', mode === value ? 'bg-white/10 font-medium' : 'text-ink-muted hover:text-ink')}>
                                {label}
                            </button>
                        ))}
                    </div>
                    <label className="flex items-center gap-2">
                        <span className="text-ink-muted">Threshold</span>
                        <input type="range" min={5} max={60} value={threshold} onChange={event => setThreshold(Number(event.target.value))} className="accent-amber" />
                        <span className="w-6 font-mono tabular-nums">{threshold}</span>
                    </label>
                    <Button size="sm" onClick={resetBackground} disabled={!deviceId}><RotateCcw aria-hidden className="h-3.5 w-3.5" />Reset background</Button>
                    <p className="basis-full text-xs text-ink-muted">
                        Against background compares with a slowly updated picture of the scene, so something that stops moving fades out over a few seconds; since last frame shows only what changed between frames.
                        Worked out in this browser from the live picture: not saved, not sent, and not the digging detector.
                    </p>
                </GlassPanel>
            </div>
        </main>
    );
}
