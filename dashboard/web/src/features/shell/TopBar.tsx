import Link from 'next/link';
import { LogOut, TriangleAlert, Video } from 'lucide-react';
import { GlassPanel } from '@/components/ui/glass-panel';
import { logoutAction } from '@/app/(app)/actions';
import type { SessionUser } from '@/lib/auth/session';
import { cn } from '@/lib/cn';

export type Page = 'map' | 'analytics' | 'setup';

interface TopBarProps
{
    user: SessionUser;
    current: Page;
    camerasOnline: number;
    camerasTotal: number;
    activeSites: number;     // the map's Active tab count
}

const chip = 'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs';

const NAV: { page: Page; href: string; label: string; adminOnly?: boolean }[] = [
    { page: 'map', href: '/', label: 'Map' },
    { page: 'analytics', href: '/analytics', label: 'Analytics' },
    { page: 'setup', href: '/setup', label: 'Setup', adminOnly: true },
];

// Turtle mark from the favicon, drawn inline so it inherits the ink colour.
function Mark()
{
    return (
        <svg aria-hidden viewBox="0 0 32 32" className="h-5 w-5 shrink-0 text-ink">
            <ellipse cx="16" cy="17" rx="7.5" ry="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M16 8.5v17M9 14h14M9.5 21h13" stroke="currentColor" strokeWidth="1.5" opacity=".55" />
            <circle cx="16" cy="5.5" r="2.5" fill="currentColor" />
        </svg>
    );
}

export function TopBar({ user, current, camerasOnline, camerasTotal, activeSites }: TopBarProps)
{
    const hasSites = activeSites > 0;
    const links = NAV.filter(item => !item.adminOnly || user.role === 'ADMIN');

    return (
        <GlassPanel className="pointer-events-auto flex h-12 shrink-0 items-center gap-2 pr-2 pl-3 sm:gap-3 sm:pl-4">
            <Link href="/" className="flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-amber" aria-label="NestTrace home">
                <Mark />
                <span className="hidden text-[13px] font-bold tracking-[0.2em] sm:inline">NESTTRACE</span>
            </Link>
            <span aria-hidden className="hidden h-4 w-px bg-white/12 sm:block" />

            <nav aria-label="Main" className="flex items-center gap-0.5 rounded-full bg-night-950/60 p-0.5 ring-1 ring-white/8">
                {links.map(item =>
                {
                    const here = item.page === current;
                    return (
                        <Link
                            key={item.page}
                            href={item.href}
                            aria-current={here ? 'page' : undefined}
                            className={cn('inline-flex h-7 items-center rounded-full px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-amber sm:px-3',
                                here ? 'bg-white/10 text-ink shadow-sm shadow-black/40' : 'text-ink-muted hover:text-ink')}
                        >
                            {here && <span aria-hidden className="mr-1.5 h-1 w-1 rounded-full bg-amber" />}
                            {item.label}
                        </Link>
                    );
                })}
            </nav>

            <span className="hidden truncate text-sm text-ink-muted xl:inline">Port Aransas · Holiday Beach</span>

            <div className="ml-auto flex items-center gap-1.5">
                <span className={cn(chip, 'hidden bg-white/5 md:inline-flex')}>
                    <Video aria-hidden className="h-3.5 w-3.5 text-ok" />
                    <span className="font-mono tabular-nums">{camerasOnline}/{camerasTotal}</span>
                    <span className="hidden text-ink-muted lg:inline">cameras online</span>
                </span>
                <span className={cn(chip, hasSites ? 'bg-amber/15 text-amber ring-1 ring-amber/30' : 'bg-white/5 text-ink-muted')} title={`${activeSites} active ${activeSites === 1 ? 'site' : 'sites'} on the map`}>
                    <TriangleAlert aria-hidden className="h-3.5 w-3.5" />
                    <span className="font-mono tabular-nums">{activeSites}</span>
                    <span className="sr-only lg:not-sr-only lg:opacity-80">{activeSites === 1 ? 'active site' : 'active sites'}</span>
                </span>
                <span aria-hidden className="mx-0.5 h-5 w-px bg-white/10 sm:mx-1" />
                <form action={logoutAction}>
                    <button type="submit" title={`Sign out ${user.email}`} className="grid h-8 w-8 place-items-center rounded-full text-ink-muted transition-colors hover:bg-white/8 hover:text-ink focus-visible:outline-2 focus-visible:outline-amber">
                        <LogOut aria-hidden className="h-4 w-4" /><span className="sr-only">Sign out</span>
                    </button>
                </form>
            </div>
        </GlassPanel>
    );
}
