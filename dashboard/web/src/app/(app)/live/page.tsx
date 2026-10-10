import QRCode from 'qrcode';
import { requireCurrentUser } from '@/lib/auth/guard';
import { isNestSite } from '@/lib/danger';
import { connectUrl } from '@/lib/phones/connect';
import { getMapSnapshot } from '@/server/snapshot';
import { LiveScreen } from '@/features/phones/LiveScreen';

export const dynamic = 'force-dynamic';

// Live phone cameras for every signed-in role; admins also get the Connect phone QR and the recordings.
export default async function LivePage()
{
    const [user, snapshot] = await Promise.all([requireCurrentUser(), getMapSnapshot()]);
    const activeSites = snapshot.alerts.filter(alert => isNestSite(alert) && alert.site.active).length;
    const firstDangerId = snapshot.alerts.find(alert => alert.kind === 'DANGER' && alert.site.active)?.id ?? null;
    const bar = { camerasOnline: snapshot.camerasOnline, camerasTotal: snapshot.camerasTotal, activeSites, dangerCount: snapshot.dangerCount, firstDangerId };
    let connect: { url: string | null; qrSvg: string | null } | null = null;
    if (user.role === 'ADMIN')
    {
        const url = connectUrl(process.env.LAN_HOST);
        const qrSvg = url ? await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) : null;
        connect = { url, qrSvg };
    }
    return <LiveScreen user={user} bar={bar} connect={connect} />;
}
