import QRCode from 'qrcode';
import { requireCurrentUser } from '@/lib/auth/guard';
import { connectUrl } from '@/lib/phones/connect';
import { getMapSnapshot } from '@/server/snapshot';
import { AllCamerasScreen } from '@/features/cameras/AllCamerasScreen';

export const dynamic = 'force-dynamic';

// Map cameras with their live phone or board, plus the devices, for every signed-in role; admins also get the Connect phone QR and the recordings.
export default async function CamerasPage()
{
    const [user, snapshot] = await Promise.all([requireCurrentUser(), getMapSnapshot()]);
    let connect: { url: string | null; qrSvg: string | null } | null = null;
    if (user.role === 'ADMIN')
    {
        const url = connectUrl(process.env.LAN_HOST);
        const qrSvg = url ? await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) : null;
        connect = { url, qrSvg };
    }
    return <AllCamerasScreen user={user} initialSnapshot={snapshot} connect={connect} />;
}
