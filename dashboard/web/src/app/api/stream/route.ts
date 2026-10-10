import { currentUserOrNull } from '@/lib/auth/guard';
import { onChange } from '@/lib/changes';

export const dynamic = 'force-dynamic';

const COALESCE_MS = 500;
const KEEPALIVE_MS = 15_000;

// Server-sent events: a "snapshot" ping whenever anything changed; clients refetch /api/snapshot.
export async function GET(request: Request): Promise<Response>
{
    if (!(await currentUserOrNull()))
    {
        return new Response('Unauthorized', { status: 401 });
    }
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const body = new ReadableStream<Uint8Array>({
        start(controller)
        {
            let pending: ReturnType<typeof setTimeout> | null = null;
            let closed = false;
            const send = (text: string) =>
            {
                if (!closed)
                {
                    controller.enqueue(encoder.encode(text));
                }
            };
            const off = onChange(() =>
            {
                if (pending)
                {
                    return;
                }
                pending = setTimeout(() =>
                {
                    pending = null;
                    send('data: {"type":"snapshot"}\n\n');
                }, COALESCE_MS);
            });
            const keepalive = setInterval(() => send(': keepalive\n\n'), KEEPALIVE_MS);
            cleanup = () =>
            {
                if (closed)
                {
                    return;
                }
                closed = true;
                off();
                clearInterval(keepalive);
                if (pending)
                {
                    clearTimeout(pending);
                }
                try { controller.close(); } catch { /* already closed */ }
            };
            request.signal.addEventListener('abort', cleanup);
            send(': connected\n\n');
        },
        cancel() { cleanup(); },
    });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}
