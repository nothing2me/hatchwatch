import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const currentUserOrNull = vi.fn();
vi.mock('@/lib/auth/guard', () => ({ currentUserOrNull }));
const { GET } = await import('@/app/api/live/cam-url/route');

const ask = async (host: string, forwarded?: string) =>
{
    const headers: Record<string, string> = { host };
    if (forwarded)
    {
        headers['x-forwarded-host'] = forwarded;
    }
    const response = await GET(new Request(`http://${host}/api/live/cam-url`, { headers }));
    return { status: response.status, body: response.status === 200 ? await response.json() : null };
};

beforeEach(() =>
{
    currentUserOrNull.mockResolvedValue({ id: 'u1', email: 'a@b.cd', name: 'A', role: 'ADMIN' });
    vi.stubEnv('LAN_HOST', '192.168.12.184');
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('GET /api/live/cam-url', () =>
{
    it('401 without a user', async () =>
    {
        currentUserOrNull.mockResolvedValue(null);
        expect((await ask('localhost:3000')).status).toBe(401);
    });

    it('uses LAN_HOST when the dashboard is open on this machine', async () =>
    {
        expect((await ask('localhost:3000')).body).toEqual({ url: 'https://192.168.12.184:3443/cam' });
        expect((await ask('127.0.0.1:3000')).body).toEqual({ url: 'https://192.168.12.184:3443/cam' });
    });

    it('reuses the address the dashboard was opened by over the LAN', async () =>
    {
        expect((await ask('web:3000', '10.57.209.25:3443')).body).toEqual({ url: 'https://10.57.209.25:3443/cam' });
    });

    it('has no link when LAN_HOST is missing or loopback', async () =>
    {
        vi.stubEnv('LAN_HOST', '127.0.0.1');
        expect((await ask('localhost:3000')).body).toEqual({ url: null });
        vi.stubEnv('LAN_HOST', '');
        expect((await ask('localhost:3000')).body).toEqual({ url: null });
    });
});
