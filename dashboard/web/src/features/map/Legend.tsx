'use client';

import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronDown } from 'lucide-react';
import { GlassPanel } from '@/components/ui/glass-panel';
import { cn } from '@/lib/cn';
import { useStoredBoolean } from './useStoredBoolean';

const levels = [
    { label: 'High', className: 'bg-level-high' },
    { label: 'Medium', className: 'bg-level-medium' },
    { label: 'Low', className: 'bg-level-low' },
];

const symbol = 'grid h-4 w-5 shrink-0 place-items-center';

export function Legend({ className }: { className?: string })
{
    const [open, setOpen] = useStoredBoolean('nesttrace.legend.open', true);

    return (
        <GlassPanel className={cn('w-56 text-xs', className)}>
            <Collapsible.Root open={open} onOpenChange={setOpen}>
                <Collapsible.Trigger className="flex h-9 w-full items-center justify-between rounded-xl px-3 text-[10px] font-semibold tracking-[0.16em] text-ink-muted uppercase transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-amber">
                    Legend
                    <ChevronDown aria-hidden className={cn('h-4 w-4 transition-transform', !open && 'rotate-180')} />
                </Collapsible.Trigger>
                <Collapsible.Content className="space-y-2.5 border-t border-white/6 px-3 pt-2.5 pb-3">
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
                    <p className="flex items-center gap-2"><span className={symbol}><span className="h-3.5 w-3.5 rounded-full border-2 border-amber bg-amber/20" /></span>Alert region</p>
                    <p className="flex items-center gap-2 text-ink-muted"><span className={symbol}><span className="h-0.5 w-4 rounded-full bg-amber" /></span>Turtle track (with footage)</p>
                </Collapsible.Content>
            </Collapsible.Root>
        </GlassPanel>
    );
}
