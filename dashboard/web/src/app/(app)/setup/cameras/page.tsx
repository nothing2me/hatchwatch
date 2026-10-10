import { requireCurrentUser } from '@/lib/auth/guard';
import { listCameras } from '@/lib/cameras/manage';
import { isNestSite } from '@/lib/danger';
import { prisma } from '@/lib/db';
import type { LngLat } from '@/lib/types';
import { getMapSnapshot } from '@/server/snapshot';
import { CamerasScreen } from '@/features/cameras/CamerasScreen';

export const dynamic = 'force-dynamic';

export default async function CamerasPage()
{
    const user = await requireCurrentUser('ADMIN');
    const [snapshot, listing] = await Promise.all([getMapSnapshot(), listCameras(prisma)]);
    const activeSites = snapshot.alerts.filter(alert => isNestSite(alert) && alert.site.active).length;
    // Suggested spot for a new pair: the middle of each zone's land edge.
    const landMid = new Map(snapshot.zones.filter(zone => zone.ring.length >= 2).map(zone => [zone.code, [(zone.ring[0][0] + zone.ring[1][0]) / 2, (zone.ring[0][1] + zone.ring[1][1]) / 2] as LngLat]));
    return (
        <CamerasScreen
            user={user}
            zones={listing.zones.map(zone => ({ ...zone, suggested: landMid.get(zone.code) ?? null }))}
            cameras={listing.cameras}
            bar={{ camerasOnline: snapshot.camerasOnline, camerasTotal: snapshot.camerasTotal, activeSites, dangerCount: snapshot.dangerCount, firstDangerId: snapshot.alerts.find(alert => alert.kind === 'DANGER' && alert.site.active)?.id ?? null }}
        />
    );
}
