import { currentUserOrNull } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

const CAM_PORT = 3443;

// The address phones open to stream: Caddy's HTTPS port on this machine's LAN IP (LAN_HOST).
// When the dashboard itself was opened by LAN address, that host works too.
export async function GET(request: Request): Promise<Response>
{
    if (!(await currentUserOrNull()))
    {
        return new Response('Unauthorized', { status: 401 });
    }
    const requested = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '').split(':')[0];
    const local = requested === '' || requested === 'localhost' || requested === '127.0.0.1' || requested === '[::1]';
    const lanHost = process.env.LAN_HOST && process.env.LAN_HOST !== '127.0.0.1' ? process.env.LAN_HOST : null;
    const host = local ? lanHost : requested;
    return Response.json({ url: host ? `https://${host}:${CAM_PORT}/cam` : null });
}
