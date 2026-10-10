import { currentUserOrNull } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { isDeviceOnline } from '@/lib/live/devices';

export const dynamic = 'force-dynamic';

// Which cameras have a live device assigned, and whether that device is online now. Keyed by camera code.
export async function GET(): Promise<Response>
{
    if (!(await currentUserOrNull()))
    {
        return new Response('Unauthorized', { status: 401 });
    }
    const cameras = await prisma.camera.findMany({
        where: { liveDeviceId: { not: null } },
        select: { code: true, liveDevice: { select: { id: true, name: true, lastSeenAt: true } } },
    });
    const now = new Date();
    return Response.json({
        cameras: Object.fromEntries(cameras.flatMap(camera => camera.liveDevice
            ? [[camera.code, { deviceId: camera.liveDevice.id, name: camera.liveDevice.name, online: isDeviceOnline(camera.liveDevice.lastSeenAt, now) }]]
            : [])),
    });
}
