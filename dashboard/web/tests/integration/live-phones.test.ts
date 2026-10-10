import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@/lib/auth/session';
import { createPrismaClient } from '@/lib/db';
import { hashDeviceToken, newDeviceToken } from '@/lib/phones/deviceToken';
import { registerDevice } from '@/lib/phones/devices';
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
        expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
        expect(Buffer.from(await ok.arrayBuffer())).toEqual(jpeg(10));
        expect(get({ 'if-none-match': ok.headers.get('etag')! }).status).toBe(304);
        expect(get({}, T0 + 200 + 10_001).status).toBe(404);
        expect(getFrame({ user: null, store }, id, new Request('https://x')).status).toBe(401);
    });

    it('returns the newest detections for online devices only', async () =>
    {
        const id = await register(volunteer);
        const store = new FrameStore();
        store.put(id, jpeg(), T0);
        const list = async () => ((await (await getDevices({ prisma, user: viewer, store, now: () => T0 + 500 })).json()) as { devices: LiveDeviceView[] }).devices;
        expect((await list())[0].detections).toBeNull();
        const result = { at: T0, dark: false, width: 320, height: 240, objects: [{ track: 'P1', label: 'person' as const, score: 0.82, box: [1, 2, 3, 4] as [number, number, number, number] }], trails: [] };
        store.putDetections(id, result, T0 + 200);
        expect((await list())[0].detections).toEqual(result);
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

describe('board frames', () =>
{
    let now: number;
    beforeEach(() => { now = T0; });
    const deps = (user: SessionUser | null, store: FrameStore, recorder: FrameRecorder | null = null) => ({ prisma, user, store, recorder, now: () => (now += 200) });
    const boardFrame = (token: string | null, motion?: string, body: Uint8Array<ArrayBuffer> = jpeg(), header = 'x-nesttrace-motion') =>
    {
        const headers: Record<string, string> = { 'content-type': 'image/jpeg' };
        if (token !== null) headers.authorization = `Bearer ${token}`;
        if (motion !== undefined) headers[header] = motion;
        return new Request('https://x/api/live/frame/id', { method: 'POST', body, headers });
    };
    async function board(name = 'Dune board'): Promise<{ id: string; token: string }>
    {
        const { token, hash } = newDeviceToken();
        const row = await prisma.liveDevice.create({ data: { ownerId: admin.id, name, kind: 'BOARD', tokenHash: hash } });
        return { id: row.id, token };
    }

    it('accepts a board with its own token and no session, and records it like a phone', async () =>
    {
        const { id, token } = await board();
        const store = new FrameStore();
        const added: unknown[] = [];
        const recorder: FrameRecorder = { addFrame: (_d, _j, _at, meta) => added.push(meta), isRecording: () => true };
        const response = await postFrame(deps(null, store, recorder), id, boardFrame(token));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ at: T0 + 200, cameraCode: null, recording: true });
        expect(store.latest(id, T0 + 200)?.jpeg).toEqual(jpeg());
        expect(added).toEqual([{ deviceName: 'Dune board', cameraCode: null }]);
        // A session does not change the outcome when a bearer token is present.
        expect((await postFrame(deps(viewer, store), id, boardFrame(token))).status).toBe(200);
    });

    it('answers 401 for every token that is not this board\'s own', async () =>
    {
        const first = await board('One');
        const second = await board('Two');
        const phone = await register(volunteer);
        const store = new FrameStore();
        const status = async (id: string, token: string | null, user: SessionUser | null = null) => (await postFrame(deps(user, store), id, boardFrame(token))).status;
        expect(await status(first.id, second.token)).toBe(401);
        expect(await status(first.id, newDeviceToken().token)).toBe(401);
        expect(await status(first.id, 'not-a-token')).toBe(401);
        expect(await status(first.id, hashDeviceToken(first.token))).toBe(401);
        expect(await status(phone, first.token)).toBe(401);
        expect(await status('no-such-device', first.token)).toBe(401);
        expect(await status(first.id, null)).toBe(401);
        expect(await status(first.id, null, admin)).toBe(401);
        expect(await status(first.id, null, volunteer)).toBe(401);
        expect(await status(first.id, null, viewer)).toBe(401);
        await prisma.liveDevice.update({ where: { id: first.id }, data: { disabledAt: new Date() } });
        expect(await status(first.id, first.token)).toBe(401);
        expect(store.latest(first.id, now)).toBeNull();
        expect(await status(second.id, second.token)).toBe(200);
    });

    it('keeps the phone rules: 413, 415 and 429 apply to boards too', async () =>
    {
        const { id, token } = await board();
        const store = new FrameStore();
        expect((await postFrame(deps(null, store), id, boardFrame(token, undefined, jpeg(500 * 1024 + 1)))).status).toBe(413);
        expect((await postFrame(deps(null, store), id, boardFrame(token, undefined, Buffer.from('hello world')))).status).toBe(415);
        const fast = { prisma, user: null, store, now: () => (now += 50) };
        const statuses: number[] = [];
        for (let i = 0; i < 11; i++) statuses.push((await postFrame(fast, id, boardFrame(token))).status);
        expect(statuses).toEqual([...Array(10).fill(200), 429]);
    });

    it('stores the motion reading from the HatchWatch header and from the header boards flashed before the rename send', async () =>
    {
        const { id, token } = await board();
        const store = new FrameStore();
        expect((await postFrame(deps(null, store), id, boardFrame(token, 'v1;percent=4.2;active=1;box=96,40,64,72', jpeg(), 'x-nesttrace-motion'))).status).toBe(200);
        expect(store.motion(id, now)).toMatchObject({ percent: 4.2, active: true, box: [96, 40, 64, 72] });
        expect((await postFrame(deps(null, store), id, boardFrame(token, 'v1;percent=1.5;active=0;box=1,2,3,4', jpeg(), 'x-hatchwatch-motion'))).status).toBe(200);
        expect(store.motion(id, now)).toMatchObject({ percent: 1.5, active: false, box: [1, 2, 3, 4] });
    });

    it('stores the motion header for boards, ignores bad ones, and lists it without the token', async () =>
    {
        const { id, token } = await board();
        const phone = await register(volunteer);
        const store = new FrameStore();
        await postFrame(deps(null, store), id, boardFrame(token, 'v1;percent=4.2;active=1;box=96,40,64,72'));
        await postFrame(deps(volunteer, store), phone, new Request('https://x', { method: 'POST', body: jpeg(), headers: { 'content-type': 'image/jpeg', 'x-nesttrace-motion': 'v1;percent=9.9;active=1;box=1,1,1,1' } }));
        const response = await getDevices({ prisma, user: viewer, store, now: () => T0 + 1_000 });
        const text = await response.clone().text();
        expect(text).not.toContain(token);
        expect(text).not.toContain(hashDeviceToken(token));
        expect(text).not.toContain('tokenHash');
        const { devices } = await response.json() as { devices: LiveDeviceView[] };
        const byKind = Object.fromEntries(devices.map(d => [d.kind, d]));
        expect(byKind.BOARD.motion).toEqual({ percent: 4.2, active: true, box: [96, 40, 64, 72], at: new Date(T0 + 200).toISOString() });
        expect(byKind.PHONE.motion).toBeNull();

        expect((await postFrame(deps(null, store), id, boardFrame(token, 'v2;percent=4.2;active=1;box=1,2,3,4'))).status).toBe(200);
        expect(store.motion(id, now)).toBeNull();
        expect((await postFrame(deps(null, store), id, boardFrame(token, 'garbage'))).status).toBe(200);
        expect(store.motion(id, now)).toBeNull();
    });

    it('never reuses a board when a phone registers under the same owner and name', async () =>
    {
        const { id } = await board('Pier');
        const phone = await registerDevice(prisma, admin.id, 'Pier');
        expect(phone.id).not.toBe(id);
        expect(phone.created).toBe(true);
    });

    it('enforces in the database that only boards have a token hash', async () =>
    {
        await expect(prisma.liveDevice.create({ data: { ownerId: volunteer.id, name: 'x', tokenHash: 'a'.repeat(64) } })).rejects.toThrow();
        await expect(prisma.liveDevice.create({ data: { ownerId: admin.id, name: 'y', kind: 'BOARD' } })).rejects.toThrow();
        const { hash } = newDeviceToken();
        await prisma.liveDevice.create({ data: { ownerId: admin.id, name: 'z', kind: 'BOARD', tokenHash: hash } });
        await expect(prisma.liveDevice.create({ data: { ownerId: admin.id, name: 'w', kind: 'BOARD', tokenHash: hash } })).rejects.toThrow();
    });
});
