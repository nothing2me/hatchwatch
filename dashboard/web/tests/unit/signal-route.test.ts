import { beforeEach, describe, expect, it, vi } from 'vitest';

const currentUserOrNull = vi.fn();
const relay = vi.fn();
vi.mock('@/lib/auth/guard', () => ({ currentUserOrNull }));
vi.mock('@/lib/live/hub', () => ({ liveHub: { relay } }));
const { POST } = await import('@/app/api/live/signal/route');

const post = (body: unknown, raw?: string) => POST(new Request('http://x/api/live/signal', { method: 'POST', body: raw ?? JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
const message = { from: 'p1', deviceId: 'd1', type: 'answer', payload: { sdp: 'y' } };

beforeEach(() =>
{
    vi.clearAllMocks();
    currentUserOrNull.mockResolvedValue({ id: 'u1', email: 'a@b.cd', name: 'A', role: 'VIEWER' });
    relay.mockReturnValue('ok');
});

describe('POST /api/live/signal', () =>
{
    it('401 without a user', async () =>
    {
        currentUserOrNull.mockResolvedValue(null);
        expect((await post(message)).status).toBe(401);
        expect(relay).not.toHaveBeenCalled();
    });
    it('relays as the signed-in user', async () =>
    {
        expect((await post(message)).status).toBe(204);
        expect(relay).toHaveBeenCalledWith('u1', message);
    });
    it('400 on invalid messages, 413 on oversized bodies', async () =>
    {
        expect((await post({ ...message, type: 'nope' })).status).toBe(400);
        expect((await post(null, '{not json')).status).toBe(400);
        expect((await post(null, 'x'.repeat(70_000))).status).toBe(413);
        expect(relay).not.toHaveBeenCalled();
    });
    it('maps hub results to 403 and 404', async () =>
    {
        relay.mockReturnValue('forbidden');
        expect((await post(message)).status).toBe(403);
        relay.mockReturnValue('unknown-peer');
        expect((await post(message)).status).toBe(404);
    });
});
