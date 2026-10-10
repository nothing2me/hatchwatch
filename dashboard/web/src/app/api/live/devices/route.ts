import { z } from 'zod';
import { currentUserOrNull } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { listDevices, registerDevice } from '@/lib/live/devices';

export const dynamic = 'force-dynamic';

const body = z.object({ name: z.string().max(200) });

// Any signed-in user can register the browser they are on as a camera device.
export async function POST(request: Request): Promise<Response>
{
    const user = await currentUserOrNull();
    if (!user)
    {
        return new Response('Unauthorized', { status: 401 });
    }
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
    {
        return Response.json({ error: 'Invalid device name' }, { status: 400 });
    }
    return Response.json(await registerDevice(prisma, user.id, parsed.data.name), { status: 201 });
}

export async function GET(): Promise<Response>
{
    if (!(await currentUserOrNull()))
    {
        return new Response('Unauthorized', { status: 401 });
    }
    return Response.json({ devices: await listDevices(prisma) });
}
