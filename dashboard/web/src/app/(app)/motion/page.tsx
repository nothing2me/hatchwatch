import { requireCurrentUser } from '@/lib/auth/guard';
import { getMapSnapshot } from '@/server/snapshot';
import { MotionScreen } from '@/features/live/MotionScreen';

export const dynamic = 'force-dynamic';

export default async function MotionPage({ searchParams }: { searchParams: Promise<{ camera?: string | string[] }> })
{
    const [user, snapshot, params] = await Promise.all([requireCurrentUser(), getMapSnapshot(), searchParams]);
    const requested = typeof params.camera === 'string' ? params.camera : null;
    const initialCamera = requested && snapshot.cameras.some(camera => camera.code === requested) ? requested : null;
    return <MotionScreen user={user} initialSnapshot={snapshot} initialCamera={initialCamera} />;
}
