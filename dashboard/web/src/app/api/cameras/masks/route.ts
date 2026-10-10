import { NextResponse } from 'next/server';
import { currentUserOrNull, hasRole } from '@/lib/auth/guard';
import { liveSettings } from '@/lib/live/watcher';
import { MASK_FRAME, clampPolygon, validMaskPoints } from '@/lib/cameras/masks';
import { readMasks, writeMask } from '@/lib/cameras/maskStore';

export const dynamic = 'force-dynamic';

// Any signed-in user can inspect the active masks.
export async function GET(): Promise<Response>
{
    if (!(await currentUserOrNull()))
    {
        return new Response('Unauthorized', { status: 401 });
    }
    const masks = readMasks(liveSettings().root);
    return NextResponse.json({ frame: MASK_FRAME, source: masks.source, cameras: masks.cameras });
}

// Admins edit one camera's mask; saved to the shared public file the runner reads.
export async function PUT(request: Request): Promise<Response>
{
    const user = await currentUserOrNull();
    if (!user)
    {
        return new Response('Unauthorized', { status: 401 });
    }
    if (!hasRole(user, 'ADMIN'))
    {
        return new Response('Forbidden', { status: 403 });
    }
    let body: { camera?: unknown; polygon?: unknown };
    try
    {
        body = await request.json() as { camera?: unknown; polygon?: unknown };
    }
    catch
    {
        return new Response('Invalid JSON', { status: 400 });
    }
    if (typeof body.camera !== 'number' || !Number.isInteger(body.camera) || body.camera < 0)
    {
        return new Response('camera must be a non-negative integer', { status: 400 });
    }
    if (!Array.isArray(body.polygon) || !validMaskPoints(body.polygon))
    {
        return new Response(`polygon must be 3-32 in-frame points, e.g. [[x,y],...]`, { status: 400 });
    }
    try
    {
        const result = writeMask(liveSettings().root, body.camera, clampPolygon(body.polygon as [number, number][]));
        return NextResponse.json({ ok: true, cameras: result.cameras });
    }
    catch (error)
    {
        // Usually a read-only or missing masks folder (see MASKS_ROOT in docker-compose.yml).
        console.error('[masks] could not save:', (error as Error).message);
        return NextResponse.json({ ok: false, error: `Could not save the mask: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}. Check that MASKS_ROOT is writable.` }, { status: 500 });
    }
}