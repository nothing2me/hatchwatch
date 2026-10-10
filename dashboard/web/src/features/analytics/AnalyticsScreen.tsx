'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Archive, Cctv, Footprints, MapPin, Radar, ShieldAlert, Siren } from 'lucide-react';
import type { SessionUser } from '@/lib/auth/session';
import type { MapSnapshot } from '@/lib/types';
import { isNestSite } from '@/lib/danger';
import { cn } from '@/lib/cn';
import { TopBar } from '@/features/shell/TopBar';
import { useLiveSnapshot } from '@/features/live/useLiveSnapshot';
import { useNow } from '@/features/live/useNow';
import { BarChart, StackedBar, type Segment } from './charts';
import { analyticsMetrics, dangerStats, percentOf, type Bar, type Scope } from './metrics';
import { HistorySheet } from './HistorySheet';

const SCOPES: { key: Scope; label: string }[] = [
    { key: 'map', label: 'On the map now' },
    { key: 'all', label: 'Historical record' },
];

const DANGER = '#E2581F';

function ScopeToggle({ scope, onChange }: { scope: Scope; onChange: (scope: Scope) => void })
{
    const refs = useRef<Record<Scope, HTMLButtonElement | null>>({ map: null, all: null });
    function onKey(event: KeyboardEvent<HTMLButtonElement>)
    {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
        {
            return;
        }
        event.preventDefault();
        const next = scope === 'map' ? 'all' : 'map';
        onChange(next);
        refs.current[next]?.focus();
    }
    return (
        <div role="radiogroup" aria-label="Scope" className="grid grid-cols-2 rounded-xl bg-night-900/80 p-1 ring-1 ring-white/8 max-sm:w-full">
            {SCOPES.map(option => (
                <button
                    key={option.key}
                    ref={element => { refs.current[option.key] = element; }}
                    type="button"
                    role="radio"
                    aria-checked={scope === option.key}
                    tabIndex={scope === option.key ? 0 : -1}
                    onClick={() => onChange(option.key)}
                    onKeyDown={onKey}
                    className={cn('h-8 rounded-lg px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-amber',
                        scope === option.key ? 'bg-white/10 text-ink shadow-sm shadow-black/40' : 'text-ink-muted hover:text-ink')}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}

interface TileProps
{
    label: string;
    value: string;
    caption: string;
    icon: ReactNode;
    meter?: { pct: number; color: string };
    danger?: boolean;
    /** Level-1 danger red instead of the orange "needs attention" tone. */
    alarm?: boolean;
    className?: string;
}

function Tile({ label, value, caption, icon, meter, danger = false, alarm = false, className }: TileProps)
{
    return (
        <div
            role="group"
            aria-label={label}
            data-tone={danger ? 'danger' : undefined}
            className={cn('relative flex min-w-0 flex-col overflow-hidden rounded-2xl border p-4 sm:p-5',
                danger ? (alarm ? 'border-alarm/45 bg-alarm/[0.09]' : 'border-danger/35 bg-danger/[0.07]') : 'border-white/8 bg-night-900/70', className)}
        >
            {danger && <span aria-hidden className={cn('absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent', alarm ? 'via-alarm' : 'via-danger')} />}
            <div className="flex items-start justify-between gap-2">
                <p className={cn('text-[11px] leading-[1.4] font-semibold tracking-[0.12em] uppercase', danger ? (alarm ? 'text-[#FF8A95]' : 'text-[#F2865A]') : 'text-ink-muted')}>{label}</p>
                <span aria-hidden className={cn('shrink-0', danger ? (alarm ? 'text-alarm' : 'text-danger') : 'text-ink-muted/70')}>{icon}</span>
            </div>
            {/* Value block sits on the tile floor so tiles in a row line up even when a label wraps. */}
            <div className="mt-auto pt-3">
                <p data-testid="value" className={cn('text-[34px] leading-none font-semibold tracking-tight sm:text-[40px]', danger ? (alarm ? 'text-[#FF8A95]' : 'text-[#F2865A]') : 'text-ink')}>{value}</p>
                <p className="mt-2 text-xs leading-snug text-ink-muted tabular-nums">{caption}</p>
                <span aria-hidden className={cn('mt-3 block h-1 overflow-hidden rounded-full', meter ? 'bg-white/8' : 'bg-transparent')}>
                    {meter && <span className="block h-full rounded-full" style={{ width: `${meter.pct}%`, backgroundColor: meter.color }} />}
                </span>
            </div>
        </div>
    );
}

function Card({ title, subtitle, action, children, className, labelled = false }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string; labelled?: boolean })
{
    const id = `card-${title.replace(/\W/g, '').toLowerCase()}`;
    return (
        <section aria-labelledby={labelled ? id : undefined} className={cn('rounded-2xl border border-white/8 bg-night-900/70 p-4 sm:p-5', className)}>
            <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 id={id} className="text-sm font-semibold text-ink">{title}</h2>
                    {subtitle && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
                </div>
                {action}
            </div>
            {children}
        </section>
    );
}

function ChartCard({ title, subtitle, bars, total }: { title: string; subtitle: string; bars: Bar[]; total: number })
{
    const [table, setTable] = useState(false);
    return (
        <Card
            title={title}
            subtitle={subtitle}
            action={(
                <button type="button" onClick={() => setTable(value => !value)} className="shrink-0 rounded-md px-2 py-1 text-[11px] text-ink-muted ring-1 ring-white/10 transition-colors hover:bg-white/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-amber">
                    {table ? 'Show chart' : 'Show table'}
                </button>
            )}
        >
            {table
                ? (
                    <table className="w-full text-left text-xs">
                        <caption className="sr-only">{title}</caption>
                        <thead className="text-ink-muted">
                            <tr className="border-b border-white/8"><th className="py-1.5 font-medium">Category</th><th className="py-1.5 text-right font-medium">Sites</th><th className="py-1.5 text-right font-medium">Share</th></tr>
                        </thead>
                        <tbody className="font-mono tabular-nums">
                            {bars.map(bar => (
                                <tr key={bar.key} className="border-b border-white/5 last:border-0">
                                    <td className="py-2 font-sans"><span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: bar.color }} />{bar.label}{bar.detail && <span className="text-ink-muted">{bar.detail}</span>}</span></td>
                                    <td className="py-2 text-right">{bar.count}</td>
                                    <td className="py-2 text-right text-ink-muted">{percentOf(bar.count, total)}%</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )
                : <BarChart title={title} bars={bars} total={total} />}
        </Card>
    );
}

const DEMO_NOTE = 'Includes demo patrol (simulated)';

function DemoNote({ className }: { className?: string })
{
    return <p data-testid="demo-patrol-note" className={cn('text-xs text-amber', className)}>{DEMO_NOTE}</p>;
}

function Outcomes({ outcomes, demo = false }: { outcomes: { saved: number; notSaved: number; pending: number }; demo?: boolean })
{
    const total = outcomes.saved + outcomes.notSaved + outcomes.pending;
    const segments: (Segment & { note: string })[] = [
        { key: 'saved', label: 'Saved', count: outcomes.saved, color: '#4ADE80', note: 'hatched' },
        { key: 'notSaved', label: 'Not saved', count: outcomes.notSaved, color: DANGER, note: 'lost, faded unprotected, or no protection 30 min after a person came near' },
        { key: 'pending', label: 'Pending', count: outcomes.pending, color: '#8A9BA6', note: 'still open' },
    ];
    return (
        <Card title="Outcomes" subtitle="What happened to each nest site. No-nest findings are left out." labelled>
            <StackedBar title="Outcomes" segments={segments} />
            {demo && <DemoNote className="mt-3" />}
            <dl className="mt-5 grid grid-cols-3 gap-3 sm:gap-6">
                {segments.map(segment => (
                    <div key={segment.key} className="min-w-0 border-l border-white/8 pl-3 sm:pl-4">
                        <dt className="flex items-center gap-1.5 text-xs text-ink-muted">
                            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: segment.color }} />
                            <span className="truncate">{segment.label}</span>
                        </dt>
                        <dd className="mt-1.5 flex items-baseline gap-2">
                            <span className="text-2xl font-semibold text-ink sm:text-3xl">{segment.count}</span>
                            <span className="font-mono text-xs text-ink-muted tabular-nums">{percentOf(segment.count, total)}%</span>
                        </dd>
                        <dd className="mt-0.5 hidden text-[11px] leading-snug text-ink-muted/80 sm:block">{segment.note}</dd>
                    </div>
                ))}
            </dl>
        </Card>
    );
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode })
{
    return (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-night-900/40 px-6 py-16 text-center">
            <span className="relative grid h-14 w-14 place-items-center rounded-full bg-white/5 ring-1 ring-white/10">
                <span aria-hidden className="absolute inset-0 animate-ping rounded-full ring-1 ring-amber/30 motion-reduce:hidden" />
                <Radar aria-hidden className="h-6 w-6 text-amber" />
            </span>
            <p className="text-base font-medium text-ink">{title}</p>
            <p className="max-w-sm text-sm text-ink-muted">{body}</p>
            {action}
        </div>
    );
}

export function AnalyticsScreen({ snapshot: initialSnapshot, user }: { snapshot: MapSnapshot; user: SessionUser })
{
    const snapshot = useLiveSnapshot(initialSnapshot);
    const [scope, setScope] = useState<Scope>('map');
    // The client clock re-applies the 30-min danger rule, so Not saved moves when a deadline passes.
    const now = useNow(15_000);
    const m = analyticsMetrics(snapshot, scope, now);
    const danger = dangerStats(snapshot);
    const firstDanger = snapshot.alerts.find(alert => alert.kind === 'DANGER' && alert.site.active)?.id ?? null;
    const activeSites = snapshot.alerts.filter(alert => isNestSite(alert) && alert.site.active).length;
    const nothingYet = snapshot.alerts.length === 0 && snapshot.inactiveCount === 0;
    const icon = 'h-4 w-4';

    return (
        <main className="relative min-h-full overflow-x-hidden bg-night-950">
            {/* Night-sky texture: faint dot grid and a low amber horizon glow. */}
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(215,227,234,0.06)_1px,transparent_1px)] [mask-image:linear-gradient(to_bottom,black,transparent_70%)] bg-[size:22px_22px]" />
            <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[60rem] max-w-[200vw] -translate-x-1/2 rounded-full bg-amber/[0.06] blur-3xl" />

            <div className="sticky top-0 z-20 p-3">
                <TopBar user={user} current="analytics" camerasOnline={snapshot.camerasOnline} camerasTotal={snapshot.camerasTotal} activeSites={activeSites} dangerCount={snapshot.dangerCount} firstDangerId={firstDanger} />
            </div>

            <div className="relative mx-auto max-w-6xl px-4 pt-6 pb-16 sm:px-6 sm:pt-10">
                <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.18em] text-ink-muted uppercase">
                            <span aria-hidden className="relative flex h-1.5 w-1.5">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber/60 motion-reduce:hidden" />
                                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber" />
                            </span>
                            Live · Port Aransas
                        </p>
                        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{scope === 'all' ? 'Beach monitoring history' : 'Tonight at a glance'}</h1>
                        <p className="mt-1.5 text-sm text-ink-muted">{scope === 'all' ? 'Saved camera activity and field actions since the first database record.' : 'Nest sites from the camera network and the patrol log, updated as they change.'}</p>
                    </div>
                    <ScopeToggle scope={scope} onChange={setScope} />
                </header>

                {scope === 'all' ? <HistorySheet /> : nothingYet
                    ? <div className="mt-8"><EmptyState title="No sites yet — waiting for the live feed" body="Digging alerts from the beach cameras will show up here as soon as the first one arrives." /></div>
                    : (
                        <>
                            {snapshot.demoPatrolOnMap && <DemoNote className="mt-6 -mb-5" />}
                            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                                <Tile label="Sites" value={String(m.sites)} caption={scope === 'map' ? 'on the live map' : `${activeSites} active · ${m.sites - activeSites} inactive`} icon={<MapPin className={icon} />} />
                                <Tile label="Unprotected" value={String(m.unprotected)} caption={`${m.unprotectedPct}% of sites`} icon={<ShieldAlert className={icon} />} danger={m.unprotected > 0} meter={{ pct: m.unprotectedPct, color: DANGER }} />
                                <Tile label="Patrol visited" value={String(m.patrolVisited)} caption={`${m.patrolVisitedPct}% of sites`} icon={<Footprints className={icon} />} meter={{ pct: m.patrolVisitedPct, color: '#D7E3EA' }} />
                                <Tile label="Seen by both cameras" value={`${m.bothCamerasPct}%`} caption={`${m.bothCameras} of ${m.charted} sites`} icon={<Cctv className={icon} />} meter={{ pct: m.bothCamerasPct, color: '#FFB547' }} />
                                <Tile label="Archived" value={String(m.archived)} caption={scope === 'map' ? 'none on the live map' : 'faded, nobody logged'} icon={<Archive className={icon} />} />
                                <Tile label="Danger alerts" value={`${danger.active}/${danger.total}`} caption={danger.active > 0 ? 'open now · person near a nest' : danger.total > 0 ? 'all resolved' : 'none logged'} icon={<Siren className={icon} />} danger={danger.active > 0} alarm />
                            </div>

                            {m.charted === 0
                                ? (
                                    <div className="mt-6">
                                        <EmptyState
                                            title="Nothing on the live map right now"
                                            body="Every site has an outcome or has faded from the map."
                                            action={<button type="button" onClick={() => setScope('all')} className="mt-1 rounded-lg px-3 py-1.5 text-sm text-amber ring-1 ring-amber/30 hover:bg-amber/10 focus-visible:outline-2 focus-visible:outline-amber">View historical record</button>}
                                        />
                                    </div>
                                )
                                : (
                                    <>
                                        <div className="mt-6"><Outcomes outcomes={m.outcomes} demo={Boolean(snapshot.demoPatrol)} /></div>
                                        <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                                            <ChartCard title="Protection" subtitle="Is a cage or barrier in place?" bars={m.protection} total={m.charted} />
                                            <ChartCard title="Nesting" subtitle="What patrols found on site" bars={m.nesting} total={m.charted} />
                                            <ChartCard title="Sites by zone" subtitle="Every monitored zone, empty ones too" bars={m.byZone} total={m.charted} />
                                        </div>
                                        {m.charted < m.sites && (
                                            <p className="mt-4 text-xs text-ink-muted">Breakdowns cover the newest {m.charted} of {m.sites} logged sites; outcomes and the site total cover the whole log.</p>
                                        )}
                                    </>
                                )}
                        </>
                    )}
            </div>
        </main>
    );
}
