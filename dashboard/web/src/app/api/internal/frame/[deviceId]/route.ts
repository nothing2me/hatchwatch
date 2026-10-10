import { prisma } from '@/lib/db';
import { getInternalFrame } from '@/lib/detections/http';
import { frameStore } from '@/lib/phones/frameStore';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ deviceId: string }> }): Promise<Response>
{
    return getInternalFrame({ prisma, store: frameStore }, (await context.params).deviceId, request);
}
