import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@/lib/auth/session';
import { createPrismaClient } from '@/lib/db';
import { FrameStore } from '@/lib/phones/frameStore';
import { getDevices, getFrame, postDevice, postFrame, type FrameRecorder } from '@/lib/phones/http';
import type { LiveDeviceView } from '@/lib/types';
import { seedDatabase } from '../../prisma/seed';

const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
let admin: SessionUser;
let volunteer: SessionUser;
let other: SessionUser;
let viewer: SessionUser;

beforeAll(async () =>
{
    const [{ current_database: name }] = await prisma.$queryRawUnsafe<{ current_database: string }[]>('SELECT current_database()');
    if (!name.endsWith('_test'))
    {
        throw new Error(`Refusing to run against ${name}`);
    }
});
beforeEach(async () =>
{
    await prisma.$executeRawUnsafe('TRUNCATE "LiveDevice","SiteEvent","LiveChunk","AuditLog","AlertStatusChange","AlertNote","Alert","Track","Job","Video","Camera","Zone","User" CASCADE');
    await seedDatabase(prisma, { adminEmail: 'admin@test.local', adminPassword: 'pw-for-tests' });
    const row = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.local' } });
    admin = { id: row.id, email: row.email, name: row.name, role: 'ADMIN' };
    const make = async (email: string, role: 'VOLUNTEER' | 'VIEWER'): Promise<SessionUser> =>
    {
        const user = await prisma.user.create({ data: { email, name: email.split('@')[0], role, passwordHash: 'unused' } });
        return { id: user.id, email, name: user.name, role };
    };
    volunteer = await make('vol@test.local', 'VOLUNTEER');
    other = await make('other@test.local', 'VOLUNTEER');
    viewer = await make('view@test.local', 'VIEWER');
});
afterAll(async () => { await prisma.$disconnect(); });

const T0 = Date.UTC(2026, 9, 10, 20, 0, 0);
const jpeg = (size = 64) => { const body = Buffer.alloc(size, 7); body[0] = 0xff; body[1] = 0xd8; return body; };
const named = (name: unknown) => new Request('https://x/api/live/devices', { method: 'POST', body: JSON.stringify({ name }), headers: { 'content-type': 'application/json' } });
const frame = (body: Uint8Array<ArrayBuffer>) => new Request('https://x/api/live/frame/id', { method: 'POST', body, headers: { 'content-type': 'image/jpeg' } });

async function register(user: SessionUser, name = 'Pixel 7'): Promise<string>
{
    const response = await postDevice({ prisma, user, store: new FrameStore() }, named(name));
    return ((await response.json()) as { id: string }).id;
}

describe('device registration', () =>
{
    it('creates one device per owner and name, then reuses it', async () =>
    {
        const store = new FrameStore();
        const first = await postDevice({ prisma, user: volunteer, store }, named('  Pixel   7 '));
        expect(first.status).toBe(201);
        const { id, name } = await first.json() as { id: string; name: string };
        expect(name).toBe('Pixel 7');
        const again = await postDevice({ prisma, user: volunteer, store }, named('Pixel 7'));
        expect(again.status).toBe(200);
        expect((await again.json() as { id: string }).id).toBe(id);
        expect((await postDevice({ prisma, user: other, store }, named('Pixel 7'))).status).toBe(201);
        expect(await prisma.liveDevice.count()).toBe(2);
    });

    it('refuses signed-out callers, viewers and bad names', async () =>
    {
        const store = new FrameStore();
        expect((await postDevice({ prisma, user: null, store }, named('A'))).status).toBe(401);
        expect((await postDevice({ prisma, user: viewer, store }, named('A'))).status).toBe(403);
        expect((await postDevice({ prisma, user: volunteer, store }, named('   '))).status).toBe(400);
        expect((await postDevice({ prisma, user: volunteer, store }, named('x'.repeat(61)))).status).toBe(400);
        expect((await postDevice({ prisma, user: volunteer, store }, named(42))).status).toBe(400);
        expect(await prisma.liveDevice.count()).toBe(0);
    });

    it('registers a fresh device after an admin removed the old one', async () =>
    {
        const id = await register(volunteer);
        await prisma.liveDevice.update({ where: { id }, data: { disabledAt: new Date() } });
        expect(await register(volunteer)).not.toBe(id);
    });
});

describe('frames', () =>
{
    let now: number;
    const deps = (user: SessionUser | null, store: FrameStore, recorder: FrameRecorder | null = null) => ({ prisma, user, store, recorder, now: () => (now += 200) });
    beforeEach(() => { now = T0; });

    it('lets the owner and an admin send, and refuses everyone else', async () =>
    {
        const id = await register(volunteer);
        const store = new FrameStore();
        expect((await postFrame(deps(volunteer, store), id, frame(jpeg()))).status).toBe(200);
        expect((await postFrame(deps(admin, store), id, frame(jpeg()))).status).toBe(200);
        expect((await postFrame(deps(other, store), id, frame(jpeg()))).status).toBe(403);
        expect((await postFrame(deps(viewer, store), id, frame(jpeg()))).status).toBe(403);
        expect((await postFrame(deps(null, store), id, frame(jpeg()))).status).toBe(401);
        expect((await postFrame(deps(volunteer, store), 'no-such-device', frame(jpeg()))).status).toBe(404);
        await prisma.liveDevice.update({ where: { id }, data: { disabledAt: new Date() } });
        expect((await postFrame(deps(volunteer, store), id, frame(jpeg()))).status).toBe(403);
    });

    it('refuses frames over 500 KB, even streamed without Content-Length, and non-JPEG bodies', async () =>
    {
        const id = await register(volunteer);
        const store = new FrameStore();
        expect((await postFrame(deps(volunteer, store), id, frame(jpeg(500 * 1024)))).status).toBe(200);
        expect((await postFrame(deps(volunteer, store), id, frame(jpeg(500 * 1024 + 1)))).status).toBe(413);
        const streamed = new Request('https://x/f', {
            method: 'POST',
            body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(jpeg(300 * 1024)); controller.enqueue(new Uint8Array(300 * 1024)); controller.close(); } }),
            duplex: 'half',
        } as RequestInit);
        expect(streamed.headers.get('content-length')).toBeNull();
        expect((await postFrame(deps(volunteer, store), id, streamed)).status).toBe(413);
        expect((await postFrame(deps(volunteer, store), id, frame(Buffer.from('hello world')))).status).toBe(415);
    });

    it('answers 429 past 10 frames a second', async () =>
    {
        const id = await register(volunteer);
        const store = new FrameStore();
        const fast = { prisma, user: volunteer, store, now: () => (now += 50) };
        const statuses: number[] = [];
        for (let i = 0; i < 11; i++)
        {
            statuses.push((await postFrame(fast, id, frame(jpeg()))).status);
        }
        expect(statuses).toEqual([...Array(10).fill(200), 429]);
    });

    it('writes lastSeenAt at most once per 5 s and hands frames to the recorder', async () =>
    {
        const id = await register(volunteer);
        const store = new FrameStore();
        const added: { at: number; meta: unknown }[] = [];
        const recorder: FrameRecorder = { addFrame: (_d, _j, at, meta) => added.push({ at, meta }), isRecording: () => true };
        const response = await postFrame(deps(volunteer, store, recorder), id, frame(jpeg()));
        expect(await response.json()).toEqual({ at: T0 + 200, cameraCode: null, recording: true });
        const seen = async () => (await prisma.liveDevice.findUniqueOrThrow({ where: { id } })).lastSeenAt.getTime();
        expect(await seen()).toBe(T0 + 200);
        await postFrame(deps(volunteer, store, recorder), id, frame(jpeg()));
        expect(await seen()).toBe(T0 + 200);
        now = T0 + 5_200 - 200;
        await postFrame(deps(volunteer, store, recorder), id, frame(jpeg()));
        expect(await seen()).toBe(T0 + 5_200);
        expect(added).toHaveLength(3);
        expect(added[0].meta).toEqual({ deviceName: 'Pixel 7', cameraCode: null });
    });

    it('serves the newest frame with an ETag, 304 when unchanged, 404 after 10 s', async () =>
    {
        const id = await register(volunteer);
        const store = new FrameStore();
        await postFrame(deps(volunteer, store), id, frame(jpeg(10)));
        const get = (headers: Record<string, string> = {}, at = T0 + 1_000) => getFrame({ user: viewer, store, now: () => at }, id, new Request('https://x', { headers }));
        const ok = get();
        expect(ok.status).toBe(200);
        expect(ok.headers.get('content-type')).toBe('image/jpeg');
        expect(ok.headers.get('cache-control')).toBe('no-store');
        expect(ok.headers.get('x-frame-at')).toBe(String(T0 + 200));
        expect(Buffer.from(await ok.arrayBuffer())).toEqual(jpeg(10));
        expect(get({ 'if-none-match': ok.headers.get('etag')! }).status).toBe(304);
        expect(get({}, T0 + 200 + 10_001).status).toBe(404);
        expect(getFrame({ user: null, store }, id, new Request('https://x')).status).toBe(401);
    });

    it('lists online phones for everyone and every phone for admins', async () =>
    {
        const online = await register(volunteer, 'Dune');
        const silent = await register(other, 'Pier');
        const store = new FrameStore();
        await postFrame(deps(volunteer, store), online, frame(jpeg()));
        const list = async (user: SessionUser) => ((await (await getDevices({ prisma, user, store, now: () => T0 + 1_000 })).json()) as { devices: LiveDeviceView[] }).devices;
        expect((await list(viewer)).map(d => [d.id, d.online, d.ownerName])).toEqual([[online, true, 'vol']]);
        expect((await list(admin)).map(d => [d.id, d.online])).toEqual([[online, true], [silent, false]]);
        expect((await getDevices({ prisma, user: null, store })).status).toBe(401);
    });
});
