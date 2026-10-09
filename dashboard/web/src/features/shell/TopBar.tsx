import Link from 'next/link';
import { LogOut, TriangleAlert, Video } from 'lucide-react';
import { GlassPanel } from '@/components/ui/glass-panel';
import { logoutAction } from '@/app/(app)/actions';
import type { SessionUser } from '@/lib/auth/session';
import { cn } from '@/lib/cn';

interface TopBarProps
{
    user: SessionUser;
    camerasOnline: number;
    camerasTotal: number;
    activeAlertCount: number;
}

const chip = 'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs';

export function TopBar({ user, camerasOnline, camerasTotal, activeAlertCount }: TopBarProps)
{
    const hasAlerts = activeAlertCount > 0;

    return (
        <GlassPanel className="pointer-events-auto flex h-12 shrink-0 items-center gap-3 pr-2 pl-4">
            <span className="text-[13px] font-bold tracking-[0.2em]">NESTTRACE</span>
            <span aria-hidden className="hidden h-4 w-px bg-white/12 sm:block" />
            <span className="hidden truncate text-sm text-ink-muted sm:inline">Port Aransas · Holiday Beach</span>

            <div className="ml-auto flex items-center gap-1.5">
                <span className={cn(chip, 'hidden bg-white/5 md:inline-flex')}>
                    <Video aria-hidden className="h-3.5 w-3.5 text-ok" />
                    <span className="font-mono tabular-nums">{camerasOnline}/{camerasTotal}</span>
                    <span className="hidden text-ink-muted lg:inline">cameras online</span>
                </span>
                <span className={cn(chip, hasAlerts ? 'bg-amber/15 text-amber ring-1 ring-amber/30' : 'bg-white/5 text-ink-muted')}>
                    <TriangleAlert aria-hidden className="h-3.5 w-3.5" />
                    <span className="font-mono tabular-nums">{activeAlertCount}</span>
                    <span className="sr-only lg:not-sr-only lg:opacity-80">{activeAlertCount === 1 ? 'active alert' : 'active alerts'}</span>
                </span>
                {user.role === 'ADMIN' && (
                    <Link href="/setup" className="inline-flex h-7 items-center rounded-full px-3 text-xs text-ink-muted transition-colors hover:bg-white/8 hover:text-ink focus-visible:outline-2 focus-visible:outline-amber">Setup</Link>
                )}
                <span aria-hidden className="mx-1 h-5 w-px bg-white/10" />
                <form action={logoutAction}>
                    <button type="submit" title={`Sign out ${user.email}`} className="grid h-8 w-8 place-items-center rounded-full text-ink-muted transition-colors hover:bg-white/8 hover:text-ink focus-visible:outline-2 focus-visible:outline-amber">
                        <LogOut aria-hidden className="h-4 w-4" /><span className="sr-only">Sign out</span>
                    </button>
                </form>
            </div>
        </GlassPanel>
    );
}
