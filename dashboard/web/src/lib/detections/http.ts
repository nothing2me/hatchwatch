import type { PrismaClient } from '@/generated/prisma/client';
import { readCapped } from '@/lib/phones/body';
import type { FrameStore } from '@/lib/phones/frameStore';
import { raiseCameraDanger, type CameraDangerResult, type CameraDangerThrottle } from './cameraDanger';
import { MAX_DETECTION_BYTES, parseDetections } from './schema';
import { workerAuthorized } from './workerToken';

export interface InternalDeps
{
    prisma: PrismaClient;
    store: FrameStore;
    /** Defaults to process.env.WORKER_TOKEN; tests pass it explicitly. */
    token?: string;
    now?: () => number;
    /** Defaults to the process-wide per-camera throttle; tests pass their own. */
    dangerThrottle?: CameraDangerThrottle;
}

export const WORKER_REFUSED = 'Worker token not accepted.';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const refused = () => json({ error: WORKER_REFUSED }, 401);

export function getInternalDevices(deps: InternalDeps, request: Request): Response
{
    if (!workerAuthorized(request.headers, deps.token))
    {
        return refused();
    }
    const now = deps.now?.() ?? Date.now();
    return json({ devices: deps.store.onlineIds(now).map(id => ({ id, frameAt: deps.store.lastFrameAt(id) })) });
}

export function getInternalFrame(deps: InternalDeps, deviceId: string, request: Request): Response
{
    if (!workerAuthorized(request.headers, deps.token))
    {
        return refused();
    }
    const frame = deps.store.latest(deviceId, deps.now?.() ?? Date.now());
    if (!frame)
    {
        return json({ error: 'No frame in the last 10 s.' }, 404);
    }
    return new Response(new Uint8Array(frame.jpeg), { status: 200, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'image/jpeg', 'X-Frame-At': String(frame.at), 'Content-Length': String(frame.jpeg.length) } });
}

export async function postInternalDetections(deps: InternalDeps, deviceId: string, request: Request): Promise<Response>
{
    if (!workerAuthorized(request.headers, deps.token))
    {
        return refused();
    }
    const body = await readCapped(request, MAX_DETECTION_BYTES);
    if (body === 'too-large')
    {
        return json({ error: 'Detections larger than 256 KB.' }, 413);
    }
    let value: unknown = null;
    try
    {
        value = JSON.parse(body.toString('utf8'));
    }
    catch
    {
        value = null;
    }
    const detections = parseDetections(value);
    if (!detections)
    {
        return json({ error: 'Detections do not match the expected shape.' }, 400);
    }
    const now = deps.now?.() ?? Date.now();
    const stored = deps.store.putDetections(deviceId, detections, now);
    if (stored === 'offline')
    {
        return json({ error: 'No live frame from that device.' }, 404);
    }
    if (stored === 'stale')
    {
        return json({ error: 'A newer result is already stored.' }, 409);
    }
    let danger: CameraDangerResult = 'none';
    try
    {
        danger = await raiseCameraDanger(deps.prisma, deviceId, detections, new Date(now), deps.dangerThrottle);
    }
    catch (error)
    {
        // The result is stored either way; never log detections or the token.
        console.error('Camera danger check failed:', error instanceof Error ? error.message : 'unknown error');
    }
    return json({ stored: true, danger });
}
