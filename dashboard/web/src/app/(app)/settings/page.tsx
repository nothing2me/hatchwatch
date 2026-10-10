import Link from 'next/link';
import { Cctv, Users } from 'lucide-react';
import { requireCurrentUser } from '@/lib/auth/guard';
import { isNestSite } from '@/lib/danger';
import { getMapSnapshot } from '@/server/snapshot';
import { TopBar } from '@/features/shell/TopBar';

export const dynamic = 'force-dynamic';

// Settings hub: people and cameras.
export default async function SetupPage()
{
    const [user, snapshot] = await Promise.all([requireCurrentUser('ADMIN'), getMapSnapshot()]);
    const activeSites = snapshot.alerts.filter(alert => isNestSite(alert) && alert.site.active).length;
    const firstDangerId = snapshot.alerts.find(alert => alert.kind === 'DANGER' && alert.site.active)?.id ?? null;
    return (
        <main className="min-h-full bg-night-950">
            <div className="sticky top-0 z-20 p-3">
                <TopBar user={user} current="settings" camerasOnline={snapshot.camerasOnline} camerasTotal={snapshot.camerasTotal} activeSites={activeSites} dangerCount={snapshot.dangerCount} firstDangerId={firstDangerId} />
            </div>
            <div className="mx-auto max-w-3xl px-4 pt-6 pb-16 sm:px-6 sm:pt-10">
                <h1 className="text-3xl font-semibold tracking-tight text-ink">Settings</h1>
                <p className="mt-1.5 text-sm text-ink-muted">Manage who can sign in and where the cameras stand.</p>
                <Link href="/settings/users" className="mt-6 flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] p-4 transition-colors hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-amber">
                    <Users aria-hidden className="h-5 w-5 text-amber" />
                    <span>
                        <span className="block font-medium text-ink">Users</span>
                        <span className="block text-sm text-ink-muted">Add people, set roles, disable or enable accounts.</span>
                    </span>
                </Link>
                <Link href="/settings/cameras" className="mt-3 flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] p-4 transition-colors hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-amber">
                    <Cctv aria-hidden className="h-5 w-5 text-amber" />
                    <span>
                        <span className="block font-medium text-ink">Cameras</span>
                        <span className="block text-sm text-ink-muted">Add camera pairs facing the sea, edit locations and headings, merge zones.</span>
                    </span>
                </Link>
            </div>
        </main>
    );
}
