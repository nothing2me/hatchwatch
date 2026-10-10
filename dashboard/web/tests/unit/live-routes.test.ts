import { beforeEach, describe, expect, it, vi } from 'vitest';

const currentUserOrNull = vi.fn();
const registerDevice = vi.fn();
const touchDevice = vi.fn();
const listDevices = vi.fn(async () => [] as unknown[]);
const findManyCameras = vi.fn(async () => [] as unknown[]);

vi.mock('@/lib/auth/guard', () => ({ currentUserOrNull }));
vi.mock('@/lib/live/devices', () => ({ registerDevice, touchDevice, listDevices, isDeviceOnline: (lastSeenAt: Date) => Date.now() - lastSeenAt.getTime() <= 15_000 }));
vi.mock('@/lib/db', () => ({ prisma: { camera: { findMany: findManyCameras } } }));

const devices = await import('@/app/api/live/devices/route');
const heartbeat = await import('@/app/api/live/devices/[deviceId]/heartbeat/route');
const status = await import('@/app/api/live/status/route');

const user = { id: 'u1', email: 'u@x.y', name: 'Una', role: 'VIEWER' };
const register = (body: string) => devices.POST(new Request('http://x/api/live/devices', { method: 'POST', body, headers: { 'content-type': 'application/json' } }));
const beat = () => heartbeat.POST(new Request('http://x/api/live/devices/d1/heartbeat', { method: 'POST' }), { params: Promise.resolve({ deviceId: 'd1' }) });

beforeEach(() =>
{
    vi.clearAllMocks();
    currentUserOrNull.mockResolvedValue(user);
    registerDevice.mockResolvedValue({ id: 'd1', name: 'Pixel' });
    touchDevice.mockResolvedValue(true);
});

describe('live device routes', () =>
{
    it('401 everywhere without a user', async () =>
    {
        currentUserOrNull.mockResolvedValue(null);
        expect((await register('{"name":"Pixel"}')).status).toBe(401);
        expect((await devices.GET()).status).toBe(401);
        expect((await beat()).status).toBe(401);
        expect((await status.GET()).status).toBe(401);
        expect(registerDevice).not.toHaveBeenCalled();
    });

    it('registers the device for the signed-in user, 400 on bad bodies', async () =>
    {
        const response = await register('{"name":"Pixel"}');
        expect(response.status).toBe(201);
        expect(await response.json()).toEqual({ id: 'd1', name: 'Pixel' });
        expect(registerDevice).toHaveBeenCalledWith(expect.anything(), 'u1', 'Pixel');
        expect((await register('not json')).status).toBe(400);
        expect((await register('{"name":42}')).status).toBe(400);
    });

    it('heartbeat is 204 for the owner, 404 otherwise', async () =>
    {
        expect((await beat()).status).toBe(204);
        expect(touchDevice).toHaveBeenCalledWith(expect.anything(), 'd1', 'u1');
        touchDevice.mockResolvedValue(false);
        expect((await beat()).status).toBe(404);
    });

    it('status maps cameras to their device and online state', async () =>
    {
        findManyCameras.mockResolvedValue([
            { code: 'B1', liveDevice: { id: 'd1', name: 'Pixel', lastSeenAt: new Date() } },
            { code: 'C2', liveDevice: { id: 'd2', name: 'Old', lastSeenAt: new Date(Date.now() - 60_000) } },
        ]);
        expect(await (await status.GET()).json()).toEqual({ cameras: {
            B1: { deviceId: 'd1', name: 'Pixel', online: true },
            C2: { deviceId: 'd2', name: 'Old', online: false },
        } });
    });
});
