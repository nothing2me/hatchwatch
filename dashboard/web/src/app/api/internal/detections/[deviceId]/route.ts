import { prisma } from '@/lib/db';
import { postInternalDetections } from '@/lib/detections/http';
import { frameStore } from '@/lib/phones/frameStore';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ deviceId: string }> }): Promise<Response>
{
    return postInternalDetections({ prisma, store: frameStore }, (await context.params).deviceId, request);
}
