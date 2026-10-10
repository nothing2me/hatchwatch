import { beforeEach, describe, expect, it, vi } from 'vitest';
import { liveHub as hub } from '@/lib/live/hub';

const currentUserOrNull = vi.fn();
const findUnique = vi.fn();
vi.mock('@/lib/auth/guard', () => ({ currentUserOrNull }));
vi.mock('@/lib/db', () => ({ prisma: { liveDevice: { findUnique } } }));
const { GET } = await import('@/app/api/live/events/route');

const open = (query: string, signal?: AbortSignal) => GET(new Request(`http://x/api/live/events?${query}`, { signal }));

async function firstEvent(response: Response): Promise<unknown>
{
    const reader = response.body!.getReader();
    const { value } = await reader.read();
    reader.releaseLock();
    return JSON.parse(new TextDecoder().decode(value).replace(/^data: /, '').trim());
}

beforeEach(() =>
{
    vi.clearAllMocks();
    currentUserOrNull.mockResolvedValue({ id: 'owner', email: 'o@x.y', name: 'O', role: 'VIEWER' });
    findUnique.mockResolvedValue({ ownerId: 'owner', camera: { id: 'c1' } });
});

describe('GET /api/live/events', () =>
{
    it('401 without a user, 400 on a bad query', async () =>
    {
        currentUserOrNull.mockResolvedValueOnce(null);
        expect((await open('role=device&device=d1')).status).toBe(401);
        expect((await open('role=admin&device=d1')).status).toBe(400);
        expect((await open('role=viewer')).status).toBe(400);
    });

    it('404 for a device you do not own, or watching a device no camera uses', async () =>
    {
        currentUserOrNull.mockResolvedValue({ id: 'someone-else', email: 's@x.y', name: 'S', role: 'ADMIN' });
        expect((await open('role=device&device=d1')).status).toBe(404);
        findUnique.mockResolvedValue({ ownerId: 'owner', camera: null });
        expect((await open('role=viewer&device=d1')).status).toBe(404);
        findUnique.mockResolvedValue(null);
        expect((await open('role=viewer&device=d1')).status).toBe(404);
    });

    it('streams hello to the device and drops the peer when the request aborts', async () =>
    {
        const abort = new AbortController();
        const response = await open('role=device&device=d9', abort.signal);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/event-stream');
        expect(await firstEvent(response)).toMatchObject({ type: 'hello' });

        const viewer = { events: [] as unknown[], send(event: unknown) { this.events.push(event); }, close() {} };
        expect(hub.connectViewer('d9', 'alice', viewer)).not.toBeNull();
        abort.abort();
        expect(hub.connectViewer('d9', 'bob', { send() {}, close() {} })).toBeNull();
        expect(viewer.events).toContainEqual(expect.objectContaining({ type: 'leave' }));
    });
});
