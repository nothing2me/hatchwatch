import type { PrismaClient } from '@/generated/prisma/client';
import type { SessionUser } from '@/lib/auth/session';
import { isJpeg, readCapped } from './body';
import { cleanDeviceName, DEVICE_NAME_MAX, frameAccess, listDevices, registerDevice, touchDevice } from './devices';
import { MAX_FRAME_BYTES, type FrameStore } from './frameStore';

export interface FrameRecorder
{
    addFrame(deviceId: string, jpeg: Buffer, at: number, meta: { deviceName: string; cameraCode: string | null }): void;
    isRecording(deviceId: string): boolean;
}

export interface PhoneDeps
{
    prisma: PrismaClient;
    user: SessionUser | null;
    store: FrameStore;
    recorder?: FrameRecorder | null;
    now?: () => number;
}

export const SIGN_IN_FIRST = 'Sign in first.';
export const CANNOT_SEND = 'Your account can watch but not send.';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

// The caller when they may send; otherwise 401 when signed out, 403 when the role may only watch.
function senderOrRefusal(user: SessionUser | null): SessionUser | Response
{
    if (!user)
    {
        return json({ error: SIGN_IN_FIRST }, 401);
    }
    if (user.role !== 'VOLUNTEER' && user.role !== 'ADMIN')
    {
        return json({ error: CANNOT_SEND }, 403);
    }
    return user;
}

export async function postDevice(deps: PhoneDeps, request: Request): Promise<Response>
{
    const sender = senderOrRefusal(deps.user);
    if (sender instanceof Response)
    {
        return sender;
    }
    const body = await request.json().catch(() => null) as { name?: unknown } | null;
    const name = typeof body?.name === 'string' ? cleanDeviceName(body.name) : null;
    if (!name)
    {
        return json({ error: `Give the phone a name of 1 to ${DEVICE_NAME_MAX} characters.` }, 400);
    }
    const device = await registerDevice(deps.prisma, sender.id, name);
    return json({ id: device.id, name: device.name, cameraCode: device.cameraCode }, device.created ? 201 : 200);
}

export async function getDevices(deps: PhoneDeps): Promise<Response>
{
    if (!deps.user)
    {
        return json({ error: SIGN_IN_FIRST }, 401);
    }
    const devices = await listDevices(deps.prisma, deps.store, {
        all: deps.user.role === 'ADMIN',
        isRecording: id => deps.recorder?.isRecording(id) ?? false,
        now: deps.now?.(),
    });
    return json({ devices });
}

export async function postFrame(deps: PhoneDeps, deviceId: string, request: Request): Promise<Response>
{
    const sender = senderOrRefusal(deps.user);
    if (sender instanceof Response)
    {
        return sender;
    }
    const access = await frameAccess(deps.prisma, deviceId, sender);
    if (!access.ok)
    {
        return json({ error: access.status === 404 ? 'Unknown phone.' : 'This phone cannot send here.' }, access.status);
    }
    const body = await readCapped(request, MAX_FRAME_BYTES);
    if (body === 'too-large')
    {
        return json({ error: 'Frame larger than 500 KB.' }, 413);
    }
    if (!isJpeg(body))
    {
        return json({ error: 'Frames must be JPEG.' }, 415);
    }
    const now = deps.now?.() ?? Date.now();
    const put = deps.store.put(deviceId, body, now);
    if (!put.ok)
    {
        return json({ error: 'More than 10 frames a second.' }, 429);
    }
    if (put.touch)
    {
        await touchDevice(deps.prisma, deviceId, new Date(now));
    }
    deps.recorder?.addFrame(deviceId, body, put.at, { deviceName: access.device.name, cameraCode: access.device.cameraCode });
    return json({ at: put.at, cameraCode: access.device.cameraCode, recording: deps.recorder?.isRecording(deviceId) ?? false });
}

export function getFrame(deps: Pick<PhoneDeps, 'user' | 'store' | 'now'>, deviceId: string, request: Request): Response
{
    if (!deps.user)
    {
        return new Response('Unauthorized', { status: 401 });
    }
    const frame = deps.store.latest(deviceId, deps.now?.() ?? Date.now());
    if (!frame)
    {
        return new Response('No frame in the last 10 s', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    const etag = `"${frame.at}"`;
    const headers = { 'Cache-Control': 'no-store', ETag: etag, 'X-Frame-At': String(frame.at) };
    if (request.headers.get('if-none-match') === etag)
    {
        return new Response(null, { status: 304, headers });
    }
    return new Response(new Uint8Array(frame.jpeg), { status: 200, headers: { ...headers, 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Content-Length': String(frame.jpeg.length) } });
}
