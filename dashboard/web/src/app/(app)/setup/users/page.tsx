import { requireCurrentUser } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { getMapSnapshot } from '@/server/snapshot';
import { listUsers } from '@/lib/users/manage';
import { UsersScreen } from '@/features/users/UsersScreen';

export const dynamic = 'force-dynamic';

export default async function UsersPage()
{
    const user = await requireCurrentUser('ADMIN');
    const [snapshot, users] = await Promise.all([getMapSnapshot(), listUsers(prisma)]);
    const activeSites = snapshot.alerts.filter(alert => alert.site.active).length;
    return (
        <UsersScreen
            user={user}
            users={users.map(u => ({ ...u, disabledAt: u.disabledAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString() }))}
            bar={{ camerasOnline: snapshot.camerasOnline, camerasTotal: snapshot.camerasTotal, activeSites }}
        />
    );
}
