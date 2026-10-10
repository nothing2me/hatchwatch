'use client';

import { Check, CircleAlert, LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

export type EditNotice = { kind: 'ok' | 'error'; text: string } | null;

interface EditCamerasBannerProps
{
    busy: boolean;
    notice: EditNotice;
    onDone: () => void;
}

// Floating strip shown while an admin edits cameras: instructions and the last result.
export function EditCamerasBanner({ busy, notice, onDone }: EditCamerasBannerProps)
{
    return (
        <div className="pointer-events-none absolute top-[72px] left-1/2 z-20 flex w-[min(50rem,calc(100%-1.5rem))] -translate-x-1/2 max-md:left-3 max-md:w-[calc(100%-4.5rem)] max-md:translate-x-0 flex-col items-center gap-2">
            <div className="pointer-events-auto flex w-full items-center gap-3 overflow-hidden rounded-xl border border-amber/35 bg-[rgba(8,14,20,0.9)] py-2 pr-2 pl-3 shadow-2xl shadow-black/50 backdrop-blur-md">
                <span className="flex shrink-0 items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.18em] text-amber uppercase">
                    <span aria-hidden className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber/60" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber" />
                    </span>
                    Edit cameras
                </span>
                <span aria-hidden className="h-4 w-px shrink-0 bg-white/12" />
                <p className="min-w-0 flex-1 text-[13px] leading-snug text-ink">Click a zone to add a pair · open beach starts a new zone · drag cameras or new zones</p>
                <button
                    type="button"
                    onClick={onDone}
                    className="shrink-0 rounded-lg bg-amber px-3 py-1.5 text-xs font-semibold text-night-950 transition-colors hover:bg-[#ffc56e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
                >
                    Done
                </button>
            </div>

            <p role="status" aria-live="polite" className="contents">
                {busy && (
                    <span className="flex items-center gap-2 rounded-full bg-night-900/90 px-3 py-1 font-mono text-[11px] text-ink-muted ring-1 ring-white/10">
                        <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" /> Working…
                    </span>
                )}
                {!busy && notice && (
                    <span className={cn('flex items-center gap-2 rounded-full bg-night-900/90 px-3 py-1 text-xs ring-1', notice.kind === 'ok' ? 'text-amber ring-amber/30' : 'text-[#F08A5D] ring-[#E2581F]/40')}>
                        {notice.kind === 'ok' ? <Check aria-hidden className="h-3.5 w-3.5" /> : <CircleAlert aria-hidden className="h-3.5 w-3.5" />}
                        {notice.text}
                    </span>
                )}
            </p>
        </div>
    );
}
