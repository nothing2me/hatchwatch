import { currentUserOrNull } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { frameStore } from '@/lib/phones/frameStore';
import { getFrame, postFrame } from '@/lib/phones/http';
import { getRecorder } from '@/lib/phones/recorder';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ deviceId: string }> };

export async function POST(request: Request, context: Context): Promise<Response>
{
    return postFrame({ prisma, user: await currentUserOrNull(), store: frameStore, recorder: getRecorder() }, (await context.params).deviceId, request);
}

export async function GET(request: Request, context: Context): Promise<Response>
{
    return getFrame({ user: await currentUserOrNull(), store: frameStore }, (await context.params).deviceId, request);
}
