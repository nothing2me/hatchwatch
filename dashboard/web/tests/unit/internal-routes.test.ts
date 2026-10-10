import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';

vi.mock('node:crypto', async importOriginal =>
{
    const real = await importOriginal<typeof import('node:crypto')>();
    return { ...real, timingSafeEqual: vi.fn(real.timingSafeEqual) };
});
const crypto = await import('node:crypto');
const { FrameStore } = await import('@/lib/phones/frameStore');
const { getInternalDevices, getInternalFrame, postInternalDetections, WORKER_REFUSED } = await import('@/lib/detections/http');
const { workerAuthorized } = await import('@/lib/detections/workerToken');

const TOKEN = 'a'.repeat(64);
const T0 = Date.UTC(2026, 9, 10, 20, 0, 0);
const prisma = {} as PrismaClient;
const jpeg = (fill = 7) => { const body = Buffer.alloc(64, fill); body[0] = 0xff; body[1] = 0xd8; return body; };
// null = no Authorization header at all.
const auth = (value: string | null): Record<string, string> => (value === null ? {} : { authorization: value });
const get = (path: string, value: string | null) => new Request(`http://web:3000${path}`, { headers: auth(value) });
const post = (id: string, body: unknown, value: string | null = `Bearer ${TOKEN}`) =>
    new Request(`http://web:3000/api/internal/detections/${id}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', ...auth(value) } });
const empty = (at: number) => ({ at, dark: false, width: 320, height: 240, objects: [], trails: [] });

function setup(token: string = TOKEN)
{
    const store = new FrameStore();
    store.put('d1', jpeg(), T0);
    return { store, deps: { prisma, store, token, now: () => T0 + 100 } };
}

describe('worker token', () =>
{
    it('accepts only the exact bearer token, always through timingSafeEqual', () =>
    {
        const compare = vi.mocked(crypto.timingSafeEqual);
        compare.mockClear();
        expect(workerAuthorized(new Headers(auth(`Bearer ${TOKEN}`)), TOKEN)).toBe(true);
        expect(workerAuthorized(new Headers(auth(`Bearer ${TOKEN}x`)), TOKEN)).toBe(false);
        expect(workerAuthorized(new Headers(auth(`Basic ${TOKEN}`)), TOKEN)).toBe(false);
        expect(workerAuthorized(new Headers(auth(null)), TOKEN)).toBe(false);
        expect(workerAuthorized(new Headers(auth('Bearer x')), '')).toBe(false);
        expect(workerAuthorized(new Headers(auth('Bearer x')), '   ')).toBe(false);
        expect(workerAuthorized(new Headers(auth(null)), '')).toBe(false);
        expect(workerAuthorized(new Headers(auth(`Bearer ${TOKEN}`)), undefined)).toBe(false);
        expect(compare).toHaveBeenCalledTimes(8);
    });

    it('falls back to process.env.WORKER_TOKEN and refuses when it is unset', () =>
    {
        vi.stubEnv('WORKER_TOKEN', '');
        expect(workerAuthorized(new Headers(auth('Bearer ')))).toBe(false);
        vi.stubEnv('WORKER_TOKEN', TOKEN);
        expect(workerAuthorized(new Headers(auth(`Bearer ${TOKEN}`)))).toBe(true);
        vi.unstubAllEnvs();
    });

    it('refuses every internal route without the right token, and when the token is unset', async () =>
    {
        for (const [token, header] of [[TOKEN, null], [TOKEN, 'Bearer wrong'], [TOKEN, `Basic ${TOKEN}`], ['', 'Bearer '], ['', null], ['   ', `Bearer ${TOKEN}`]] as const)
        {
            const { deps } = setup(token);
            expect(getInternalDevices(deps, get('/api/internal/devices', header)).status).toBe(401);
            expect(getInternalFrame(deps, 'd1', get('/api/internal/frame/d1', header)).status).toBe(401);
            const refused = await postInternalDetections(deps, 'd1', post('d1', empty(T0), header));
            expect(refused.status).toBe(401);
            expect(await refused.json()).toEqual({ error: WORKER_REFUSED });
        }
    });
});

describe('internal routes', () =>
{
    it('lists online devices with their newest frame time', () =>
    {
        const { deps, store } = setup();
        store.put('old', jpeg(), T0 - 20_000);
        return getInternalDevices(deps, get('/api/internal/devices', `Bearer ${TOKEN}`)).json().then(body =>
            expect(body).toEqual({ devices: [{ id: 'd1', frameAt: T0 }] }));
    });

    it('serves the newest frame with its time, 404 when there is none', async () =>
    {
        const { deps } = setup();
        const response = getInternalFrame(deps, 'd1', get('/api/internal/frame/d1', `Bearer ${TOKEN}`));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/jpeg');
        expect(response.headers.get('x-frame-at')).toBe(String(T0));
        expect(Buffer.from(await response.arrayBuffer())).toEqual(jpeg());
        expect(getInternalFrame(deps, 'nope', get('/api/internal/frame/nope', `Bearer ${TOKEN}`)).status).toBe(404);
    });

    it('stores valid results; 400 bad shape, 413 too large, 404 offline, 409 stale', async () =>
    {
        const { deps, store } = setup();
        const stored = await postInternalDetections(deps, 'd1', post('d1', empty(T0)));
        expect(stored.status).toBe(200);
        expect(await stored.json()).toEqual({ stored: true, danger: 'none' });
        expect(store.detections('d1', T0 + 100)).toEqual(empty(T0));
        expect((await postInternalDetections(deps, 'd1', post('d1', empty(T0)))).status).toBe(409);
        expect((await postInternalDetections(deps, 'd1', post('d1', empty(T0 - 1)))).status).toBe(409);
        expect((await postInternalDetections(deps, 'd1', post('d1', { ...empty(T0 + 1), extra: true }))).status).toBe(400);
        expect((await postInternalDetections(deps, 'd1', post('d1', '{not json'))).status).toBe(400);
        expect((await postInternalDetections(deps, 'd1', post('d1', 'x'.repeat(256 * 1024 + 1)))).status).toBe(413);
        expect((await postInternalDetections(deps, 'gone', post('gone', empty(T0)))).status).toBe(404);
    });
});
