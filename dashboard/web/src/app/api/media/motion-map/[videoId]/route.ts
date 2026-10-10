import { readFile } from 'node:fs/promises';
import { currentUserOrNull } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { resolveMediaPath } from '@/lib/media';

export const dynamic = 'force-dynamic';

// The authenticated map requests a database-owned public extraction artifact.
export async function GET(_request: Request, context: { params: Promise<{ videoId: string }> }): Promise<Response>
{
    if (!(await currentUserOrNull()))
    {
        return new Response('Unauthorized', { status: 401 });
    }
    const { videoId } = await context.params;
    const video = await prisma.video.findUnique({ where: { id: videoId }, select: { motionMapPath: true, liveChunk: { select: { mediaPruned: true } } } });
    const path = video?.motionMapPath && !video.liveChunk?.mediaPruned ? resolveMediaPath(video.motionMapPath) : null;
    if (!path)
    {
        return new Response('Not found', { status: 404 });
    }
    try
    {
        const png = await readFile(path);
        return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' } });
    }
    catch
    {
        return new Response('Not found', { status: 404 });
    }
}
