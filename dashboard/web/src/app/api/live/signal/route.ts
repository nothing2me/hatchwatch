import { currentUserOrNull } from '@/lib/auth/guard';
import { liveHub } from '@/lib/live/hub';
import { MAX_SIGNAL_BYTES, signalSchema } from '@/lib/live/protocol';

export const dynamic = 'force-dynamic';

// One signalling message from a device or viewer, relayed by the hub to the other side of the same device.
export async function POST(request: Request): Promise<Response>
{
    const user = await currentUserOrNull();
    if (!user)
    {
        return new Response('Unauthorized', { status: 401 });
    }
    const text = await request.text();
    if (text.length > MAX_SIGNAL_BYTES)
    {
        return new Response('Too large', { status: 413 });
    }
    let json: unknown;
    try
    {
        json = JSON.parse(text);
    }
    catch
    {
        return new Response('Bad request', { status: 400 });
    }
    const parsed = signalSchema.safeParse(json);
    if (!parsed.success)
    {
        return new Response('Bad request', { status: 400 });
    }
    const result = liveHub.relay(user.id, parsed.data);
    return new Response(null, { status: result === 'ok' ? 204 : result === 'forbidden' ? 403 : 404 });
}
