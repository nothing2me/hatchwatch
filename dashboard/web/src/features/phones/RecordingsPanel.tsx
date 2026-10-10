'use client';

import { Fragment, useEffect, useState } from 'react';
import { Download, Film, Play, X } from 'lucide-react';
import type { RecordingView } from '@/lib/types';
import { cn } from '@/lib/cn';

const REFRESH_MS = 30_000;

interface RecordingList
{
    enabled: boolean;
    convertsToMp4: boolean;
    recordings: RecordingView[];
}

// "4 min 12 s" or "38 s".
export function formatLength(seconds: number): string
{
    const whole = Math.round(seconds);
    const minutes = Math.floor(whole / 60);
    return minutes > 0 ? `${minutes} min ${whole % 60} s` : `${whole} s`;
}

// "12.4 MB" or "830 KB".
export function formatSize(bytes: number): string
{
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

// Local date and time the segment started.
export function formatStart(iso: string): string
{
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const fileUrl = (path: string) => `/api/live/recordings/${path.split('/').map(encodeURIComponent).join('/')}`;

const action = 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/12 px-2.5 text-xs text-ink transition-colors hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-amber';
const cell = 'px-3 py-2.5 max-md:p-0';

// Admin list of recorded phone segments, newest first, with an inline player for mp4 files.
export function RecordingsPanel()
{
    const [list, setList] = useState<RecordingList | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [playing, setPlaying] = useState<string | null>(null);

    useEffect(() =>
    {
        let active = true;
        async function refresh()
        {
            try
            {
                const response = await fetch('/api/live/recordings', { cache: 'no-store' });
                if (!response.ok)
                {
                    throw new Error(String(response.status));
                }
                const body = await response.json() as RecordingList;
                if (active)
                {
                    setList(body);
                    setProblem(null);
                }
            }
            catch
            {
                if (active)
                {
                    setProblem('Could not load recordings.');
                }
            }
        }
        void refresh();
        const timer = setInterval(refresh, REFRESH_MS);
        return () =>
        {
            active = false;
            clearInterval(timer);
        };
    }, []);

    const recordings = list?.recordings ?? [];

    return (
        <section aria-labelledby="recordings-heading" className="mt-10 rounded-2xl border border-white/8 bg-night-900/70 p-4 sm:p-5">
            <div className="mb-4 flex items-start gap-3">
                <Film aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
                <div className="min-w-0">
                    <h2 id="recordings-heading" className="text-sm font-semibold text-ink">Recordings</h2>
                    <p className="mt-0.5 text-xs text-ink-muted">Kept on this laptop only. Segments appear here shortly after they close.</p>
                </div>
            </div>

            {problem && <p role="alert" className="mb-3 text-sm text-[#F2865A]">{problem}</p>}
            {list && !list.enabled && <p className="text-sm text-ink-muted">Recording is off (RECORDING=off).</p>}
            {list?.enabled && recordings.length === 0 && <p className="text-sm text-ink-muted">No recordings yet. Phones are recorded while they send.</p>}

            {list?.enabled && recordings.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-white/8">
                    <table className="w-full text-left text-sm max-md:block">
                        <caption className="sr-only">Recorded segments</caption>
                        <thead className="bg-white/[0.04] text-xs text-ink-muted max-md:sr-only">
                            <tr>
                                <th scope="col" className="px-3 py-2 font-medium">Device</th>
                                <th scope="col" className="px-3 py-2 font-medium">Camera</th>
                                <th scope="col" className="px-3 py-2 font-medium">Start</th>
                                <th scope="col" className="px-3 py-2 text-right font-medium">Length</th>
                                <th scope="col" className="px-3 py-2 text-right font-medium">Size</th>
                                <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">Actions</span></th>
                            </tr>
                        </thead>
                        <tbody className="max-md:block">
                            {recordings.map(recording =>
                            {
                                const isPlaying = playing === recording.path;
                                const canPlay = recording.playable && recording.path.endsWith('.mp4');
                                return (
                                    <Fragment key={recording.path}>
                                        <tr className={cn('border-t border-white/8 first:border-0 max-md:grid max-md:grid-cols-[1fr_auto] max-md:gap-x-3 max-md:gap-y-1 max-md:p-3', isPlaying && 'bg-white/[0.03]')}>
                                            <td className={cn(cell, 'font-medium break-words text-ink')}>{recording.deviceName}</td>
                                            <td className={cn(cell, 'font-mono text-ink-muted max-md:text-right')}>{recording.cameraCode ?? '—'}</td>
                                            <td className={cn(cell, 'text-ink-muted tabular-nums max-md:col-span-2')}>{formatStart(recording.startedAt)}</td>
                                            <td className={cn(cell, 'text-right font-mono text-ink-muted tabular-nums max-md:text-left')}>{formatLength(recording.durationS)}</td>
                                            <td className={cn(cell, 'text-right font-mono text-ink-muted tabular-nums')}>{formatSize(recording.sizeBytes)}</td>
                                            <td className={cn(cell, 'max-md:col-span-2 max-md:pt-1.5')}>
                                                <div className="flex flex-wrap items-center justify-end gap-1.5 max-md:justify-start">
                                                    {canPlay
                                                        ? (
                                                            <button type="button" aria-expanded={isPlaying} onClick={() => setPlaying(isPlaying ? null : recording.path)} className={action}>
                                                                {isPlaying ? <X aria-hidden className="h-3.5 w-3.5" /> : <Play aria-hidden className="h-3.5 w-3.5" />}
                                                                {isPlaying ? 'Close' : 'Play'}
                                                            </button>
                                                        )
                                                        : <span className="text-xs text-ink-muted">{`AVI · download only${list.convertsToMp4 ? '' : ' (install ffmpeg to convert)'}`}</span>}
                                                    <a href={`${fileUrl(recording.path)}?download=1`} className={action}>
                                                        <Download aria-hidden className="h-3.5 w-3.5" />
                                                        Download
                                                    </a>
                                                </div>
                                            </td>
                                        </tr>
                                        {isPlaying && (
                                            <tr className="max-md:block">
                                                <td colSpan={6} className="px-3 pb-3 max-md:block">
                                                    <video controls autoPlay playsInline src={fileUrl(recording.path)} className="aspect-video w-full rounded-lg bg-black" />
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
