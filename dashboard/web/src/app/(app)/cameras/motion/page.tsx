import { requireCurrentUser } from '@/lib/auth/guard';
import { isNestSite } from '@/lib/danger';
import { getMapSnapshot } from '@/server/snapshot';
import { MotionScreen } from '@/features/phones/MotionScreen';

export const dynamic = 'force-dynamic';

export default async function MotionPage({ searchParams }: { searchParams: Promise<{ device?: string | string[] }> })
{
    const [user, snapshot, params] = await Promise.all([requireCurrentUser(), getMapSnapshot(), searchParams]);
    const activeSites = snapshot.alerts.filter(alert => isNestSite(alert) && alert.site.active).length;
    const firstDangerId = snapshot.alerts.find(alert => alert.kind === 'DANGER' && alert.site.active)?.id ?? null;
    const bar = { camerasOnline: snapshot.camerasOnline, camerasTotal: snapshot.camerasTotal, activeSites, dangerCount: snapshot.dangerCount, firstDangerId };
    const deviceId = typeof params.device === 'string' && params.device ? params.device : null;
    return <MotionScreen user={user} bar={bar} deviceId={deviceId} />;
}
