import { currentUserOrNull } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { touchDevice } from '@/lib/live/devices';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, context: { params: Promise<{ deviceId: string }> }): Promise<Response>
{
    const user = await currentUserOrNull();
    if (!user)
    {
        return new Response('Unauthorized', { status: 401 });
    }
    const { deviceId } = await context.params;
    return (await touchDevice(prisma, deviceId, user.id)) ? new Response(null, { status: 204 }) : new Response('Not found', { status: 404 });
}
