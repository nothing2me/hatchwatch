import { currentUserOrNull } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { frameStore } from '@/lib/phones/frameStore';
import { getDevices, postDevice } from '@/lib/phones/http';
import { getRecorder } from '@/lib/phones/recorder';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response>
{
    return postDevice({ prisma, user: await currentUserOrNull(), store: frameStore }, request);
}

export async function GET(): Promise<Response>
{
    return getDevices({ prisma, user: await currentUserOrNull(), store: frameStore, recorder: getRecorder() });
}
