import { prisma } from '@/lib/db';
import { getInternalDevices } from '@/lib/detections/http';
import { frameStore } from '@/lib/phones/frameStore';

export const dynamic = 'force-dynamic';

export function GET(request: Request): Response
{
    return getInternalDevices({ prisma, store: frameStore }, request);
}
