'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import type { FeedVideo } from '@/lib/types';

export type FeedVariant = 'raw' | 'motion';

export interface SeekRequest
{
    t: number;
    nonce: number;   // a new nonce re-seeks even to the same time
}

const CLOCK_MS = 250;
const HAVE_METADATA = 1;

// Looping muted feed with an optional Raw/Motion switch. Publishes its clock so the map can gate pins.
export function CameraVideo({ video, onTime, seekTo = null, large = false, variant: variantProp, onVariantChange }: { video: FeedVideo; onTime?: (t: number) => void; seekTo?: SeekRequest | null; large?: boolean; variant?: FeedVariant; onVariantChange?: (next: FeedVariant) => void })
{
    const ref = useRef<HTMLVideoElement>(null);
    const resumeAt = useRef<number | null>(null);
    const [localVariant, setVariant] = useState<FeedVariant>('raw');
    const variant = variantProp ?? localVariant;

    useEffect(() =>
    {
        if (!onTime)
        {
            return undefined;
        }
        const timer = setInterval(() =>
        {
            // While a seek or variant switch waits for metadata the element's clock is not the feed's.
            if (ref.current && resumeAt.current === null)
            {
                onTime(ref.current.currentTime);
            }
        }, CLOCK_MS);
        return () => clearInterval(timer);
    }, [onTime]);

    useEffect(() =>
    {
        const element = ref.current;
        if (!seekTo || !element)
        {
            return;
        }
        if (element.readyState >= HAVE_METADATA && resumeAt.current === null)
        {
            element.currentTime = seekTo.t;
        }
        else
        {
            resumeAt.current = seekTo.t;
        }
    }, [seekTo]);

    function choose(next: FeedVariant)
    {
        if (next !== variant)
        {
            // A second toggle before metadata loads keeps the original position.
            if (resumeAt.current === null)
            {
                resumeAt.current = ref.current?.currentTime ?? 0;
            }
            setVariant(next);
            onVariantChange?.(next);
        }
    }

    function restore()
    {
        const element = ref.current;
        if (element && resumeAt.current !== null)
        {
            element.currentTime = resumeAt.current;
            resumeAt.current = null;
            element.play?.()?.catch?.(() => undefined);
        }
    }

    return (
        <div className="relative mt-2 overflow-hidden rounded-lg border border-white/6 bg-night-950">
            <video
                ref={ref}
                data-testid="camera-video"
                className={cn('block aspect-video w-full', large ? 'max-h-[calc(92vh-5rem)] object-contain' : 'object-cover max-md:aspect-[5/2]')}
                src={`/api/media/video/${video.id}?variant=${variant}`}
                autoPlay
                muted
                loop
                playsInline
                onLoadedMetadata={restore}
            />
            {video.source === 'SIMULATION' && (
                <span className="absolute top-2 left-2 rounded-md bg-night-950/80 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.14em] text-amber uppercase ring-1 ring-amber/40">
                    Simulated
                </span>
            )}
            {variant === 'raw' && video.maskPolygon && video.maskPolygon.length >= 3 && (
                <svg viewBox="0 0 1280 720" className="pointer-events-none absolute inset-0 h-full w-full" aria-label="Watch mask">
                    <polygon
                        points={video.maskPolygon.map(point => point.join(',')).join(' ')}
                        fill="rgba(255,181,71,0.05)"
                        stroke="#FFB547"
                        strokeWidth={3}
                        strokeDasharray="10 8"
                        vectorEffect="non-scaling-stroke"
                    />
                </svg>
            )}
            {variant === 'raw' && video.maskPolygon && (
                <span className="absolute top-2 right-2 rounded-md bg-night-950/70 px-1.5 py-0.5 text-[10px] tracking-[0.12em] text-ink-muted uppercase ring-1 ring-amber/30">
                    Watch mask
                </span>
            )}
            {video.hasMotion && (
                <div role="radiogroup" aria-label="Feed view" className="absolute right-2 bottom-2 flex rounded-md bg-night-950/85 p-0.5 text-[11px] ring-1 ring-white/10">
                    {(['raw', 'motion'] as const).map(option => (
                        <button
                            key={option}
                            type="button"
                            role="radio"
                            aria-checked={variant === option}
                            onClick={() => choose(option)}
                            className={cn('rounded px-2 py-0.5 font-medium capitalize transition-colors focus-visible:outline-2 focus-visible:outline-amber',
                                variant === option ? 'bg-white/12 text-ink' : 'text-ink-muted hover:text-ink')}
                        >
                            {option === 'raw' ? 'Camera' : 'Motion diff'}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
