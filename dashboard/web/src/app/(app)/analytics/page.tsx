import { requireCurrentUser } from '@/lib/auth/guard';
import { getMapSnapshot } from '@/server/snapshot';
import { AnalyticsScreen } from '@/features/analytics/AnalyticsScreen';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage()
{
    const [user, snapshot] = await Promise.all([requireCurrentUser(), getMapSnapshot()]);
    return <AnalyticsScreen snapshot={snapshot} user={user} />;
}
