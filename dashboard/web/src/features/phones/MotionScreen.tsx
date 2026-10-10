'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Info, RotateCcw, VideoOff } from 'lucide-react';
import { TopBar, type TopBarCounts } from '@/features/shell/TopBar';
import type { SessionUser } from '@/lib/auth/session';
import { cn } from '@/lib/cn';
import { ANALYSIS_WIDTH, DEFAULT_THRESHOLD, isSameFrame, paintDifference, toBlurredGray, updateBackground, type MotionMode } from './motion';
import { LivePicture, RecBadge } from './LiveScreen';
import { useLiveDevices } from './useLiveDevices';
import { useLiveFrame } from './useLiveFrame';

const ANALYSIS_MS = 200;

const MODES: { mode: MotionMode; label: string }[] = [
    { mode: 'background', label: 'Against background' },
    { mode: 'previous', label: 'Since last frame' },
];

interface History
{
    previous: Float32Array | null;
    background: Float32Array | null;
    width: number;
    height: number;
}

const emptyHistory = (): History => ({ previous: null, background: null, width: 0, height: 0 });

const pane = 'overflow-hidden rounded-2xl border border-white/8 bg-night-900/70';
const paneTitle = 'flex items-center gap-2 px-4 py-2.5 text-[11px] font-semibold tracking-[0.14em] text-ink-muted uppercase';

// One phone's live picture beside the difference worked out from it in the browser. A viewing aid, not the detector.
export function MotionScreen({ user, bar, deviceId }: { user: SessionUser; bar: TopBarCounts; deviceId: string | null })
{
    const { devices } = useLiveDevices(3000);
    const { url, state } = useLiveFrame(deviceId, 5);
    const device = devices.find(candidate => candidate.id === deviceId);
    const name = device?.name ?? 'Unknown phone';

    const [mode, setMode] = useState<MotionMode>('background');
    const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
    const [share, setShare] = useState(0);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const holderRef = useRef<HTMLDivElement>(null);
    // The loop reads settings through a ref so moving the slider never restarts it.
    const settings = useRef({ mode, threshold });
    settings.current = { mode, threshold };
    const history = useRef<History>(emptyHistory());
    const live = state === 'live';

    // The live <img> lives inside LivePicture; find it after each render.
    useEffect(() =>
    {
        imageRef.current = holderRef.current?.querySelector('img') ?? null;
    });

    useEffect(() =>
    {
        if (!live)
        {
            return;
        }
        // Fresh history whenever analysis (re)starts: a new phone, or a phone back from offline.
        history.current = emptyHistory();
        setShare(0);
        const sample = document.createElement('canvas');
        const sampleContext = sample.getContext('2d', { willReadFrequently: true });
        const timer = setInterval(() =>
        {
            const image = imageRef.current;
            const canvas = canvasRef.current;
            if (!image || !canvas || !sampleContext || !image.complete || !image.naturalWidth)
            {
                return;
            }
            const width = ANALYSIS_WIDTH;
            const height = Math.max(1, Math.round(ANALYSIS_WIDTH * image.naturalHeight / image.naturalWidth));
            if (history.current.width !== width || history.current.height !== height || canvas.width !== width || canvas.height !== height)
            {
                sample.width = canvas.width = width;
                sample.height = canvas.height = height;
                history.current = { ...emptyHistory(), width, height };
            }
            sampleContext.drawImage(image, 0, 0, width, height);
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
            // Both modes keep the background learning, so switching is instant.
            updateBackground(current.background, frame);
            current.previous = frame;
            setShare(moving);
        }, ANALYSIS_MS);
        return () => clearInterval(timer);
    }, [live, deviceId]);

    function resetBackground()
    {
        const current = history.current;
        current.background = current.previous ? current.previous.slice() : null;
    }

    const percent = Math.round(share * 1000) / 10;

    return (
        <main className="relative min-h-full overflow-x-hidden bg-night-950">
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(215,227,234,0.06)_1px,transparent_1px)] [mask-image:linear-gradient(to_bottom,black,transparent_70%)] bg-[size:22px_22px]" />

            <div className="sticky top-0 z-20 p-3">
                <TopBar user={user} current="live" {...bar} />
            </div>

            <div className="relative mx-auto max-w-6xl px-4 pt-6 pb-16 sm:px-6 sm:pt-10">
                <Link href="/live" className="inline-flex items-center gap-1.5 rounded-md text-sm text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-amber">
                    <ArrowLeft aria-hidden className="h-4 w-4" />
                    Live cameras
                </Link>
                <h1 className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                    <span className="min-w-0 break-words">Motion view{deviceId && <span className="text-ink-muted"> · {name}</span>}</span>
                    {device?.recording && <RecBadge />}
                </h1>

                <p className="mt-4 flex items-start gap-2 rounded-lg border border-amber/25 bg-amber/[0.07] px-3 py-2 text-sm text-ink">
                    <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
                    Viewing aid only. This is not the digging detector and raises no alerts.
                </p>

                {!deviceId
                    ? (
                        <div className="mt-8 rounded-2xl border border-dashed border-white/12 bg-night-900/40 px-6 py-12 text-center">
                            <p className="font-medium text-ink">Choose a phone on Live cameras.</p>
                            <Link href="/live" className="mt-3 inline-flex h-9 items-center rounded-lg border border-white/12 px-3 text-sm text-ink transition-colors hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-amber">Open Live cameras</Link>
                        </div>
                    )
                    : (
                        <>
                            {state === 'offline' && (
                                <p role="status" className="mt-4 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-ink-muted">
                                    <VideoOff aria-hidden className="h-4 w-4 shrink-0" />
                                    Phone offline. The motion view resumes when it sends again.
                                </p>
                            )}
                            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                                <section aria-labelledby="pane-live" className={pane}>
                                    <h2 id="pane-live" className={paneTitle}>
                                        <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-ok' : 'bg-ink-muted')} />
                                        Live
                                    </h2>
                                    <div ref={holderRef}>
                                        <LivePicture url={url} state={state} name={name} className="aspect-video" />
                                    </div>
                                </section>
                                <section aria-labelledby="pane-motion" className={pane}>
                                    <h2 id="pane-motion" className={paneTitle}>
                                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber" />
                                        Motion · {mode === 'previous' ? 'since last frame' : 'against background'}
                                    </h2>
                                    <div className="relative aspect-video bg-black">
                                        <canvas ref={canvasRef} width={ANALYSIS_WIDTH} height={180} role="img" aria-label={`Motion in ${percent} % of the picture`} className={cn('h-full w-full object-contain', !live && 'opacity-0')} />
                                        {!live && <span className="absolute inset-0 grid place-items-center text-sm text-ink-muted">{state === 'offline' ? 'Paused' : 'Waiting for the picture'}</span>}
                                    </div>
                                </section>
                            </div>

                            <section aria-label="Motion settings" className="mt-4 grid gap-5 rounded-2xl border border-white/8 bg-night-900/70 p-4 sm:p-5 lg:grid-cols-[1fr_auto] lg:items-center">
                                <div className="min-w-0">
                                    <p className="text-sm text-ink" aria-live="polite"><span className="font-mono text-lg font-semibold text-amber tabular-nums">{percent} %</span> of the picture moving</p>
                                    <span aria-hidden className="mt-2 block h-1.5 overflow-hidden rounded-full bg-white/8">
                                        <span className="block h-full rounded-full bg-amber transition-[width] duration-200" style={{ width: `${Math.min(100, share * 400)}%` }} />
                                    </span>
                                    <label htmlFor="motion-threshold" className="mt-5 flex items-baseline justify-between gap-3 text-xs text-ink-muted">
                                        <span>Threshold: brightness change that counts as motion</span>
                                        <output htmlFor="motion-threshold" className="font-mono text-sm text-ink tabular-nums">{threshold}</output>
                                    </label>
                                    <input id="motion-threshold" type="range" min={5} max={80} value={threshold} onChange={event => setThreshold(Number(event.target.value))} className="mt-2 w-full accent-amber" />
                                </div>
                                <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
                                    <div role="group" aria-label="Compare with" className="grid grid-cols-2 rounded-xl bg-night-950/70 p-1 ring-1 ring-white/8">
                                        {MODES.map(option => (
                                            <button
                                                key={option.mode}
                                                type="button"
                                                aria-pressed={mode === option.mode}
                                                onClick={() => setMode(option.mode)}
                                                className={cn('h-8 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-amber',
                                                    mode === option.mode ? 'bg-white/10 text-ink shadow-sm shadow-black/40' : 'text-ink-muted hover:text-ink')}
                                            >
                                                {option.label}
                                            </button>
                                        ))}
                                    </div>
                                    <button type="button" onClick={resetBackground} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/12 px-3 text-xs text-ink transition-colors hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-amber">
                                        <RotateCcw aria-hidden className="h-3.5 w-3.5" />
                                        Reset background
                                    </button>
                                </div>
                            </section>
                        </>
                    )}
            </div>
        </main>
    );
}
