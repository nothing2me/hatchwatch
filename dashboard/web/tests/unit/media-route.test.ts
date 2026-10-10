import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const currentUserOrNull = vi.fn();
const findUnique = vi.fn();
vi.mock('@/lib/auth/guard', () => ({ currentUserOrNull }));
vi.mock('@/lib/db', () => ({ prisma: { video: { findUnique } } }));

const { GET } = await import('@/app/api/media/video/[videoId]/route');

let root: string;
const originalMediaRoot = process.env.MEDIA_ROOT;
const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));

beforeAll(() =>
{
    root = mkdtempSync(join(tmpdir(), 'nt-media-'));
    mkdirSync(join(root, 'sim/R'), { recursive: true });
    writeFileSync(join(root, 'sim/R/camera-0.mp4'), bytes);
    writeFileSync(join(root, 'sim/R/motion-0.mp4'), bytes.subarray(0, 10));
    process.env.MEDIA_ROOT = root;
});
afterAll(() =>
{
    rmSync(root, { recursive: true, force: true });
    if (originalMediaRoot === undefined)
    {
        delete process.env.MEDIA_ROOT;
    }
    else
    {
        process.env.MEDIA_ROOT = originalMediaRoot;
    }
});
beforeEach(() =>
{
    currentUserOrNull.mockResolvedValue({ id: 'u', email: 'a@b.cd', name: 'A', role: 'VIEWER' });
    findUnique.mockResolvedValue({ path: 'sim/R/camera-0.mp4', pureMotionPath: 'sim/R/motion-0.mp4' });
});

const call = (query = '', headers: Record<string, string> = {}) =>
    GET(new Request(`http://x/api/media/video/v1${query}`, { headers }), { params: Promise.resolve({ videoId: 'v1' }) });

describe('GET /api/media/video/:id', () =>
{
    it('401 without a session', async () =>
    {
        currentUserOrNull.mockResolvedValue(null);
        expect((await call()).status).toBe(401);
    });

    it('404 for unknown video or escaping path', async () =>
    {
        findUnique.mockResolvedValueOnce(null);
        expect((await call()).status).toBe(404);
        findUnique.mockResolvedValueOnce({ path: '../outside.mp4', pureMotionPath: null });
        expect((await call()).status).toBe(404);
    });

    it('200 full body with accept-ranges', async () =>
    {
        const response = await call();
        expect(response.status).toBe(200);
        expect(response.headers.get('accept-ranges')).toBe('bytes');
        expect(response.headers.get('content-type')).toBe('video/mp4');
        expect(Buffer.from(await response.arrayBuffer()).length).toBe(1000);
    });

    it('206 partial content', async () =>
    {
        const response = await call('', { range: 'bytes=100-199' });
        expect(response.status).toBe(206);
        expect(response.headers.get('content-range')).toBe('bytes 100-199/1000');
        expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes.subarray(100, 200));
    });

    it('416 when unsatisfiable', async () =>
    {
        const response = await call('', { range: 'bytes=5000-' });
        expect(response.status).toBe(416);
        expect(response.headers.get('content-range')).toBe('bytes */1000');
    });

    it('serves the motion variant, 404 if absent', async () =>
    {
        expect(Buffer.from(await (await call('?variant=motion')).arrayBuffer()).length).toBe(10);
        findUnique.mockResolvedValueOnce({ path: 'sim/R/camera-0.mp4', pureMotionPath: null });
        expect((await call('?variant=motion')).status).toBe(404);
    });
});
