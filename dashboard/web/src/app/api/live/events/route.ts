import { currentUserOrNull } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { liveHub, type PeerSink } from '@/lib/live/hub';
import type { HubEvent } from '@/lib/live/protocol';

export const dynamic = 'force-dynamic';

const KEEPALIVE_MS = 15_000;

// Server-sent events carrying WebRTC signalling for one peer: `?role=device` from /cam (owner only),
// `?role=viewer` from a dashboard watching a device that is assigned to a camera.
export async function GET(request: Request): Promise<Response>
{
    const user = await currentUserOrNull();
    if (!user)
    {
        return new Response('Unauthorized', { status: 401 });
    }
    const url = new URL(request.url);
    const role = url.searchParams.get('role');
    const deviceId = url.searchParams.get('device') ?? '';
    if ((role !== 'device' && role !== 'viewer') || !deviceId || deviceId.length > 64)
    {
        return new Response('Bad request', { status: 400 });
    }

    const device = await prisma.liveDevice.findUnique({ where: { id: deviceId }, select: { ownerId: true, camera: { select: { id: true } } } });
    if (!device || (role === 'device' && device.ownerId !== user.id) || (role === 'viewer' && !device.camera))
    {
        return new Response('Not found', { status: 404 });
    }

    const encoder = new TextEncoder();
    let cleanup = () => {};
    const body = new ReadableStream<Uint8Array>({
        start(controller)
        {
            let closed = false;
            let peerId: string | null = null;
            const write = (text: string) =>
            {
                if (!closed)
                {
                    controller.enqueue(encoder.encode(text));
                }
            };
            const keepalive = setInterval(() => write(': keepalive\n\n'), KEEPALIVE_MS);
            // The hub closes the sink when it drops this peer (replaced device, full, device offline).
            const sink: PeerSink = {
                send(event: HubEvent) { write(`data: ${JSON.stringify(event)}\n\n`); },
                close()
                {
                    if (closed)
                    {
                        return;
                    }
                    closed = true;
                    clearInterval(keepalive);
                    try { controller.close(); } catch { /* already closed */ }
                },
            };
            cleanup = () =>
            {
                if (peerId)
                {
                    liveHub.disconnect(peerId);
                    peerId = null;
                }
                sink.close();
            };
            request.signal.addEventListener('abort', cleanup);
            peerId = role === 'device' ? liveHub.connectDevice(deviceId, user.id, sink) : liveHub.connectViewer(deviceId, user.id, sink);
        },
        cancel() { cleanup(); },
    });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}
