import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import type { SessionUser } from '@/lib/auth/session';
import { parseRange } from '@/lib/range';
import type { Recorder } from './recorder';
import { resolveRecordingPath } from './recordingPaths';

function adminCheck(user: SessionUser | null): Response | null
{
    if (!user)
    {
        return new Response('Unauthorized', { status: 401 });
    }
    return user.role === 'ADMIN' ? null : new Response('Forbidden', { status: 403 });
}

export async function getRecordingList(deps: { user: SessionUser | null; recorder: Pick<Recorder, 'list' | 'hasFfmpeg'> | null }): Promise<Response>
{
    const refused = adminCheck(deps.user);
    if (refused)
    {
        return refused;
    }
    if (!deps.recorder)
    {
        return Response.json({ enabled: false, convertsToMp4: false, recordings: [] }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({ enabled: true, convertsToMp4: deps.recorder.hasFfmpeg, recordings: await deps.recorder.list() }, { headers: { 'Cache-Control': 'no-store' } });
}

// One recording file, with byte ranges so the player can seek. The path must match our layout inside the root.
export async function getRecordingFile(deps: { user: SessionUser | null; root: string }, relativePath: string, request: Request): Promise<Response>
{
    const refused = adminCheck(deps.user);
    if (refused)
    {
        return refused;
    }
    const full = resolveRecordingPath(deps.root, relativePath);
    const info = full ? await stat(full).catch(() => null) : null;
    if (!full || !info?.isFile())
    {
        return new Response('Not found', { status: 404 });
    }
    const size = info.size;
    const headers = new Headers({ 'Content-Type': extname(full) === '.mp4' ? 'video/mp4' : 'video/x-msvideo', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store' });
    if (new URL(request.url).searchParams.get('download') === '1')
    {
        headers.set('Content-Disposition', `attachment; filename="${relativePath.split('/').join('_')}"`);
    }
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
    return new Response(Readable.toWeb(createReadStream(full, { start, end })) as ReadableStream, { status: range ? 206 : 200, headers });
}
