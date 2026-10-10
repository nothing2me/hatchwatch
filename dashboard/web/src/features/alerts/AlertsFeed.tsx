'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { BellOff, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { GlassPanel } from '@/components/ui/glass-panel';
import { cn } from '@/lib/cn';
import { isCameraDanger } from '@/lib/danger';
import { classifyOutcome } from '@/lib/sites/outcomes';
import type { AlertKind, AlertView } from '@/lib/types';
import { useStoredBoolean } from '@/features/map/useStoredBoolean';
import { isActive, type Playback } from '@/features/map/playback';
import { inactiveState, NESTING, PROTECTION, type Tone } from '@/features/sites/labels';
import { CameraDangerCard, DangerGroupCard, ResolvedDangerCard } from './DangerCards';
import { groupDangers } from './dangerGroups';

const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });

const tierNote = { TWO_CAMERA: ' · both cameras', SINGLE_CAMERA: ' · one camera' } as const;

type Tab = 'active' | 'inactive';
const TABS: Tab[] = ['active', 'inactive'];
const ACTIVITIES: { kind: AlertKind; label: string }[] = [
    { kind: 'DIGGING', label: 'Digging' },
    { kind: 'TRACK_ONLY', label: 'Crawl only' },
    { kind: 'NO_TURTLE', label: 'No turtle' },
    { kind: 'DANGER', label: 'Person near site' },
];

export function StatusPill({ tone, className }: { tone: Tone; className?: string })
{
    return (
        <span
            className={cn('inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full px-1.5 text-[10px] font-semibold tracking-[0.04em] ring-1 ring-inset', className)}
            style={{ color: tone.color, backgroundColor: `${tone.color}1A`, ['--tw-ring-color' as string]: `${tone.color}4D` }}
        >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone.color }} />
            {tone.label}
        </span>
    );
}

// A patrol has been on site; shown beside the protection pill.
export function PatrolledMark()
{
    return (
        <span className="inline-flex h-[18px] items-center gap-0.5 rounded-full bg-white/6 px-1.5 text-[10px] font-semibold tracking-[0.04em] text-ink/85 ring-1 ring-white/12 ring-inset">
            <Check aria-hidden className="h-3 w-3" strokeWidth={2.5} />Patrolled
        </span>
    );
}

// A patrol found the nest damaged; shown beside the protection pill until the site closes.
export function DamagedMark()
{
    return (
        <span className="inline-flex h-[18px] items-center rounded-full bg-[#E2581F]/15 px-1.5 text-[10px] font-semibold tracking-[0.04em] text-[#F4A27F] ring-1 ring-[#E2581F]/40 ring-inset">
            Damaged
        </span>
    );
}

const outcomeNote = { saved: 'Saved', notSaved: 'Not saved', pending: '', none: '' } as const;

// `inactiveCount` is the server's whole-log count; the snapshot lists only the newest inactive sites.
// Open dangers come first in Active, one card per person passing; `canResolve` (volunteers, admins) adds Resolve buttons.
export function AlertsFeed({ alerts, onSelect, playback = null, selectedId = null, inactiveCount, canResolve = false }: { alerts: AlertView[]; onSelect: (alert: AlertView) => void; playback?: Playback | null; selectedId?: string | null; inactiveCount?: number; canResolve?: boolean })
{
    const [open, setOpen] = useStoredBoolean('alertsOpen', true);
    const [tab, setTab] = useState<Tab>('active');
    const [activities, setActivities] = useState<Set<AlertKind>>(() => new Set(ACTIVITIES.map(item => item.kind)));
    // Danger ids whose group card is expanded (a card stays open as its dangers are resolved one by one).
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set(selectedId ? [selectedId] : []));
    const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ active: null, inactive: null });

    const filtered = alerts.filter(alert => activities.has(alert.kind));
    const active = filtered.filter(alert => alert.site.active);
    const inactive = filtered.filter(alert => !alert.site.active);
    // Camera-level dangers (live detection, no nest site) get their own cards and are never grouped with site dangers.
    const cameraDangers = active.filter(isCameraDanger);
    const dangerGroups = groupDangers(active.filter(alert => alert.kind === 'DANGER' && !isCameraDanger(alert)));
    const sitesById = new Map(alerts.filter(alert => alert.kind !== 'DANGER').map(alert => [alert.id, alert]));
    const shown = (tab === 'active' ? active : inactive).filter(alert => tab === 'inactive' || alert.kind !== 'DANGER');
    const empty = tab === 'active' ? active.length === 0 : inactive.length === 0;
    const counts: Record<Tab, number> = { active: active.length, inactive: activities.size === ACTIVITIES.length ? Math.max(inactive.length, inactiveCount ?? 0) : inactive.length };

    function onTabKey(event: KeyboardEvent<HTMLButtonElement>)
    {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
        {
            return;
        }
        event.preventDefault();
        const next = TABS[(TABS.indexOf(tab) + 1) % TABS.length];
        setTab(next);
        tabRefs.current[next]?.focus();
    }

    if (!open)
    {
        return (
            <GlassPanel className="pointer-events-auto">
                <button type="button" onClick={() => setOpen(true)} className="flex h-9 items-center gap-2 rounded-xl pr-2 pl-3 text-[10px] font-semibold tracking-[0.16em] text-ink-muted uppercase transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-amber">
                    Sites
                    {active.length > 0 && <span className="rounded-full bg-amber/15 px-1.5 font-mono text-[11px] tracking-normal text-amber">{active.length}</span>}
                    <ChevronRight aria-hidden className="h-4 w-4" />
                </button>
            </GlassPanel>
        );
    }

    return (
        <GlassPanel className="pointer-events-auto flex max-h-full min-h-0 w-full flex-col md:w-76">
            <div className="flex h-10 shrink-0 items-center gap-2 pr-1.5 pl-3">
                <p className="text-[10px] font-semibold tracking-[0.16em] text-ink-muted uppercase">Nest sites</p>
                <span aria-hidden className="relative flex h-1.5 w-1.5" title="Live">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber/60 motion-reduce:hidden" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber" />
                </span>
                <button type="button" onClick={() => setOpen(false)} aria-label="Collapse alerts" className="ml-auto grid h-7 w-7 place-items-center rounded-md text-ink-muted transition-colors hover:bg-white/10 hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"><ChevronLeft className="h-4 w-4" /></button>
            </div>

            <div role="radiogroup" aria-label="Site list" className="mx-2 mb-2 grid shrink-0 grid-cols-2 rounded-lg bg-night-950/70 p-0.5 ring-1 ring-white/8">
                {TABS.map(key => (
                    <button
                        key={key}
                        ref={element => { tabRefs.current[key] = element; }}
                        type="button"
                        role="radio"
                        aria-checked={tab === key}
                        tabIndex={tab === key ? 0 : -1}
                        onClick={() => setTab(key)}
                        onKeyDown={onTabKey}
                        className={cn('flex h-7 items-center justify-center gap-1 rounded-md text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-amber',
                            tab === key ? 'bg-white/10 text-ink shadow-sm shadow-black/40' : 'text-ink-muted hover:text-ink')}
                    >
                        {key === 'active' ? 'Active' : 'Inactive'}{' '}
                        <span className={cn('font-mono text-[11px] tabular-nums', tab === key && key === 'active' && counts.active > 0 ? 'text-amber' : 'opacity-70')}>({counts[key]})</span>
                    </button>
                ))}
            </div>

            <details className="relative mx-2 mb-2 shrink-0 rounded-lg bg-night-950/70 text-xs ring-1 ring-white/8">
                <summary className="cursor-pointer px-3 py-2 text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-amber">Activity filters · {activities.size}/{ACTIVITIES.length}</summary>
                <div className="absolute inset-x-0 top-full z-20 mt-1 space-y-1 rounded-lg border border-white/12 bg-night-900 p-2 shadow-xl">
                    {ACTIVITIES.map(item => <label key={item.kind} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-ink hover:bg-white/5"><input type="checkbox" checked={activities.has(item.kind)} onChange={() => setActivities(current => { const next = new Set(current); if (next.has(item.kind)) next.delete(item.kind); else next.add(item.kind); return next; })} className="accent-amber" />{item.label}</label>)}
                </div>
            </details>

            <ul aria-label={tab === 'active' ? 'Active sites' : 'Inactive sites'} className="min-h-0 max-h-[25rem] flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-2 pb-2">
                {tab === 'active' && cameraDangers.map(danger => (
                    <CameraDangerCard key={danger.id} danger={danger} canResolve={canResolve} onSelect={onSelect} selected={danger.id === selectedId} />
                ))}
                {tab === 'active' && dangerGroups.map(group => (
                    <DangerGroupCard
                        key={group.key}
                        group={group}
                        sites={sitesById}
                        canResolve={canResolve}
                        onSelect={onSelect}
                        selectedId={selectedId}
                        open={group.dangers.some(danger => expanded.has(danger.id))}
                        onToggle={() => setExpanded(current =>
                        {
                            const ids = group.dangers.map(danger => danger.id);
                            const next = new Set(current);
                            const isOpen = ids.some(id => next.has(id));
                            ids.forEach(id => (isOpen ? next.delete(id) : next.add(id)));
                            return next;
                        })}
                    />
                ))}
                {empty && (
                    <li className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-white/8 px-4 py-6 text-center max-md:py-4">
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-white/5 ring-1 ring-white/10">
                            <BellOff aria-hidden className="h-4 w-4 text-ink-muted" />
                        </span>
                        {alerts.length === 0
                            ? (<><p className="text-sm text-ink">No alerts yet.</p><p className="text-xs leading-relaxed text-ink-muted">Digging and crawl alerts appear here once camera footage is analysed.</p></>)
                            : activities.size === 0
                                ? (<><p className="text-sm text-ink">No activities selected.</p><p className="text-xs leading-relaxed text-ink-muted">Choose an activity filter to show sites.</p></>)
                            : tab === 'active'
                                ? (<><p className="text-sm text-ink">No active sites.</p><p className="text-xs leading-relaxed text-ink-muted">Every site has an outcome or has faded from the live map.</p></>)
                                : (<><p className="text-sm text-ink">No inactive sites.</p><p className="text-xs leading-relaxed text-ink-muted">Hatched, lost, no-nest and archived sites move here.</p></>)}
                    </li>
                )}
                {shown.map(alert =>
                {
                    if (alert.kind === 'DANGER')
                    {
                        return <ResolvedDangerCard key={alert.id} danger={alert} site={alert.siteId ? sitesById.get(alert.siteId) : undefined} onSelect={onSelect} selected={alert.id === selectedId} />;
                    }
                    const playing = isActive(alert, playback);
                    const selected = alert.id === selectedId;
                    const live = alert.site.active;
                    const needsPatrol = live && alert.kind === 'DIGGING' && !alert.site.personActed;
                    const note = live ? '' : outcomeNote[classifyOutcome(alert.site)];
                    return (
                        <li key={alert.id}>
                            <button
                                type="button"
                                onClick={() => onSelect(alert)}
                                aria-current={playing || undefined}
                                aria-expanded={selected}
                                data-inactive={live ? undefined : 'true'}
                                className={cn('w-full rounded-lg border-l-[3px] px-3 py-2 text-left text-sm transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-amber',
                                    needsPatrol ? 'border-amber bg-amber/7' : 'border-white/15',
                                    !live && 'opacity-60 hover:opacity-90',
                                    selected && 'bg-white/7 ring-1 ring-white/25',
                                    playing && 'bg-amber/10 ring-1 ring-amber/60')}
                            >
                                <span className={cn('block font-medium', needsPatrol && 'text-amber')}>{alert.message}</span>
                                <span className="mt-0.5 block font-mono text-xs text-ink-muted">
                                    Zone {alert.zoneCode} · {alert.cameraCode} · {timeFormat.format(new Date(alert.createdAt))}
                                    {alert.score !== null && ` · score ${alert.score.toFixed(2)}`}
                                </span>
                                <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                                    {live
                                        ? (<><StatusPill tone={PROTECTION[alert.site.protection]} />{alert.site.patrolVisited && <PatrolledMark />}{alert.site.damaged && <DamagedMark />}<span className="text-[11px] text-ink-muted">{NESTING[alert.site.nesting]}</span></>)
                                        : (<><StatusPill tone={inactiveState(alert.site)} />{note && <span className="text-[11px] text-ink-muted">{note}</span>}</>)}
                                </span>
                                {alert.evidenceTier && (
                                    <span className="mt-1 block text-[11px] text-ink-muted/80">
                                        {alert.simulated ? 'Simulated · approximate position' : 'Approximate position'}{tierNote[alert.evidenceTier]}
                                    </span>
                                )}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </GlassPanel>
    );
}
