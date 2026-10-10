import { requireCurrentUser } from '@/lib/auth/guard';
import { getMapSnapshot } from '@/server/snapshot';
import { AllCamerasScreen } from '@/features/cameras/AllCamerasScreen';

export const dynamic = 'force-dynamic';

export default async function CamerasPage()
{
    const [user, snapshot] = await Promise.all([requireCurrentUser(), getMapSnapshot()]);
    return <AllCamerasScreen user={user} initialSnapshot={snapshot} />;
}
