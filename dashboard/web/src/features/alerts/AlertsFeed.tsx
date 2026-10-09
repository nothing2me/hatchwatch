'use client';

import { BellOff, ChevronLeft, ChevronRight } from 'lucide-react';
import { GlassPanel } from '@/components/ui/glass-panel';
import { cn } from '@/lib/cn';
import type { AlertView } from '@/lib/types';
import { useStoredBoolean } from '@/features/map/useStoredBoolean';

const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });

export function AlertsFeed({ alerts, onSelect }: { alerts: AlertView[]; onSelect: (alert: AlertView) => void })
{
    const [open, setOpen] = useStoredBoolean('nesttrace.alerts.open', true);
    const newCount = alerts.filter(alert => alert.status === 'NEW').length;

    if (!open)
    {
        return (
            <GlassPanel className="pointer-events-auto">
                <button type="button" onClick={() => setOpen(true)} className="flex h-9 items-center gap-2 rounded-xl pr-2 pl-3 text-[10px] font-semibold tracking-[0.16em] text-ink-muted uppercase transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-amber">
                    Alerts
                    {newCount > 0 && <span className="rounded-full bg-amber/15 px-1.5 font-mono text-[11px] tracking-normal text-amber">{newCount}</span>}
                    <ChevronRight aria-hidden className="h-4 w-4" />
                </button>
            </GlassPanel>
        );
    }

    return (
        <GlassPanel className="pointer-events-auto flex max-h-full min-h-0 w-full flex-col md:w-72">
            <div className="flex h-10 shrink-0 items-center gap-2 pr-1.5 pl-3">
                <p className="text-[10px] font-semibold tracking-[0.16em] text-ink-muted uppercase">Alerts</p>
                <span className={cn('rounded-full px-1.5 font-mono text-[11px]', newCount > 0 ? 'bg-amber/15 text-amber' : 'bg-white/6 text-ink-muted')}>
                    {newCount > 0 ? `${newCount} new` : alerts.length}
                </span>
                <button type="button" onClick={() => setOpen(false)} aria-label="Collapse alerts" className="ml-auto grid h-7 w-7 place-items-center rounded-md text-ink-muted transition-colors hover:bg-white/10 hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"><ChevronLeft className="h-4 w-4" /></button>
            </div>
            <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-2">
                {alerts.length === 0 && (
                    <li className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-white/8 px-4 py-6 text-center max-md:py-4">
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-white/5 ring-1 ring-white/10">
                            <BellOff aria-hidden className="h-4 w-4 text-ink-muted" />
                        </span>
                        <p className="text-sm text-ink">No alerts yet.</p>
                        <p className="text-xs leading-relaxed text-ink-muted">Digging and crawl alerts appear here once camera footage is analysed.</p>
                    </li>
                )}
                {alerts.map(alert => (
                    <li key={alert.id}>
                        <button
                            type="button"
                            onClick={() => onSelect(alert)}
                            className={cn('w-full rounded-lg border-l-[3px] px-3 py-2 text-left text-sm transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-amber',
                                alert.kind === 'DIGGING' && alert.status === 'NEW' ? 'border-amber bg-amber/7' : 'border-white/15')}
                        >
                            <span className={cn('block font-medium', alert.kind === 'DIGGING' && 'text-amber')}>{alert.message}</span>
                            <span className="mt-0.5 block font-mono text-xs text-ink-muted">
                                Zone {alert.zoneCode} · {alert.cameraCode} · {timeFormat.format(new Date(alert.createdAt))}
                                {alert.score !== null && ` · score ${alert.score.toFixed(2)}`}
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </GlassPanel>
    );
}
