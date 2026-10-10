import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const user = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/lib/auth/guard', () => ({ currentUserOrNull: async () => user.current }));

import { publishChange } from '@/lib/changes';
import { GET } from '@/app/api/stream/route';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('GET /api/stream', () =>
{
    it('is 401 without a signed-in user', async () =>
    {
        user.current = null;
        expect((await GET(new Request('http://x/api/stream'))).status).toBe(401);
    });

    it('emits one coalesced snapshot event per burst of changes, then stops on abort', async () =>
    {
        user.current = { id: 'u', role: 'VIEWER' };
        const abort = new AbortController();
        const response = await GET(new Request('http://x/api/stream', { signal: abort.signal }));
        expect(response.headers.get('Content-Type')).toBe('text/event-stream');
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        expect(decoder.decode((await reader.read()).value)).toBe(': connected\n\n');
        publishChange('x');
        publishChange('y');
        await vi.advanceTimersByTimeAsync(600);
        expect(decoder.decode((await reader.read()).value)).toBe('data: {"type":"snapshot"}\n\n');
        await vi.advanceTimersByTimeAsync(15_000);
        expect(decoder.decode((await reader.read()).value)).toBe(': keepalive\n\n');
        abort.abort();
        expect((await reader.read()).done).toBe(true);
    });
});
