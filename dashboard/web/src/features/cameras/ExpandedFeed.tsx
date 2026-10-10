'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { compassPoint } from '@/lib/geo';
import type { CameraView, FeedVideo } from '@/lib/types';
import { CameraVideo, type FeedVariant, type SeekRequest } from './CameraVideo';

// Large video viewer over the map. It is the only player while open, so it alone publishes the clock.
export function ExpandedFeed({ camera, video, onClose, onTime, seekTo = null, variant, onVariantChange }: { camera: CameraView; video: FeedVideo; onClose: () => void; onTime?: (t: number) => void; seekTo?: SeekRequest | null; variant?: FeedVariant; onVariantChange?: (next: FeedVariant) => void })
{
    const closeRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() =>
    {
        const previous = document.activeElement as HTMLElement | null;
        closeRef.current?.focus();
        function onKey(event: KeyboardEvent)
        {
            if (event.key === 'Escape')
            {
                event.stopPropagation();
                onCloseRef.current();
            }
            else if (event.key === 'Tab' && dialogRef.current)
            {
                const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])'));
                if (items.length === 0)
                {
                    return;
                }
                const first = items[0];
                const last = items[items.length - 1];
                if (event.shiftKey && document.activeElement === first)
                {
                    event.preventDefault();
                    last.focus();
                }
                else if (!event.shiftKey && document.activeElement === last)
                {
                    event.preventDefault();
                    first.focus();
                }
            }
        }
        document.addEventListener('keydown', onKey, true);
        return () =>
        {
            document.removeEventListener('keydown', onKey, true);
            previous?.focus?.();
        };
    }, []);

    // Rendered beside (not inside) the glass panel: its backdrop filter would otherwise trap fixed positioning.
    return (
        <div className="pointer-events-auto fixed inset-0 z-50 grid place-items-center bg-black/80 p-3 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label={`Camera ${camera.code} feed`}
                className="max-h-[92vh] w-[min(1100px,92vw,calc((92vh-5rem)*16/9))] rounded-xl border border-white/10 bg-night-950 p-3 shadow-2xl shadow-black/60"
            >
                <div className="flex items-center gap-2">
                    <p className="text-[11px] font-semibold tracking-[0.16em] text-ink uppercase">Camera {camera.code}</p>
                    <span className="text-[11px] tracking-[0.12em] text-ink-muted uppercase">· facing {compassPoint(camera.headingDeg)}</span>
                    <button ref={closeRef} type="button" onClick={onClose} aria-label="Close expanded view" className="ml-auto grid h-8 w-8 place-items-center rounded-md text-ink-muted transition-colors hover:bg-white/10 hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"><X className="h-5 w-5" /></button>
                </div>
                <CameraVideo key={video.id} video={video} onTime={onTime} seekTo={seekTo} variant={variant} onVariantChange={onVariantChange} large />
            </div>
        </div>
    );
}
