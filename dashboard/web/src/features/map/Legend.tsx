'use client';

import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronDown } from 'lucide-react';
import { GlassPanel } from '@/components/ui/glass-panel';
import { cn } from '@/lib/cn';
import { PROTECTION } from '@/features/sites/labels';
import { TRAIL_PALETTE } from './trails';
import { useStoredBoolean } from './useStoredBoolean';

const levels = [
    { label: 'High', className: 'bg-level-high' },
    { label: 'Medium', className: 'bg-level-medium' },
    { label: 'Low', className: 'bg-level-low' },
];

const symbol = 'flex h-4 w-5 shrink-0 items-center justify-center';

const protection = [PROTECTION.unprotected, PROTECTION.protected, PROTECTION.notNeeded];

export function Legend({ className, fadeMinutes = 5 }: { className?: string; fadeMinutes?: number })
{
    const [open, setOpen] = useStoredBoolean('nesttrace.legend.open', true);

    return (
        <GlassPanel className={cn('w-60 text-xs', className)}>
            <Collapsible.Root open={open} onOpenChange={setOpen}>
                <Collapsible.Trigger className="flex h-9 w-full items-center justify-between rounded-xl px-3 text-[10px] font-semibold tracking-[0.16em] text-ink-muted uppercase transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-amber">
                    Legend
                    <ChevronDown aria-hidden className={cn('h-4 w-4 transition-transform', !open && 'rotate-180')} />
                </Collapsible.Trigger>
                <Collapsible.Content className="space-y-2.5 border-t border-white/6 px-3 pt-2.5 pb-3">
                    <div>
                        <p className="mb-1 text-[10px] tracking-[0.12em] text-ink-muted uppercase">Projected motion</p>
                        <p><span className="text-[#1b9767]">●</span> Camera 1 <span className="ml-2 text-[#e68f32]">●</span> Camera 2</p>
                        <p className="mt-1 text-ink-muted">Each heatmap spans the calibrated 24 × 16 m ground area. Planar projection of raised turtles is approximate.</p>
                        <p className="mt-1 text-ink-muted">Hollow pins: unclassified activity candidates, not digging alerts. Dashed footprints show their 0.9 m inspection areas.</p>
                        <p className="mt-1 text-ink-muted">Independent pin location accuracy has not been measured.</p>
                    </div>
                    <div>
                        <p className="mb-1.5 text-[10px] tracking-[0.12em] text-ink-muted uppercase">Zone activity</p>
                        <div className="flex items-center gap-3">
                            {levels.map(level => (
                                <span key={level.label} className="inline-flex items-center gap-1.5">
                                    <span className={cn('h-2.5 w-2.5 rounded-[3px] ring-1 ring-white/20', level.className)} />{level.label}
                                </span>
                            ))}
                        </div>
                    </div>
                    <p className="flex items-center gap-2">
                        <span className={symbol}>
                            <svg aria-hidden viewBox="0 0 20 16" className="h-4 w-5">
                                <path d="M5 8 L19.5 2 A15 15 0 0 1 19.5 14 Z" fill="rgba(215,227,234,0.16)" stroke="rgba(215,227,234,0.55)" strokeDasharray="2 1.5" />
                                <circle cx="5" cy="8" r="3.75" fill="#1B2833" stroke="#fff" strokeWidth="1.5" />
                            </svg>
                        </span>
                        Camera and view cone
                    </p>
                    <div>
                        <p className="mb-1.5 text-[10px] tracking-[0.12em] text-ink-muted uppercase">Nest sites</p>
                        <div className="space-y-1.5">
                            {protection.map(row => (
                                <p key={row.label} className="flex items-center gap-2">
                                    <span className={symbol}><span className="h-3.5 w-3.5 rounded-full border-2" style={{ borderColor: row.color, backgroundColor: `${row.color}40` }} /></span>{row.label}
                                </p>
                            ))}
                            <p className="flex items-center gap-2 text-ink-muted">
                                <span className={symbol}><span className="h-3.5 w-3.5 rounded-full border-[2.5px] border-ink/80" /></span>Thick ring · both cameras
                            </p>
                            <p className="text-ink-muted">Pin footprint: 0.9 m inspection radius at map scale; this is not measured location accuracy.</p>
                            <p className="flex items-center gap-2 text-ink-muted">
                                <span className={symbol}><span className="h-3.5 w-3.5 rounded-full border border-ink/80" /></span>Thin ring · one camera
                            </p>
                            <p className="flex items-center gap-2 text-ink-muted">
                                <span className={symbol}><span className="h-3.5 w-3.5 rounded-full border-2 border-[#E2581F] bg-[#E2581F]/25 opacity-40" /></span>
                                Untouched over {fadeMinutes} min
                            </p>
                            <p className="flex items-center gap-2 text-ink-muted">
                                <span className={cn(symbol, 'gap-0.5')}>
                                    <span className="h-2 w-2 rounded-full bg-[#4ADE80]" /><span className="h-2 w-2 rounded-full bg-[#FFB547]" />
                                </span>
                                Feed playing: both / one camera
                            </p>
                        </div>
                    </div>
                    <p className="flex items-center gap-2">
                        <span className={symbol}>
                            <svg aria-hidden viewBox="0 0 20 16" className="h-4 w-5">
                                <defs>
                                    <linearGradient id="legend-trail" x1="0" x2="1">
                                        {TRAIL_PALETTE.map((color, index) => <stop key={color} offset={index / (TRAIL_PALETTE.length - 1)} stopColor={color} />)}
                                    </linearGradient>
                                </defs>
                                <path d="M1.5 13 C6 13 7 4 12 6 S16 9 16.5 4" fill="none" stroke="url(#legend-trail)" strokeWidth="2" strokeLinecap="round" />
                                <circle cx="16.5" cy="4" r="2.2" fill="#FFF176" stroke="#070D13" strokeWidth="1" />
                            </svg>
                        </span>
                        Turtle trail — colour matches its site
                    </p>
                    <p className="flex items-center gap-2">
                        <span className={symbol}>
                            <span className="relative grid h-3.5 w-3.5 place-items-center rounded-full border-2 border-alarm bg-alarm/30 shadow-[0_0_8px_rgba(255,77,94,0.7)]">
                                <span className="h-1 w-1 rounded-full bg-white" />
                            </span>
                        </span>
                        Danger — person near a site
                    </p>
                </Collapsible.Content>
            </Collapsible.Root>
        </GlassPanel>
    );
}
