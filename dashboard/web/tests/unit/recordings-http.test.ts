import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@/lib/auth/session';
import { getRecordingFile, getRecordingList } from '@/lib/phones/recordingsHttp';

const user = (role: SessionUser['role']): SessionUser => ({ id: 'u', email: 'u@x.y', name: 'U', role });
const root = mkdtempSync(join(tmpdir(), 'nt-rhttp-'));
mkdirSync(join(root, 'ckd1/2026-10-10'), { recursive: true });
writeFileSync(join(root, 'ckd1/2026-10-10/070509.mp4'), '0123456789');
writeFileSync(join(root, 'secret.mp4'), 'nope');
const get = (path: string, role: SessionUser['role'] | null = 'ADMIN', headers: Record<string, string> = {}, query = '') =>
    getRecordingFile({ user: role ? user(role) : null, root }, path, new Request(`https://x/api/live/recordings/${path}${query}`, { headers }));

describe('recordings routes', () =>
{
    it('are for admins only', async () =>
    {
        expect((await get('ckd1/2026-10-10/070509.mp4', null)).status).toBe(401);
        expect((await get('ckd1/2026-10-10/070509.mp4', 'VOLUNTEER')).status).toBe(403);
        expect((await get('ckd1/2026-10-10/070509.mp4', 'VIEWER')).status).toBe(403);
        expect((await getRecordingList({ user: user('VIEWER'), recorder: null })).status).toBe(403);
        expect((await getRecordingList({ user: null, recorder: null })).status).toBe(401);
    });

    it('serves a file with ranges and an optional download name', async () =>
    {
        const full = await get('ckd1/2026-10-10/070509.mp4');
        expect(full.status).toBe(200);
        expect(full.headers.get('content-type')).toBe('video/mp4');
        expect(await full.text()).toBe('0123456789');
        const part = await get('ckd1/2026-10-10/070509.mp4', 'ADMIN', { range: 'bytes=2-4' });
        expect(part.status).toBe(206);
        expect(part.headers.get('content-range')).toBe('bytes 2-4/10');
        expect(await part.text()).toBe('234');
        expect((await get('ckd1/2026-10-10/070509.mp4', 'ADMIN', { range: 'bytes=50-' })).status).toBe(416);
        expect((await get('ckd1/2026-10-10/070509.mp4', 'ADMIN', {}, '?download=1')).headers.get('content-disposition')).toBe('attachment; filename="ckd1_2026-10-10_070509.mp4"');
    });

    it('refuses anything outside the layout, and missing files', async () =>
    {
        for (const bad of ['../secret.mp4', 'secret.mp4', 'ckd1/../secret.mp4', 'ckd1/2026-10-10/070509.json', 'ckd1/2026-10-10/999999.mp4'])
        {
            expect((await get(bad)).status).toBe(404);
        }
    });

    it('lists recordings, or says recording is off', async () =>
    {
        const off = await getRecordingList({ user: user('ADMIN'), recorder: null });
        expect(await off.json()).toEqual({ enabled: false, convertsToMp4: false, recordings: [] });
        const on = await getRecordingList({ user: user('ADMIN'), recorder: { hasFfmpeg: true, list: async () => [] } });
        expect(await on.json()).toEqual({ enabled: true, convertsToMp4: true, recordings: [] });
    });
});
