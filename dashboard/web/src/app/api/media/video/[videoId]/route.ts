import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { currentUserOrNull } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { resolveMediaPath } from '@/lib/media';
import { parseRange } from '@/lib/range';

export const dynamic = 'force-dynamic';

// Streams a stored video. The file path always comes from the database row, never the request.
export async function GET(request: Request, context: { params: Promise<{ videoId: string }> }): Promise<Response>
{
    if (!(await currentUserOrNull()))
    {
        return new Response('Unauthorized', { status: 401 });
    }

    const { videoId } = await context.params;
    const variant = new URL(request.url).searchParams.get('variant') === 'motion' ? 'motion' : 'raw';
    const video = await prisma.video.findUnique({ where: { id: videoId }, select: { path: true, pureMotionPath: true } });
    const relativePath = variant === 'motion' ? video?.pureMotionPath : video?.path;
    const fullPath = relativePath ? resolveMediaPath(relativePath) : null;

    let size: number;
    try
    {
        size = fullPath ? statSync(fullPath).size : -1;
    }
    catch
    {
        size = -1;
    }
    if (!fullPath || size < 0)
    {
        return new Response('Not found', { status: 404 });
    }

    const headers = new Headers({ 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' });
    const range = parseRange(request.headers.get('range'), size);

    if (range === 'unsatisfiable')
    {
        headers.set('Content-Range', `bytes */${size}`);
        return new Response(null, { status: 416, headers });
    }

    const { start, end } = range ?? { start: 0, end: size - 1 };
    headers.set('Content-Length', String(end - start + 1));
    if (range)
    {
        headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    const body = Readable.toWeb(createReadStream(fullPath, { start, end })) as ReadableStream;
    return new Response(body, { status: range ? 206 : 200, headers });
}
