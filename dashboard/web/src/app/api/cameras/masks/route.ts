import { NextResponse } from 'next/server';
import { currentUserOrNull, hasRole } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { liveSettings } from '@/lib/live/watcher';
import { setCameraMask } from '@/lib/cameras/cameraMask';
import { CameraEditError } from '@/lib/cameras/manage';
import { MASK_FRAME, validCameraMask } from '@/lib/cameras/masks';
import { readMasks } from '@/lib/cameras/maskStore';
import { syncResearchMasks } from '@/lib/cameras/researchMasks';

export const dynamic = 'force-dynamic';

// Any signed-in user can inspect the research runner's active masks.
export async function GET(): Promise<Response>
{
    if (!(await currentUserOrNull()))
    {
        return new Response('Unauthorized', { status: 401 });
    }
    const masks = readMasks(liveSettings().root);
    return NextResponse.json({ frame: MASK_FRAME, source: masks.source, cameras: masks.cameras, byCode: masks.byCode });
}

// Admins set or clear one camera's watch area; the research mask file follows.
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
    let body: { code?: unknown; polygon?: unknown };
    try
    {
        body = await request.json() as { code?: unknown; polygon?: unknown };
    }
    catch
    {
        return new Response('Invalid JSON', { status: 400 });
    }
    if (typeof body?.code !== 'string')
    {
        return new Response('Masks are per camera now: send { code, polygon } with 0–1 points, or polygon null to clear.', { status: 400 });
    }
    if (body.polygon !== null && !validCameraMask(body.polygon))
    {
        return new Response('polygon must be 3–64 points inside 0–1 with a non-zero area, or null.', { status: 400 });
    }
    let saved: Awaited<ReturnType<typeof setCameraMask>>;
    try
    {
        saved = await setCameraMask(prisma, user.id, body.code, body.polygon);
    }
    catch (error)
    {
        if (error instanceof CameraEditError)
        {
            return new Response(error.message, { status: 404 });
        }
        throw error;
    }
    // A failed file write never fails the save; the editor warns instead.
    const researchFile = await syncResearchMasks(prisma, liveSettings().root);
    return NextResponse.json({ ok: true, code: saved.code, polygon: saved.mask, researchFile });
}
