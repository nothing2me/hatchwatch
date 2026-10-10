import { currentUserOrNull } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ code: string }> }): Promise<Response>
{
    if (!(await currentUserOrNull())) return new Response('Unauthorized', { status: 401 });
    const { code } = await context.params;
    if (!/^[A-Z]{1,3}$/.test(code)) return new Response('Invalid zone', { status: 400 });
    const recordings = await prisma.video.findMany({
        where: {
            camera: { zone: { code } },
            AND: [
                { OR: [{ source: 'SIMULATION' }, { jobs: { some: { status: 'DONE' } } }] },
                { OR: [{ liveChunkId: null }, { liveChunk: { mediaPruned: false } }] },
            ],
        },
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: { id: true, source: true, durationS: true, pureMotionPath: true, simRunId: true, createdAt: true,
            liveChunk: { select: { startedAt: true } }, camera: { select: { id: true, code: true } } },
    });
    return Response.json(recordings.map(row => ({
        cameraId: row.camera.id,
        cameraCode: row.camera.code,
        recordedAt: (row.liveChunk?.startedAt ?? row.createdAt).toISOString(),
        video: { id: row.id, source: row.source, durationS: row.durationS, hasMotion: row.pureMotionPath !== null, simRunId: row.simRunId },
    })), { headers: { 'Cache-Control': 'no-store' } });
}
