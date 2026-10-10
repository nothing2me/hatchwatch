import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const currentUserOrNull = vi.fn();
const requireCurrentUser = vi.fn();

vi.mock('@/lib/auth/guard', () =>
{
    const rank: Record<string, number> = { VIEWER: 1, VOLUNTEER: 2, ADMIN: 3 };
    return { currentUserOrNull, requireCurrentUser, hasRole: (user: { role: string } | null, role: string) => user !== null && rank[user.role] >= rank[role] };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// The route and the server actions use the app client; point it at the test database.
vi.mock('@/lib/db', async () =>
{
    const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db');
    return { ...actual, prisma: actual.createPrismaClient(process.env.TEST_DATABASE_URL) };
});

const { prisma } = await import('@/lib/db');
const { seedDatabase } = await import('../../prisma/seed');
const { GET, PUT } = await import('@/app/api/cameras/masks/route');
const { updateCamera: updateCameraAction } = await import('@/app/(app)/camera-actions');
const { loadMapSnapshot } = await import('@/server/snapshot');
const { listCameras } = await import('@/lib/cameras/manage');

let admin: { id: string; email: string; name: string; role: 'ADMIN' };
let masksDir: string;
const previousMasksRoot = process.env.MASKS_ROOT;

const put = (body: unknown) => PUT(new Request('http://x/api/cameras/masks', { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) }));
const researchFile = () => JSON.parse(readFileSync(join(masksDir, 'camera-masks.json'), 'utf8'));
const rect: [number, number][] = [[0.123456, 0.5], [0.9, 0.5], [0.9, 0.95], [0.123456, 0.95]];

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
    currentUserOrNull.mockResolvedValue(admin);
    requireCurrentUser.mockResolvedValue(admin);
    masksDir = mkdtempSync(join(tmpdir(), 'hatchwatch-mask-route-'));
    process.env.MASKS_ROOT = masksDir;
});
afterAll(async () =>
{
    if (previousMasksRoot === undefined)
    {
        delete process.env.MASKS_ROOT;
    }
    else
    {
        process.env.MASKS_ROOT = previousMasksRoot;
    }
    await prisma.$disconnect();
});

describe('PUT /api/cameras/masks', () =>
{
    it('refuses viewers and signed-out users', async () =>
    {
        currentUserOrNull.mockResolvedValue(null);
        expect((await put({ code: 'A1', polygon: null })).status).toBe(401);
        currentUserOrNull.mockResolvedValue({ ...admin, role: 'VIEWER' });
        expect((await put({ code: 'A1', polygon: null })).status).toBe(403);
    });

    it('refuses the old per-slot body, bad polygons and unknown cameras', async () =>
    {
        expect((await put('{nope')).status).toBe(400);
        const old = await put({ camera: 0, polygon: [[0, 0], [1280, 0], [640, 720]] });
        expect(old.status).toBe(400);
        expect(await old.text()).toBe('Masks are per camera now: send { code, polygon } with 0–1 points, or polygon null to clear.');
        const many = await put({ code: 'A1', polygon: Array.from({ length: 65 }, (_, i) => [0.5 + 0.4 * Math.cos(i / 10), 0.5 + 0.4 * Math.sin(i / 10)]) });
        expect(many.status).toBe(400);
        expect(await many.text()).toBe('polygon must be 3–64 points inside 0–1 with a non-zero area, or null.');
        expect((await put({ code: 'Z9', polygon: rect })).status).toBe(404);
    });

    it('saves a rounded mask on the camera, audits it and writes the research file', async () =>
    {
        const response = await put({ code: 'A1', polygon: rect });
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toMatchObject({ ok: true, code: 'A1', researchFile: 'written' });
        const camera = await prisma.camera.findUniqueOrThrow({ where: { code: 'A1' } });
        expect(camera.maskPolygon).toEqual([[0.1235, 0.5], [0.9, 0.5], [0.9, 0.95], [0.1235, 0.95]]);
        expect(camera.maskUpdatedAt).toBeInstanceOf(Date);
        const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'camera.mask' } });
        expect(audit.details).toEqual({ code: 'A1', points: 4 });
        const file = researchFile();
        expect(file.by_code.A1.polygon).toEqual([[158, 360], [1152, 360], [1152, 684], [158, 684]]);
        expect(file.cameras[0].label).toMatch(/^From camera A1/);

        const listed = await (await GET()).json();
        expect(listed.byCode.A1.polygon).toEqual(file.by_code.A1.polygon);
        const snapshot = await loadMapSnapshot(prisma);
        expect(snapshot.cameras.find(camera => camera.code === 'A1')?.mask).toEqual(camera.maskPolygon);
        expect(snapshot.cameras.find(camera => camera.code === 'A2')?.mask).toBeNull();
        expect((await listCameras(prisma)).cameras.find(row => row.code === 'A1')?.mask).toEqual(camera.maskPolygon);
    });

    it('clears the mask with polygon null and falls back to the repository default', async () =>
    {
        await put({ code: 'A1', polygon: rect });
        const response = await put({ code: 'A1', polygon: null });
        expect(response.status).toBe(200);
        expect((await prisma.camera.findUniqueOrThrow({ where: { code: 'A1' } })).maskPolygon).toBeNull();
        const file = researchFile();
        expect(file.by_code).toEqual({});
        expect(file.cameras[0].label).not.toMatch(/^From camera/);
        expect(file.cameras[0].polygon).toEqual([[70, 320], [1210, 320], [1210, 705], [70, 705]]);
    });

    it('moves the research entry when the camera code changes', async () =>
    {
        // A1 is a live slot (its code is locked), so use a camera added to the zone.
        const zone = await prisma.zone.findUniqueOrThrow({ where: { code: 'A' } });
        const a1 = await prisma.camera.findUniqueOrThrow({ where: { code: 'A1' } });
        await prisma.camera.create({ data: { code: 'A3', zoneId: zone.id, lng: a1.lng, lat: a1.lat, headingDeg: a1.headingDeg } });
        await put({ code: 'A3', polygon: rect });
        expect(Object.keys(researchFile().by_code)).toEqual(['A3']);
        expect(await updateCameraAction('A3', { code: 'A9' })).toEqual({ ok: true, code: 'A9' });
        expect(Object.keys(researchFile().by_code)).toEqual(['A9']);
    });
});
