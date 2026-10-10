'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Eye, MapPinOff, X } from 'lucide-react';
import { GlassPanel } from '@/components/ui/glass-panel';
import type { SessionUser } from '@/lib/auth/session';
import { cn } from '@/lib/cn';
import { PERSON_EVENTS } from '@/lib/sites/summary';
import type { AlertView, SiteEventType, SiteSummary } from '@/lib/types';
import { PatrolledMark, StatusPill } from '@/features/alerts/AlertsFeed';
import { useNow } from '@/features/live/useNow';
import { isFaded } from '@/features/map/pins';
import { eventLabel, inactiveState, NESTING, PROTECTION } from './labels';
import { PatrolForm } from './PatrolForm';
import { SiteCloseUp } from './SiteCloseUp';

export interface SiteLogEvent
{
    id: string;
    type: string;
    author: string;
    note: string | null;
    at: string;
}

interface SiteLog
{
    summary: SiteSummary | null;
    events: SiteLogEvent[];
}

const absolute = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
const tierText = { TWO_CAMERA: 'Both cameras', SINGLE_CAMERA: 'One camera' } as const;
const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function relativeTime(iso: string, now: number): string
{
    const seconds = Math.round((now - Date.parse(iso)) / 1000);
    if (seconds < 45) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 36) return `${hours} h ago`;
    return `${Math.round(hours / 24)} d ago`;
}

function sourceLabel(alert: AlertView): string
{
    if (alert.simRunId?.startsWith('live-')) return 'Live simulator feed';
    return alert.simulated ? 'Simulated run' : 'Camera footage';
}

// Side sheet (bottom sheet on phones) with one site's evidence, full log and, for volunteers, the patrol form.
export function SiteDrawer({ alert, user, onClose, fadeMinutes = 5 }: { alert: AlertView; user: SessionUser; onClose: () => void; fadeMinutes?: number })
{
    const panelRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const request = useRef(0);
    const [log, setLog] = useState<SiteLog | null>(null);
    const [failed, setFailed] = useState(false);
    const now = useNow(30_000);
    // The live snapshot changes this when anyone (or the camera watcher) touches the site.
    const siteVersion = JSON.stringify(alert.site);

    const load = useCallback(async () =>
    {
        const sequence = ++request.current;
        try
        {
            const response = await fetch(`/api/sites/${alert.id}`, { cache: 'no-store' });
            if (!response.ok)
            {
                throw new Error(String(response.status));
            }
            const body = await response.json() as SiteLog;
            if (sequence === request.current)
            {
                setLog({ summary: body.summary, events: body.events });
                setFailed(false);
            }
        }
        catch
        {
            if (sequence === request.current)
            {
                setFailed(true);
            }
        }
    }, [alert.id]);

    useEffect(() => { setLog(null); }, [alert.id]);
    useEffect(() => { void load(); }, [load, siteVersion]);

    useEffect(() =>
    {
        const previous = document.activeElement as HTMLElement | null;
        closeRef.current?.focus();
        return () => previous?.focus?.();
    }, []);

    useEffect(() =>
    {
        const onKey = (event: globalThis.KeyboardEvent) =>
        {
            if (event.key === 'Escape')
            {
                onClose();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    function trapFocus(event: KeyboardEvent<HTMLDivElement>)
    {
        if (event.key !== 'Tab' || !panelRef.current)
        {
            return;
        }
        const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
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

    const site = log?.summary ?? alert.site;
    const faded = isFaded(alert, now, fadeMinutes);
    const canLog = user.role === 'VOLUNTEER' || user.role === 'ADMIN';
    const detectedAt = site.detectedAt ?? alert.createdAt;

    return (
        <GlassPanel
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Site in zone ${alert.zoneCode}`}
            onKeyDown={trapFocus}
            // Desktop: header and form stay put while the log scrolls. Phone: the whole sheet scrolls so the log is not squeezed.
            className={cn('pointer-events-auto flex min-h-0 flex-col bg-[rgba(8,14,20,0.9)] md:overflow-hidden max-md:overflow-y-auto max-md:overscroll-contain',
                'md:w-[22rem] md:self-stretch md:motion-safe:animate-[sheet-in-right_220ms_cubic-bezier(0.2,0.8,0.2,1)]',
                'max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:max-h-[82dvh] max-md:rounded-b-none max-md:border-b-0 max-md:motion-safe:animate-[sheet-in-up_240ms_cubic-bezier(0.2,0.8,0.2,1)]')}
        >
            <header className="shrink-0 border-b border-white/6 px-4 pt-3 pb-3 max-md:sticky max-md:top-0 max-md:z-10 max-md:bg-[rgb(10,16,22)] max-md:pt-2">
                <div aria-hidden className="mx-auto mb-2 h-1 w-9 rounded-full bg-white/15 md:hidden" />
                <div className="flex items-center gap-2">
                    <p className="text-[10px] font-semibold tracking-[0.16em] text-ink-muted uppercase">Nest site</p>
                    <span className="rounded-md bg-amber/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-amber uppercase ring-1 ring-amber/30">{sourceLabel(alert)}</span>
                    <button ref={closeRef} type="button" onClick={onClose} aria-label="Close site" className="ml-auto grid h-7 w-7 place-items-center rounded-md text-ink-muted transition-colors hover:bg-white/10 hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"><X className="h-4 w-4" /></button>
                </div>
                <h2 className="mt-1.5 text-lg leading-tight font-semibold tracking-tight">
                    Zone {alert.zoneCode} <span className="text-ink-muted">·</span> <span className="font-mono text-base">{alert.cameraCode}</span>
                </h2>
                <p className="mt-0.5 text-xs text-ink-muted">{alert.message}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    {site.active
                        ? (<><StatusPill tone={PROTECTION[site.protection]} />{site.patrolVisited && <PatrolledMark />}<span className="text-[11px] text-ink-muted">{NESTING[site.nesting]}</span></>)
                        : (<><StatusPill tone={inactiveState(site)} /><span className="text-[11px] text-ink-muted">{PROTECTION[site.protection].label}</span></>)}
                    {faded && site.active && <span className="text-[11px] text-ink-muted/80">· untouched {fadeMinutes}+ min</span>}
                </div>
            </header>

            <div className="md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-contain">
                <section aria-label="Evidence" className="px-4 pt-3">
                    <div className="relative h-32 overflow-hidden rounded-lg border border-white/8 bg-night-950 max-md:h-24">
                        {alert.position
                            ? <SiteCloseUp position={alert.position} color={PROTECTION[site.protection].color} faded={faded} />
                            : <span className="absolute inset-0 grid place-items-center text-xs text-ink-muted"><span className="flex items-center gap-1.5"><MapPinOff aria-hidden className="h-3.5 w-3.5" />No map position</span></span>}
                        {alert.position && (
                            <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-night-950/80 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted ring-1 ring-white/10">
                                {alert.position[1].toFixed(5)}, {alert.position[0].toFixed(5)}
                            </span>
                        )}
                    </div>
                    <dl className="mt-3 grid grid-cols-3 gap-x-2 gap-y-2.5 text-xs">
                        <div><dt className="text-[10px] tracking-[0.12em] text-ink-muted uppercase">Evidence</dt><dd className="mt-0.5 font-medium">{alert.evidenceTier ? tierText[alert.evidenceTier] : '—'}</dd></div>
                        <div><dt className="text-[10px] tracking-[0.12em] text-ink-muted uppercase">Score</dt><dd className="mt-0.5 font-mono tabular-nums">{alert.score !== null ? alert.score.toFixed(2) : '—'}</dd></div>
                        <div><dt className="text-[10px] tracking-[0.12em] text-ink-muted uppercase">In clip</dt><dd className="mt-0.5 font-mono tabular-nums">{alert.startT.toFixed(1)}–{alert.endT.toFixed(1)} s</dd></div>
                        <div className="col-span-3"><dt className="text-[10px] tracking-[0.12em] text-ink-muted uppercase">Detected</dt><dd className="mt-0.5"><span className="font-medium">{relativeTime(detectedAt, now)}</span> <span className="font-mono text-ink-muted">· {absolute.format(new Date(detectedAt))}</span></dd></div>
                    </dl>
                </section>

                <section aria-label="Site log" className="mt-4 border-t border-white/6 px-4 pt-3 pb-4">
                    <p className="mb-2 flex items-center gap-2 text-[10px] font-semibold tracking-[0.16em] text-ink-muted uppercase">
                        Site log {log && <span className="font-mono font-normal tracking-normal">{log.events.length}</span>}
                    </p>
                    {failed && !log && <p className="text-xs text-ink-muted">Could not load the log.</p>}
                    {!log && !failed && (
                        <div aria-hidden className="space-y-2.5">
                            {[0, 1, 2].map(row => <div key={row} className="h-9 animate-pulse rounded-md bg-white/4" />)}
                        </div>
                    )}
                    {log && (
                        <ol className="relative">
                            {log.events.map((event, index) =>
                            {
                                const person = PERSON_EVENTS.includes(event.type as SiteEventType);
                                return (
                                    <li key={event.id} className="relative grid grid-cols-[14px_1fr] gap-x-2.5 pb-3 last:pb-0">
                                        {index < log.events.length - 1 && <span aria-hidden className="absolute top-3.5 bottom-0 left-[6px] w-px bg-white/10" />}
                                        <span aria-hidden className={cn('relative mt-1 h-[13px] w-[13px] rounded-full ring-2 ring-night-900', person ? 'bg-amber' : 'border border-white/30 bg-night-700')} />
                                        <div className="min-w-0">
                                            <p className="flex items-baseline gap-1.5 text-sm">
                                                <span className={cn('font-medium', person ? 'text-ink' : 'text-ink/80')}>{eventLabel(event.type)}</span>
                                                <span className="truncate text-xs text-ink-muted">· {event.author}</span>
                                            </p>
                                            <p className="font-mono text-[11px] text-ink-muted" title={event.at}>{relativeTime(event.at, now)} · {absolute.format(new Date(event.at))}</p>
                                            {event.note && <p className="mt-1 rounded-md bg-white/4 px-2 py-1 text-xs leading-relaxed whitespace-pre-wrap text-ink/90">{event.note}</p>}
                                        </div>
                                    </li>
                                );
                            })}
                        </ol>
                    )}
                </section>
            </div>

            <footer className="shrink-0 border-t border-white/8 bg-night-950/40 px-4 pt-3 pb-4 max-md:pb-[max(1rem,env(safe-area-inset-bottom))]">
                {canLog
                    ? <PatrolForm alertId={alert.id} summary={site} onSaved={() => void load()} />
                    : <p className="flex items-center gap-2 text-xs text-ink-muted"><Eye aria-hidden className="h-3.5 w-3.5" />View only. Volunteers and admins add patrol entries.</p>}
            </footer>
        </GlassPanel>
    );
}
