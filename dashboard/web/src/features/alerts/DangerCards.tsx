'use client';

import { useState } from 'react';
import { ChevronDown, LoaderCircle, ShieldCheck, Siren } from 'lucide-react';
import { cn } from '@/lib/cn';
import { CAMERA_DANGER_LABEL, isCameraDanger } from '@/lib/danger';
import type { AlertView } from '@/lib/types';
import { trailColor } from '@/features/map/trails';
import { type DangerGroup, siteLabel } from './dangerGroups';
import { resolveDanger } from './resolveDanger';

const clock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
const stamp = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });

export const CLOSED_SITE_NOTE = 'Site closed · danger still open';

// Level badge shared by the feed and the drawer.
export function DangerBadge({ className }: { className?: string })
{
    return (
        <span className={cn('inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full bg-alarm px-1.5 text-[10px] font-bold tracking-[0.06em] text-white uppercase shadow-[0_0_12px_rgba(255,77,94,0.45)]', className)}>
            <Siren aria-hidden className="h-3 w-3" strokeWidth={2.5} />
            Level 1 · Danger
        </span>
    );
}

// A closed nest site (no nest, hatched, lost or faded) can still carry an open danger; say so plainly.
export function siteClosed(site: AlertView | undefined): boolean
{
    return site !== undefined && !site.site.active;
}

function TrailDot({ site }: { site: AlertView | undefined })
{
    const color = site ? trailColor(site.colorIndex) : '#8A9BA6';
    return <span aria-hidden className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-night-950" style={{ backgroundColor: color, boxShadow: `0 0 0 3.5px ${color}55` }} />;
}

// One person passing several nest sites in a zone and clip: one card, expandable to its sites.
// `open` lives in the feed, keyed by danger ids: resolving the group's first danger changes the group key
// (the card remounts) and the card must stay open for the rest.
export function DangerGroupCard({ group, sites, canResolve, onSelect, selectedId, open, onToggle }: {
    group: DangerGroup;
    sites: Map<string, AlertView>;
    canResolve: boolean;
    onSelect: (alert: AlertView) => void;
    selectedId: string | null;
    open: boolean;
    onToggle: () => void;
})
{
    const [busy, setBusy] = useState<Set<string>>(new Set());
    const [done, setDone] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const count = group.dangers.length;
    const pending = group.dangers.filter(danger => !done.has(danger.id));
    const bodyId = `danger-${group.key.replace(/\W/g, '')}`;
    const title = `Person on the beach near ${count} ${count === 1 ? 'site' : 'sites'}`;

    async function resolve(ids: string[])
    {
        setError(null);
        setBusy(current => new Set([...current, ...ids]));
        // Every site is attempted; a failure leaves that row actionable and is reported at the end.
        const failures: string[] = [];
        for (const id of ids)
        {
            const result = await resolveDanger(id);
            setBusy(current => { const next = new Set(current); next.delete(id); return next; });
            if (result.ok)
            {
                setDone(current => new Set([...current, id]));
                continue;
            }
            const danger = group.dangers.find(item => item.id === id);
            const site = danger?.siteId ? sites.get(danger.siteId) : undefined;
            failures.push(`${site ? siteLabel(site) : `Zone ${danger?.zoneCode ?? '?'} · site not listed`} — ${result.error}`);
        }
        if (failures.length > 0)
        {
            setError(ids.length > 1 ? `${ids.length - failures.length} of ${ids.length} resolved; failed: ${failures.join('; ')}` : failures[0]);
        }
    }

    return (
        <li className="relative overflow-hidden rounded-lg bg-alarm/[0.09] ring-1 ring-alarm/45 ring-inset">
            <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-alarm motion-safe:animate-[alarm-bar_1.6s_ease-in-out_infinite]" />
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                aria-controls={bodyId}
                aria-label={`Level 1 danger. ${title}, zone ${group.zoneCode}, ${clock.format(new Date(group.at))}`}
                className="w-full px-3 pt-2 pb-2 text-left transition-colors hover:bg-alarm/[0.06] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-alarm"
            >
                <span className="flex items-center gap-2">
                    <DangerBadge />
                    <span className="ml-auto font-mono text-[11px] text-[#FFB3BA] tabular-nums">{clock.format(new Date(group.at))}</span>
                    <ChevronDown aria-hidden className={cn('h-4 w-4 text-[#FFB3BA] transition-transform', open && 'rotate-180')} />
                </span>
                <span className="mt-1.5 block text-sm leading-snug font-semibold text-white">
                    {title}
                </span>
                <span className="mt-0.5 block font-mono text-xs text-[#FFB3BA]/80">
                    Zone {group.zoneCode} · {stamp.format(new Date(group.at))}
                </span>
            </button>

            {open && (
                <div id={bodyId} className="border-t border-alarm/25 bg-night-950/40 px-2 pt-1.5 pb-2">
                    {group.dangers.map(danger =>
                    {
                        const site = danger.siteId ? sites.get(danger.siteId) : undefined;
                        const label = site ? siteLabel(site) : `Zone ${danger.zoneCode} · site not listed`;
                        const resolved = done.has(danger.id);
                        return (
                            <div key={danger.id} role="group" aria-label={`Danger at ${label}`} className={cn('flex items-start gap-2 rounded-md px-1.5 py-1.5', danger.id === selectedId && 'bg-white/6 ring-1 ring-white/15')}>
                                <TrailDot site={site} />
                                <div className="min-w-0 flex-1">
                                    <button type="button" onClick={() => onSelect(danger)} aria-label={label} className="block w-full truncate text-left text-[13px] font-medium text-ink hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-alarm">
                                        {/* The zone is in the card header; rows lead with the trail colour. */}
                                        {label.replace(/^Zone \S+ · /, '')}
                                    </button>
                                    <span className="block font-mono text-[11px] text-ink-muted">within 3 m at {danger.startT.toFixed(1)} s</span>
                                    {siteClosed(site) && <span className="mt-0.5 block text-[11px] font-medium text-[#FFB3BA]">{CLOSED_SITE_NOTE}</span>}
                                </div>
                                {resolved
                                    ? <span className="mt-0.5 inline-flex h-6 items-center gap-1 text-[11px] font-medium text-ok"><ShieldCheck aria-hidden className="h-3.5 w-3.5" />Resolved</span>
                                    : canResolve && (
                                        <button
                                            type="button"
                                            onClick={() => void resolve([danger.id])}
                                            aria-label={`Resolve danger at ${label}`}
                                            disabled={busy.size > 0}
                                            className="mt-0.5 inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-[#FFB3BA] ring-1 ring-alarm/50 transition-colors hover:bg-alarm hover:text-white focus-visible:outline-2 focus-visible:outline-alarm disabled:opacity-50"
                                        >
                                            {busy.has(danger.id) && <LoaderCircle aria-hidden className="h-3 w-3 animate-spin" />}
                                            Resolve
                                        </button>
                                    )}
                            </div>
                        );
                    })}
                    {error && <p role="alert" className="mx-1.5 mt-1.5 rounded-md bg-alarm/15 px-2 py-1 text-xs text-[#FFB3BA] ring-1 ring-alarm/30">{error}</p>}
                    {canResolve && pending.length > 0 && (
                        <button
                            type="button"
                            onClick={() => void resolve(pending.map(danger => danger.id))}
                            disabled={busy.size > 0}
                            className="mt-1.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-alarm text-xs font-semibold text-white shadow-[0_4px_16px_rgba(255,77,94,0.3)] transition-colors hover:bg-[#FF6674] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-alarm disabled:opacity-60"
                        >
                            {busy.size > 1 && <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" />}
                            Resolve all
                        </button>
                    )}
                </div>
            )}
        </li>
    );
}

// A person seen on a linked live camera while its zone had active unprotected sites. Its own card: there is no
// nest site and no measured distance, so it is never grouped with site dangers.
export function CameraDangerCard({ danger, canResolve, onSelect, selected }: { danger: AlertView; canResolve: boolean; onSelect: (alert: AlertView) => void; selected: boolean })
{
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function resolve()
    {
        setError(null);
        setBusy(true);
        const result = await resolveDanger(danger.id);
        setBusy(false);
        if (result.ok)
        {
            setDone(true);
        }
        else
        {
            setError(result.error);
        }
    }

    return (
        <li className={cn('relative overflow-hidden rounded-lg bg-alarm/[0.09] ring-1 ring-alarm/45 ring-inset', selected && 'ring-2 ring-alarm/80')}>
            <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-alarm motion-safe:animate-[alarm-bar_1.6s_ease-in-out_infinite]" />
            <button
                type="button"
                onClick={() => onSelect(danger)}
                aria-label={`Level 1 danger. Camera alert on camera ${danger.cameraCode}, zone ${danger.zoneCode}, ${clock.format(new Date(danger.createdAt))}`}
                className="w-full px-3 pt-2 pb-2 text-left transition-colors hover:bg-alarm/[0.06] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-alarm"
            >
                <span className="flex items-center gap-2">
                    <DangerBadge />
                    <span className="ml-auto font-mono text-[11px] text-[#FFB3BA] tabular-nums">{clock.format(new Date(danger.createdAt))}</span>
                </span>
                <span className="mt-1.5 block text-sm leading-snug font-semibold text-white">{CAMERA_DANGER_LABEL}</span>
                <span className="mt-0.5 block font-mono text-xs text-[#FFB3BA]/80">
                    Camera {danger.cameraCode} · Zone {danger.zoneCode} · {stamp.format(new Date(danger.createdAt))}
                </span>
                <span className="mt-1 block text-[11px] leading-snug text-ink-muted">{danger.message}</span>
            </button>
            {(canResolve || done || error) && (
                <div className="flex items-center gap-2 border-t border-alarm/25 bg-night-950/40 px-3 py-1.5">
                    {done
                        ? <span className="inline-flex h-6 items-center gap-1 text-[11px] font-medium text-ok"><ShieldCheck aria-hidden className="h-3.5 w-3.5" />Resolved</span>
                        : canResolve && (
                            <button
                                type="button"
                                onClick={() => void resolve()}
                                aria-label={`Resolve camera alert on camera ${danger.cameraCode}`}
                                disabled={busy}
                                className="ml-auto inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-[#FFB3BA] ring-1 ring-alarm/50 transition-colors hover:bg-alarm hover:text-white focus-visible:outline-2 focus-visible:outline-alarm disabled:opacity-50"
                            >
                                {busy && <LoaderCircle aria-hidden className="h-3 w-3 animate-spin" />}
                                Resolve
                            </button>
                        )}
                    {error && <p role="alert" className="flex-1 rounded-md bg-alarm/15 px-2 py-1 text-xs text-[#FFB3BA] ring-1 ring-alarm/30">{error}</p>}
                </div>
            )}
        </li>
    );
}

// A danger someone resolved: its own card in Inactive (not the nest-site outcome note).
export function ResolvedDangerCard({ danger, site, onSelect, selected }: { danger: AlertView; site: AlertView | undefined; onSelect: (alert: AlertView) => void; selected: boolean })
{
    return (
        <li>
            <button
                type="button"
                onClick={() => onSelect(danger)}
                aria-expanded={selected}
                data-inactive="true"
                className={cn('w-full rounded-lg border-l-[3px] border-alarm/40 px-3 py-2 text-left text-sm opacity-70 transition-colors hover:bg-white/5 hover:opacity-95 focus-visible:outline-2 focus-visible:outline-amber',
                    selected && 'bg-white/7 opacity-100 ring-1 ring-white/25')}
            >
                <span className="flex items-center gap-1.5 font-medium">
                    <ShieldCheck aria-hidden className="h-3.5 w-3.5 shrink-0 text-ok" />
                    Danger resolved by {danger.resolvedBy ?? 'a volunteer'}
                </span>
                <span className="mt-0.5 block font-mono text-xs text-ink-muted">
                    {isCameraDanger(danger) ? `Camera ${danger.cameraCode} · Zone ${danger.zoneCode}` : site ? siteLabel(site) : `Zone ${danger.zoneCode}`} · {stamp.format(new Date(danger.resolvedAt ?? danger.createdAt))}
                </span>
            </button>
        </li>
    );
}
