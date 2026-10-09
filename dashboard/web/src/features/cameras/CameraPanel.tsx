'use client';

import { Info, VideoOff, X } from 'lucide-react';
import { GlassPanel } from '@/components/ui/glass-panel';
import { cn } from '@/lib/cn';
import { compassPoint } from '@/lib/geo';
import type { CameraView } from '@/lib/types';

// Selected camera details. Plan 2 replaces the placeholder with the video player
// when latestVideoId is set (latest video with a DONE job); cameras without footage keep the status card.
export function CameraPanel({ camera, onClose }: { camera: CameraView; onClose: () => void })
{
    const online = camera.status === 'ONLINE';
    const heading = Math.round(camera.headingDeg);

    return (
        <GlassPanel className="pointer-events-auto w-full p-3 md:w-76">
            <div className="flex items-center gap-2">
                <p className="text-[10px] font-semibold tracking-[0.16em] text-ink uppercase">Camera {camera.code}</p>
                <span className="text-[10px] tracking-[0.12em] text-ink-muted uppercase">· facing {compassPoint(camera.headingDeg)}</span>
                <button type="button" onClick={onClose} aria-label="Close camera panel" className="ml-auto grid h-7 w-7 place-items-center rounded-md text-ink-muted transition-colors hover:bg-white/10 hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"><X className="h-4 w-4" /></button>
            </div>

            <div className="relative mt-2 grid aspect-video max-md:aspect-[5/2] place-items-center overflow-hidden rounded-lg border border-white/6 bg-night-950 text-center">
                <div aria-hidden className="absolute inset-0 bg-[repeating-linear-gradient(135deg,transparent_0_10px,rgba(255,255,255,0.018)_10px_20px)]" />
                <span className="relative flex flex-col items-center gap-2 text-sm text-ink-muted">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-white/5 ring-1 ring-white/10">
                        <VideoOff aria-hidden className="h-4 w-4" />
                    </span>
                    {online ? 'No footage yet' : 'Camera offline'}
                </span>
            </div>

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
            {!camera.calibrated && (
                <p className="mt-3 flex gap-2 border-t border-white/8 pt-2.5 text-xs leading-relaxed text-ink-muted">
                    <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Calibrate this camera in Setup to place its tracks on the map.
                </p>
            )}
        </GlassPanel>
    );
}
