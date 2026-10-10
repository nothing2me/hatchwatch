'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { Activity, LoaderCircle, Maximize2, VideoOff, X } from 'lucide-react';
import type { MaskPoint } from '@/lib/cameras/masks';
import type { BoardMotionView, LiveDeviceKind, LiveDeviceView } from '@/lib/types';
import { cn } from '@/lib/cn';
import type { LiveFrameState } from './framePoller';
import { useModal } from './ConnectPhone';
import { DetectionNote, DetectionOverlay, DetectionStatus } from './DetectionOverlay';
import { useLiveFrame } from './useLiveFrame';

const action = 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/12 px-2.5 text-xs text-ink transition-colors hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-amber';

export function RecBadge()
{
    return (
        <span className="inline-flex h-5 items-center gap-1 rounded bg-alarm px-1.5 text-[10px] font-bold tracking-[0.12em] text-white shadow-[0_0_12px_rgba(255,77,94,0.45)]">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-white motion-safe:animate-pulse" />
            REC
        </span>
    );
}

// The board's box over the picture. The SVG uses the picture's own pixels and object-contain's letterboxing (xMidYMid meet).
export function MotionBox({ box, width, height }: { box: [number, number, number, number]; width: number; height: number })
{
    const [x, y, w, h] = box;
    return (
        <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
            <rect x={x} y={y} width={w} height={h} fill="none" stroke="#F5B544" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
    );
}

export function MotionBadge({ motion }: { motion: BoardMotionView | null })
{
    const pill = 'inline-flex h-5 items-center rounded px-1.5 font-mono text-[10px] font-bold tracking-[0.06em]';
    if (motion?.active)
    {
        return <span className={cn(pill, 'bg-amber text-night-950 shadow-[0_0_12px_rgba(245,181,68,0.4)]')}>Moving {motion.percent.toFixed(1)}%</span>;
    }
    return <span className={cn(pill, 'bg-night-950/80 text-ink-muted ring-1 ring-white/12')}>{motion ? 'Still' : 'No motion reading'}</span>;
}

// Marks a map camera that is showing its linked device's picture instead of the recorded clip.
export function LiveBadge()
{
    return (
        <span className="inline-flex h-5 items-center gap-1 rounded bg-alarm px-1.5 text-[10px] font-bold tracking-[0.12em] text-white shadow-[0_0_12px_rgba(255,77,94,0.45)]">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-white motion-safe:animate-pulse" />
            LIVE
        </span>
    );
}

// The picture box: the frame, a spinner before the first one, or why there is none.
export function LivePicture({ url, state, name, kind = 'PHONE', className, onNaturalSize, children }: { url: string | null; state: LiveFrameState | 'idle'; name: string; kind?: LiveDeviceKind; className?: string; onNaturalSize?: (width: number, height: number) => void; children?: React.ReactNode })
{
    const gone = state === 'offline' || state === 'signed-out';
    return (
        <div className={cn('relative overflow-hidden bg-black', className)}>
            {url && <img src={url} alt={`Live picture from ${name}`} onLoad={event => onNaturalSize?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} className={cn('h-full w-full object-contain', gone && 'opacity-30')} />}
            {children}
            {!url && !gone && (
                <span className="absolute inset-0 grid place-items-center text-ink-muted">
                    <LoaderCircle aria-hidden className="h-6 w-6 motion-safe:animate-spin" />
                    <span className="sr-only">Loading picture</span>
                </span>
            )}
            {gone && (
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-ink-muted">
                    <VideoOff aria-hidden className="h-5 w-5" />
                    {state === 'offline' ? (kind === 'BOARD' ? 'Board offline' : 'Phone offline') : 'Signed out. Reload to sign in again.'}
                </span>
            )}
        </div>
    );
}

function Expanded({ device, url, state, detectionsOn, mask, onClose, returnTo }: { device: LiveDeviceView; url: string | null; state: LiveFrameState | 'idle'; detectionsOn: boolean; mask: MaskPoint[] | null; onClose: () => void; returnTo: React.RefObject<HTMLButtonElement | null> })
{
    const dialogRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    useModal(dialogRef, closeRef, onClose, returnTo);
    const titleId = `expanded-${device.id}`;
    const detections = detectionsOn && device.online ? device.detections : null;
    return (
        <div className="fixed inset-0 z-50 bg-black/90 p-3 backdrop-blur-sm sm:p-5" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex h-full flex-col gap-3">
                <div className="flex items-center gap-3">
                    <h2 id={titleId} className="truncate text-sm font-semibold text-ink">{device.name}</h2>
                    {device.recording && <RecBadge />}
                    <span className="truncate text-xs text-ink-muted max-sm:hidden">by {device.ownerName}</span>
                    {detectionsOn && device.online && <DetectionStatus detections={device.detections} className="shrink-0" />}
                    <button ref={closeRef} type="button" onClick={onClose} className={cn(action, 'ml-auto shrink-0')}>
                        <X aria-hidden className="h-3.5 w-3.5" />
                        Close
                    </button>
                </div>
                <LivePicture url={url} state={state} name={device.name} kind={device.kind} className="min-h-0 flex-1 rounded-xl">
                    {detections && !detections.dark && <DetectionOverlay detections={detections} mask={mask} />}
                </LivePicture>
                {detectionsOn && device.online && <DetectionNote detections={device.detections} />}
            </div>
        </div>
    );
}

// One device's picture with its name, REC, the board motion badge and box, Motion view, Expand and the detection lines.
// `live` adds the LIVE badge when the tile stands in for a map camera. `mask` is the linked camera's watch area (unlinked: null).
export function DeviceTile({ device, detectionsOn, mask = null, live = false }: { device: LiveDeviceView; detectionsOn: boolean; mask?: MaskPoint[] | null; live?: boolean })
{
    const { url, state } = useLiveFrame(device.id);
    const [open, setOpen] = useState(false);
    const expandRef = useRef<HTMLButtonElement>(null);
    const [size, setSize] = useState<{ width: number; height: number } | null>(null);
    const board = device.kind === 'BOARD';
    const box = device.motion?.box;
    const showBox = board && device.motion?.active && size && box && box[2] > 0 && box[3] > 0;
    const showDetections = detectionsOn && device.online;
    const detections = showDetections ? device.detections : null;
    return (
        <article aria-label={device.name} className="overflow-hidden rounded-2xl border border-white/8 bg-night-900/70">
            <div className="relative">
                <LivePicture url={url} state={state} name={device.name} kind={device.kind} className="aspect-video" onNaturalSize={(width, height) => setSize(previous => previous?.width === width && previous.height === height ? previous : { width, height })}>
                    {showBox && <MotionBox box={box} width={size.width} height={size.height} />}
                    {detections && !detections.dark && <DetectionOverlay detections={detections} mask={mask} />}
                </LivePicture>
                {(live || device.recording) && (
                    <span className="absolute top-2.5 left-2.5 flex gap-1.5">
                        {live && <LiveBadge />}
                        {device.recording && <RecBadge />}
                    </span>
                )}
                {board && <span className="absolute top-2.5 right-2.5"><MotionBadge motion={device.motion} /></span>}
            </div>
            <div className="flex flex-wrap items-end gap-x-3 gap-y-3 p-4">
                <div className={cn('min-w-0 flex-1', board && 'basis-52')}>
                    <p className="truncate font-semibold text-ink">{device.name}</p>
                    <p className="mt-0.5 truncate text-xs text-ink-muted">{board ? `Camera board · added by ${device.ownerName}` : `by ${device.ownerName}`}</p>
                    <p className={cn('mt-1.5 text-xs', device.cameraCode ? 'font-mono text-amber' : 'text-ink-muted')}>{device.cameraCode ? `Camera ${device.cameraCode}` : 'Not linked to a map camera'}</p>
                    {board && <p className="mt-1 text-[11px] text-ink-muted">Motion measured on the camera board</p>}
                    {showDetections && <DetectionStatus detections={device.detections} className="mt-1" />}
                </div>
                <div className="flex shrink-0 gap-1.5">
                    <Link href={`/cameras/motion?device=${encodeURIComponent(device.id)}`} className={action}>
                        <Activity aria-hidden className="h-3.5 w-3.5" />
                        Motion view
                    </Link>
                    <button ref={expandRef} type="button" onClick={() => setOpen(true)} className={action}>
                        <Maximize2 aria-hidden className="h-3.5 w-3.5" />
                        Expand
                    </button>
                </div>
                {showDetections && <DetectionNote detections={device.detections} className="w-full border-t border-white/8 pt-2.5" />}
            </div>
            {open && <Expanded device={device} url={url} state={state} detectionsOn={detectionsOn} mask={mask} onClose={() => setOpen(false)} returnTo={expandRef} />}
        </article>
    );
}
