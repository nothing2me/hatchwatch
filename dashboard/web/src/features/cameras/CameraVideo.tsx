'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import type { CameraVideo as CameraVideoData } from '@/lib/types';

export type FeedVariant = 'raw' | 'motion';

const CLOCK_MS = 250;

// Looping muted feed with an optional Raw/Motion switch. Publishes its clock so the map can gate pins.
export function CameraVideo({ video, onTime }: { video: CameraVideoData; onTime?: (t: number) => void })
{
    const ref = useRef<HTMLVideoElement>(null);
    const resumeAt = useRef<number | null>(null);
    const [variant, setVariant] = useState<FeedVariant>('raw');

    useEffect(() =>
    {
        if (!onTime)
        {
            return undefined;
        }
        const timer = setInterval(() =>
        {
            if (ref.current)
            {
                onTime(ref.current.currentTime);
            }
        }, CLOCK_MS);
        return () => clearInterval(timer);
    }, [onTime]);

    function choose(next: FeedVariant)
    {
        if (next !== variant)
        {
            resumeAt.current = ref.current?.currentTime ?? 0;
            setVariant(next);
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
                className="block aspect-video w-full object-cover max-md:aspect-[5/2]"
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
                            {option === 'raw' ? 'Raw' : 'Motion'}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
