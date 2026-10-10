import { currentUserOrNull } from '@/lib/auth/guard';
import { getMapSnapshot } from '@/server/snapshot';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response>
{
    if (!(await currentUserOrNull()))
    {
        return new Response('Unauthorized', { status: 401 });
    }
    return Response.json(await getMapSnapshot(), { headers: { 'Cache-Control': 'no-store' } });
}
