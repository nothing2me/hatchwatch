import { beforeEach, describe, expect, it, vi } from 'vitest';

const currentUserOrNull = vi.fn();
const addSiteEvent = vi.fn();
const findUnique = vi.fn();
const findManyEvents = vi.fn(async () => [] as unknown[]);

class FakeSiteEventError extends Error
{
    constructor(public code: string, message: string) { super(message); }
}

vi.mock('@/lib/auth/guard', async () =>
{
    const rank: Record<string, number> = { VIEWER: 1, VOLUNTEER: 2, ADMIN: 3 };
    return { currentUserOrNull, hasRole: (user: { role: string } | null, role: string) => user !== null && rank[user.role] >= rank[role] };
});
vi.mock('@/lib/sites/events', () => ({ addSiteEvent, SiteEventError: FakeSiteEventError }));
vi.mock('@/lib/db', () => ({ prisma: { alert: { findUnique }, siteEvent: { findMany: findManyEvents } } }));

const { GET } = await import('@/app/api/sites/[alertId]/route');
const { POST } = await import('@/app/api/sites/[alertId]/events/route');

const ctx = { params: Promise.resolve({ alertId: 'a1' }) };
const post = (body: unknown) => POST(new Request('http://x/api/sites/a1/events', { method: 'POST', body: JSON.stringify(body) }), ctx);
const user = (role: string) => ({ id: 'u1', email: 'u@x.y', name: 'Una', role });

beforeEach(() =>
{
    vi.clearAllMocks();
    currentUserOrNull.mockResolvedValue(user('VOLUNTEER'));
    addSiteEvent.mockResolvedValue({ outcome: 'open' });
});

describe('POST /api/sites/[alertId]/events', () =>
{
    it('401 without a user, 403 for viewers', async () =>
    {
        currentUserOrNull.mockResolvedValue(null);
        expect((await post({ type: 'note' })).status).toBe(401);
        currentUserOrNull.mockResolvedValue(user('VIEWER'));
        expect((await post({ type: 'note' })).status).toBe(403);
        expect(addSiteEvent).not.toHaveBeenCalled();
    });
    it('400 for bad bodies and camera-only types', async () =>
    {
        expect((await post({ type: 'archived' })).status).toBe(400);
        expect((await post({ type: 'note', note: 'x'.repeat(1001) })).status).toBe(400);
    });
    it('records the entry as the signed-in user', async () =>
    {
        const response = await post({ type: 'patrolVisit', note: 'looked' });
        expect(response.status).toBe(200);
        expect(addSiteEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ alertId: 'a1', type: 'patrolVisit', userId: 'u1', author: 'Una', note: 'looked' }));
    });
    it('maps domain errors to 404, 409 and 400', async () =>
    {
        addSiteEvent.mockRejectedValueOnce(new FakeSiteEventError('NOT_FOUND', 'n'));
        expect((await post({ type: 'note' })).status).toBe(404);
        addSiteEvent.mockRejectedValueOnce(new FakeSiteEventError('NEEDS_CONFIRMED', 'n'));
        expect((await post({ type: 'hatched' })).status).toBe(409);
        addSiteEvent.mockRejectedValueOnce(new FakeSiteEventError('NOT_PERSON_EVENT', 'n'));
        expect((await post({ type: 'note' })).status).toBe(400);
    });
    it('accepts dangerResolved from volunteers, never the camera-only danger entry', async () =>
    {
        expect((await post({ type: 'danger' })).status).toBe(400);
        const response = await post({ type: 'dangerResolved', note: 'walker moved on' });
        expect(response.status).toBe(200);
        expect(addSiteEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'dangerResolved', userId: 'u1', note: 'walker moved on' }));
        currentUserOrNull.mockResolvedValue(user('VIEWER'));
        expect((await post({ type: 'dangerResolved' })).status).toBe(403);
        currentUserOrNull.mockResolvedValue(user('VOLUNTEER'));
        addSiteEvent.mockRejectedValueOnce(new FakeSiteEventError('WRONG_KIND', 'n'));
        expect((await post({ type: 'dangerResolved' })).status).toBe(400);
    });
});

describe('GET /api/sites/[alertId]', () =>
{
    it('401 without a user and 404 for unknown sites', async () =>
    {
        currentUserOrNull.mockResolvedValue(null);
        expect((await GET(new Request('http://x'), ctx)).status).toBe(401);
        currentUserOrNull.mockResolvedValue(user('VIEWER'));
        findUnique.mockResolvedValue(null);
        expect((await GET(new Request('http://x'), ctx)).status).toBe(404);
    });
    it('returns the site, summary and newest-first events', async () =>
    {
        findUnique.mockResolvedValue({
            id: 'a1', kind: 'DIGGING', message: 'm', status: 'NEW', zone: { code: 'B' }, camera: { code: 'B1' }, lng: 1, lat: 2,
            createdAt: new Date('2026-10-09T20:00:00Z'), videoId: 'v', simulated: true,
            events: [{ id: 'e1', type: 'detected', author: 'Camera', note: null, at: new Date('2026-10-09T20:00:00Z') }],
        });
        const body = await (await GET(new Request('http://x'), ctx)).json();
        expect(body.site).toMatchObject({ id: 'a1', zoneCode: 'B', position: [1, 2] });
        expect(body.summary.detectedAt).toBe('2026-10-09T20:00:00.000Z');
        expect(body.events[0]).toMatchObject({ id: 'e1', author: 'Camera' });
        expect(body.summary.secured).toBeNull();
    });
    it('marks the site secured by a resolution logged on one of its danger alerts', async () =>
    {
        findUnique.mockResolvedValue({
            id: 'a1', kind: 'DIGGING', message: 'm', status: 'NEW', zone: { code: 'B' }, camera: { code: 'B1' }, lng: 1, lat: 2,
            createdAt: new Date('2026-10-09T20:00:00Z'), videoId: 'v', simulated: true,
            events: [
                { id: 'e1', type: 'detected', author: 'Camera', note: null, at: new Date('2026-10-09T20:00:00Z') },
                { id: 'e2', type: 'danger', author: 'Camera', note: null, at: new Date('2026-10-09T20:01:00Z') },
            ],
        });
        findManyEvents.mockResolvedValueOnce([{ at: new Date('2026-10-09T20:05:00Z'), createdAt: new Date('2026-10-09T20:05:00Z'), author: 'Vera', alert: { siteId: 'a1' } }]);
        const body = await (await GET(new Request('http://x'), ctx)).json();
        expect(body.summary.secured).toEqual({ by: 'Vera', at: '2026-10-09T20:05:00.000Z' });
    });
});
