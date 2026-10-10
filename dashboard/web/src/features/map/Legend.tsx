'use client';

import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronDown } from 'lucide-react';
import { GlassPanel } from '@/components/ui/glass-panel';
import { cn } from '@/lib/cn';
import { PROTECTION } from '@/features/sites/labels';
import { useStoredBoolean } from './useStoredBoolean';

const levels = [
    { label: 'High', className: 'bg-level-high' },
    { label: 'Medium', className: 'bg-level-medium' },
    { label: 'Low', className: 'bg-level-low' },
];

export function Legend({ className }: { className?: string; fadeMinutes?: number })
{
    const [open, setOpen] = useStoredBoolean('nesttrace.legend.open', true);
    return (
        <GlassPanel className={cn('w-52 text-xs', className)}>
            <Collapsible.Root open={open} onOpenChange={setOpen}>
                <Collapsible.Trigger className="flex h-9 w-full items-center justify-between rounded-xl px-3 text-[10px] font-semibold tracking-[0.16em] text-ink-muted uppercase hover:text-ink focus-visible:outline-2 focus-visible:outline-amber">
                    Legend <ChevronDown aria-hidden className={cn('h-4 w-4 transition-transform', !open && 'rotate-180')} />
                </Collapsible.Trigger>
                <Collapsible.Content className="space-y-3 border-t border-white/6 px-3 pt-3 pb-3">
                    <div><p className="mb-1 text-[10px] tracking-wider text-ink-muted uppercase">Motion</p><p><span className="text-[#1b9767]">●</span> Camera 1 <span className="ml-2 text-[#e68f32]">●</span> Camera 2</p></div>
                    <div><p className="mb-1 text-[10px] tracking-wider text-ink-muted uppercase">Zone activity</p><div className="flex gap-2">{levels.map(level => <span key={level.label} className="inline-flex items-center gap-1"><span className={cn('h-2.5 w-2.5 rounded-[3px]', level.className)} />{level.label}</span>)}</div></div>
                    <div><p className="mb-1 text-[10px] tracking-wider text-ink-muted uppercase">Site pins</p><div className="space-y-1">{[PROTECTION.unprotected, PROTECTION.protected, PROTECTION.notNeeded].map(row => <p key={row.label} className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border-2" style={{ borderColor: row.color, backgroundColor: `${row.color}40` }} />{row.label}</p>)}</div></div>
                    <p className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border border-[#28B58A] bg-[#28B58A]/20" />Secured area</p>
                    <p className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border-2 border-alarm bg-alarm/30" />Person near a site</p>
                    <p className="text-[11px] text-ink-muted">Click a pin for details. Right-click a zone for playback.</p>
                </Collapsible.Content>
            </Collapsible.Root>
        </GlassPanel>
    );
}
