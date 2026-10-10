'use client';

import Link from 'next/link';
import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Activity, Info, Maximize2, VideoOff, X } from 'lucide-react';
import { GlassPanel } from '@/components/ui/glass-panel';
import { cn } from '@/lib/cn';
import { compassPoint } from '@/lib/geo';
import type { CameraView } from '@/lib/types';
import { DetectionNote, DetectionOverlay, DetectionStatus } from '@/features/phones/DetectionOverlay';
import { SourceSelect } from '@/features/phones/SourceSelect';
import { useDetectionsToggle } from '@/features/phones/useDetectionsToggle';
import { useDeviceDetections } from '@/features/phones/useDeviceDetections';
import { useLiveFrame } from '@/features/phones/useLiveFrame';
import { CameraVideo, type FeedVariant, type SeekRequest } from './CameraVideo';
import { ExpandedFeed } from './ExpandedFeed';
import { PANEL_MAX, PANEL_MIN, PANEL_STEP, usePanelWidth } from './usePanelWidth';

// Selected camera details. A linked phone that is sending shows live; otherwise online cameras with footage loop it and the rest keep the status card.
export function CameraPanel({ camera, onClose, onTime, seekTo = null, canEditSource = false }: { camera: CameraView; onClose: () => void; onTime?: (t: number) => void; seekTo?: SeekRequest | null; canEditSource?: boolean })
{
    const simulated = camera.video?.source === 'SIMULATION';
    const online = camera.status === 'ONLINE';
    const heading = Math.round(camera.headingDeg);
    const { width, setWidth, nudge } = usePanelWidth();
    const drag = useRef<{ x: number; width: number } | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [variant, setVariant] = useState<FeedVariant>('raw');
    const phone = camera.liveDevice;
    const live = useLiveFrame(phone?.id ?? null);
    const showLive = phone !== null && phone !== undefined && live.state === 'live';
    const phoneOffline = Boolean(phone) && (live.state === 'offline' || live.state === 'signed-out');
    const [detectionsOn] = useDetectionsToggle();
    const detections = useDeviceDetections(showLive ? phone!.id : null, detectionsOn);
    // Going live closes the expanded loop, so its placeholder cannot outlive it.
    if (showLive && expanded)
    {
        setExpanded(false);
    }
    // Last clock value seen from whichever player ran, so the panel can pick up where the overlay stopped.
    const lastTime = useRef(0);
    const [resume, setResume] = useState<{ request: SeekRequest; base: SeekRequest | null } | null>(null);
    const track = useCallback((t: number) =>
    {
        lastTime.current = t;
        onTime?.(t);
    }, [onTime]);
    // A newer alert seek wins over the stored resume position.
    const panelSeek = resume && resume.base === seekTo ? resume.request : seekTo;

    // Each player picks up where the other left off, unless a newer alert seek arrived meanwhile.
    function handOff(open: boolean)
    {
        setResume({ request: { t: lastTime.current, nonce: Date.now() }, base: seekTo });
        setExpanded(open);
    }

    function onHandleDown(event: PointerEvent<HTMLDivElement>)
    {
        drag.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture?.(event.pointerId);
    }

    function onHandleMove(event: PointerEvent<HTMLDivElement>)
    {
        if (drag.current)
        {
            setWidth(drag.current.width + (drag.current.x - event.clientX));
        }
    }

    function onHandleKey(event: KeyboardEvent<HTMLDivElement>)
    {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
        {
            event.preventDefault();
            nudge(event.key === 'ArrowLeft' ? PANEL_STEP : -PANEL_STEP);
        }
    }

    const playable = !showLive && camera.video && online ? camera.video : null;

    return (
        <>
        <GlassPanel className="pointer-events-auto relative w-full p-3 md:w-(--panel-w)" style={{ '--panel-w': `${width}px` } as React.CSSProperties}>
            <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize camera panel"
                aria-valuemin={PANEL_MIN}
                aria-valuemax={PANEL_MAX}
                aria-valuenow={width}
                tabIndex={0}
                onPointerDown={onHandleDown}
                onPointerMove={onHandleMove}
                onPointerUp={() => { drag.current = null; }}
                onPointerCancel={() => { drag.current = null; }}
                onKeyDown={onHandleKey}
                className="absolute inset-y-0 -left-0.5 hidden w-1.5 cursor-col-resize touch-none rounded-full transition-colors hover:bg-amber/40 focus-visible:bg-amber/60 focus-visible:outline-none md:block"
            />
            <div className="flex items-center gap-2">
                <p className="text-[10px] font-semibold tracking-[0.16em] text-ink uppercase">Camera {camera.code}</p>
                <span className="text-[10px] tracking-[0.12em] text-ink-muted uppercase">· facing {compassPoint(camera.headingDeg)}</span>
                {playable && (
                    <button type="button" onClick={() => handOff(true)} aria-label="Expand camera view" className="ml-auto grid h-7 w-7 place-items-center rounded-md text-ink-muted transition-colors hover:bg-white/10 hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"><Maximize2 className="h-3.5 w-3.5" /></button>
                )}
                <button type="button" onClick={onClose} aria-label="Close camera panel" className={cn('grid h-7 w-7 place-items-center rounded-md text-ink-muted transition-colors hover:bg-white/10 hover:text-ink focus-visible:outline-2 focus-visible:outline-amber', !playable && 'ml-auto')}><X className="h-4 w-4" /></button>
            </div>

            {showLive
                ? (
                    <div className="relative mt-2 aspect-video max-md:aspect-[5/2] overflow-hidden rounded-lg border border-white/6 bg-black">
                        {live.url && <img src={live.url} alt={`Live picture from ${phone.name}`} className="h-full w-full object-contain" />}
                        {detectionsOn && detections && !detections.dark && <DetectionOverlay detections={detections} />}
                        <span className="absolute top-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-2">
                            <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded bg-alarm px-1.5 text-[10px] font-bold tracking-[0.12em] text-white shadow-[0_0_12px_rgba(255,77,94,0.45)]">
                                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-white motion-safe:animate-pulse" />
                                LIVE
                            </span>
                            <span className="truncate rounded bg-night-950/80 px-1.5 py-0.5 text-[11px] text-ink">{phone.name}</span>
                        </span>
                        <Link href={`/live/motion?device=${encodeURIComponent(phone.id)}`} className="absolute right-2 bottom-2 inline-flex h-7 items-center gap-1.5 rounded-md bg-night-950/85 px-2 text-[11px] text-ink ring-1 ring-white/10 transition-colors hover:bg-night-900 focus-visible:outline-2 focus-visible:outline-amber">
                            <Activity aria-hidden className="h-3.5 w-3.5" />
                            Motion view
                        </Link>
                    </div>
                )
                : playable && expanded
                ? (
                    <div className="mt-2 grid aspect-video max-md:aspect-[5/2] place-items-center rounded-lg border border-white/6 bg-night-950 text-sm text-ink-muted">Playing in expanded view</div>
                )
                : playable
                ? <CameraVideo key={playable.id} video={playable} onTime={track} seekTo={panelSeek} variant={variant} onVariantChange={setVariant} />
                : (
                    <div className="relative mt-2 grid aspect-video max-md:aspect-[5/2] place-items-center overflow-hidden rounded-lg border border-white/6 bg-night-950 text-center">
                        <div aria-hidden className="absolute inset-0 bg-[repeating-linear-gradient(135deg,transparent_0_10px,rgba(255,255,255,0.018)_10px_20px)]" />
                        <span className="relative flex flex-col items-center gap-2 text-sm text-ink-muted">
                            <span className="grid h-9 w-9 place-items-center rounded-full bg-white/5 ring-1 ring-white/10">
                                <VideoOff aria-hidden className="h-4 w-4" />
                            </span>
                            {online ? 'No footage yet' : 'Camera offline'}
                        </span>
                    </div>
                )}
            {showLive && detectionsOn && (
                <div className="mt-1.5 space-y-1">
                    <DetectionStatus detections={detections} />
                    <DetectionNote detections={detections} />
                </div>
            )}
            {phoneOffline && phone && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-muted">
                    <VideoOff aria-hidden className="h-3.5 w-3.5" />
                    Phone offline · {phone.name}
                </p>
            )}

            <dl className="mt-3 grid grid-cols-3 gap-x-2 gap-y-2.5 text-xs">
                <div><dt className="text-[10px] tracking-[0.12em] text-ink-muted uppercase">Zone</dt><dd className="mt-0.5 font-medium">{camera.zoneCode}</dd></div>
                <div>
                    <dt className="text-[10px] tracking-[0.12em] text-ink-muted uppercase">Status</dt>
                    <dd className={cn('mt-0.5 flex items-center gap-1.5 font-medium', online ? 'text-ok' : 'text-danger')}>
                        <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', online ? 'bg-ok' : 'bg-danger')} />{online ? 'Online' : 'Offline'}
                    </dd>
                </div>
                <div><dt className="text-[10px] tracking-[0.12em] text-ink-muted uppercase">Calibrated</dt><dd className="mt-0.5 font-medium">{camera.calibrated ? 'Yes' : 'No'}</dd></div>
                <div><dt className="text-[10px] tracking-[0.12em] text-ink-muted uppercase">Heading</dt><dd className="mt-0.5 font-mono tabular-nums">{heading}°</dd></div>
                <div><dt className="text-[10px] tracking-[0.12em] text-ink-muted uppercase">Field</dt><dd className="mt-0.5 font-mono tabular-nums">{Math.round(camera.fovDeg)}°</dd></div>
                <div><dt className="text-[10px] tracking-[0.12em] text-ink-muted uppercase">Range</dt><dd className="mt-0.5 font-mono tabular-nums">{Math.round(camera.rangeM)} m</dd></div>
            </dl>
            {canEditSource && <SourceSelect cameraCode={camera.code} value={phone?.id ?? null} className="mt-3 border-t border-white/8 pt-2.5" />}
            {playable?.motionMap && <p className="mt-3 text-[11px] leading-relaxed text-ink-muted">Projected motion covers the calibrated ground area. Marker fit RMSE: {playable.motionMap.fitRmseM?.toPrecision(2) ?? 'unavailable'} m. Independent pin location accuracy has not been measured.</p>}
            {(simulated || (!camera.calibrated && !camera.video?.motionMap)) && (
                <p className="mt-3 flex gap-2 border-t border-white/8 pt-2.5 text-xs leading-relaxed text-ink-muted">
                    <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {simulated ? 'Simulated footage · pins placed approximately' : 'Calibrate this camera in Settings to place its tracks on the map.'}
                </p>
            )}
        </GlassPanel>
        {playable && expanded && <ExpandedFeed camera={camera} video={playable} onClose={() => handOff(false)} onTime={track} seekTo={panelSeek} variant={variant} onVariantChange={setVariant} />}
        </>
    );
}
