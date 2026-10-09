import { requireUser } from '@/lib/auth/guard';
import { getMapSnapshot } from '@/server/snapshot';
import { MapScreen } from '@/features/map/MapScreen';

export const dynamic = 'force-dynamic';

export default async function MapPage()
{
    const [user, snapshot] = await Promise.all([requireUser(), getMapSnapshot()]);
    return <MapScreen snapshot={snapshot} user={user} />;
}
