'use client';

import Link from 'next/link';
import { useCallback, useRef, useState, useTransition, type KeyboardEvent, type PointerEvent } from 'react';
import { Activity, Info, Maximize2, VideoOff, X } from 'lucide-react';
import { GlassPanel } from '@/components/ui/glass-panel';
import { assignCameraSource } from '@/app/(app)/live-actions';
import { LiveVideo } from '@/features/live/LiveVideo';
import { cn } from '@/lib/cn';
import { compassPoint } from '@/lib/geo';
import type { CameraView, LiveDeviceView } from '@/lib/types';
import { CameraVideo, type FeedVariant, type SeekRequest } from './CameraVideo';
import { ExpandedFeed } from './ExpandedFeed';
import { feedFor, type Feed } from './feed';
import { PANEL_MAX, PANEL_MIN, PANEL_STEP, usePanelWidth } from './usePanelWidth';

interface CameraPanelProps
{
    camera: CameraView;
    // What to show; defaults to the camera's simulation loop. A live device feed carries no clock.
    feed?: Feed;
    isAdmin?: boolean;
    devices?: LiveDeviceView[];
    onClose: () => void;
    onTime?: (t: number) => void;
    seekTo?: SeekRequest | null;
}

// Admin only: which live device feeds this camera, or the simulation loop.
function SourcePicker({ camera, devices }: { camera: CameraView; devices: LiveDeviceView[] })
{
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();
    // Online devices, plus the assigned one even while it is offline so the select can show it.
    const choices = devices.filter(device => device.online || device.id === camera.liveDeviceId);

    function choose(value: string)
    {
        startTransition(async () =>
        {
            try
            {
                const result = await assignCameraSource(camera.code, value || null);
                setError(result.ok ? null : result.error);
            }
            catch
            {
                setError('That did not save. Check your connection and try again.');
            }
        });
    }

    return (
        <div className="mt-3 border-t border-white/8 pt-2.5 text-xs">
            <label className="flex items-center gap-2">
                <span className="text-[10px] tracking-[0.12em] text-ink-muted uppercase">Source</span>
                <select
                    value={camera.liveDeviceId ?? ''}
                    onChange={event => choose(event.target.value)}
                    disabled={pending}
                    className="h-7 min-w-0 flex-1 rounded-md border border-white/10 bg-night-900 px-2 text-xs outline-none focus:border-amber disabled:opacity-60"
                >
                    <option value="">Simulation loop</option>
                    {choices.map(device =>
                    {
                        const elsewhere = device.cameraCode !== null && device.cameraCode !== camera.code;
                        return (
                            <option key={device.id} value={device.id} disabled={elsewhere}>
                                {device.name}{elsewhere ? ` (on ${device.cameraCode})` : ''}{device.online ? '' : ' · offline'}
                            </option>
                        );
                    })}
                </select>
            </label>
            {choices.length === 0 && <p className="mt-1.5 text-ink-muted">No devices streaming. Use Connect device in the top bar.</p>}
            {error && <p role="alert" className="mt-1.5 text-danger">{error}</p>}
        </div>
    );
}

// Selected camera details. A streaming device plays live; otherwise online cameras with footage loop it, and the rest keep the status card.
export function CameraPanel({ camera, feed, isAdmin = false, devices = [], onClose, onTime, seekTo = null }: CameraPanelProps)
{
    const online = camera.status === 'ONLINE';
    const shown = feed ?? feedFor(camera, {});
    const heading = Math.round(camera.headingDeg);
    const { width, setWidth, nudge } = usePanelWidth();
    const drag = useRef<{ x: number; width: number } | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [variant, setVariant] = useState<FeedVariant>('raw');
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

    const playable = shown.kind === 'sim' ? shown.video : null;
    const live = shown.kind === 'live' ? shown : null;

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

            {live
                ? (
                    <LiveVideo
                        key={live.deviceId}
                        deviceId={live.deviceId}
                        badge={(
                            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-danger/90 px-2 py-0.5 text-[11px] font-semibold text-white shadow shadow-black/40">
                                <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-white" />
                                <span className="truncate">LIVE · {live.deviceName}</span>
                            </span>
                        )}
                    />
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
            {shown.kind !== 'live' && shown.deviceOffline && (
                <p className="mt-2 text-xs text-ink-muted">{shown.deviceOffline} offline{shown.kind === 'sim' ? ' · showing simulation' : ''}</p>
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
            {isAdmin && <SourcePicker camera={camera} devices={devices} />}
            {live && (
                <div className="mt-3 flex items-start gap-3">
                    <p className="flex-1 text-[11px] leading-relaxed text-ink-muted">Live from {live.deviceName} over Wi-Fi · view only, not recorded or analysed.</p>
                    <Link href={`/motion?camera=${encodeURIComponent(camera.code)}`} className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 text-xs hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-amber">
                        <Activity aria-hidden className="h-3.5 w-3.5 text-amber" />Motion view
                    </Link>
                </div>
            )}
            {playable?.motionMap && <p className="mt-3 text-[11px] leading-relaxed text-ink-muted">Projected motion covers the calibrated ground area. Marker fit RMSE: {playable.motionMap.fitRmseM?.toPrecision(2) ?? 'unavailable'} m. Independent pin location accuracy has not been measured.</p>}
            {!live && !camera.calibrated && !camera.video?.motionMap && (
                <p className="mt-3 flex gap-2 border-t border-white/8 pt-2.5 text-xs leading-relaxed text-ink-muted">
                    <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Calibrate this camera in Settings to place its tracks on the map.
                </p>
            )}
        </GlassPanel>
        {playable && expanded && <ExpandedFeed camera={camera} video={playable} onClose={() => handOff(false)} onTime={track} seekTo={panelSeek} variant={variant} onVariantChange={setVariant} />}
        </>
    );
}
