import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real DB-backed guard, with the session, user row and Next.js navigation stubbed.
const findUnique = vi.fn();
const manage = {
    addCameraPair: vi.fn(), addCameraPairNewZone: vi.fn(), addCameraPairToZone: vi.fn(), moveZone: vi.fn(), deleteZone: vi.fn(),
    deleteCamera: vi.fn(), faceOcean: vi.fn(), mergeZoneInto: vi.fn(), updateCamera: vi.fn(), setCameraSource: vi.fn(),
};
let role = 'ADMIN';
vi.mock('@/lib/db', () => ({ prisma: { user: { findUnique } } }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'token' }) }) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('REDIRECT'); }), forbidden: vi.fn(() => { throw new Error('FORBIDDEN'); }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ SESSION_COOKIE: 's', readSessionToken: vi.fn(async () => ({ id: 'u1', email: 'a@b.cd', name: 'A', role })) }));
vi.mock('@/lib/cameras/manage', () => ({ ...manage, CameraEditError: class extends Error {} }));

const actions = await import('@/app/(app)/camera-actions');

beforeEach(() =>
{
    vi.clearAllMocks();
    process.env.AUTH_SECRET = 'q8Zr1vK0wX9mT4bN7cH2jL6pD3sF5gA1';
    findUnique.mockImplementation(async () => ({ id: 'u1', email: 'a@b.cd', name: 'A', role, disabled: false, disabledAt: null }));
});

const calls: [string, () => Promise<unknown>][] = [
    ['map click', () => actions.addCameraPair([-97.05, 27.83])],
    ['new zone', () => actions.addCameraPairNewZone(-97.05, 27.83)],
    ['move zone', () => actions.moveZone('E', [-97.05, 27.83], [-97.049, 27.831])],
    ['delete zone', () => actions.deleteZone('E')],
    ['camera source', () => actions.setCameraSource('B1', 'ck1')],
];

describe('camera and zone actions', () =>
{
    for (const denied of ['VIEWER', 'VOLUNTEER'])
    {
        it(`refuses a ${denied.toLowerCase()} before touching anything`, async () =>
        {
            role = denied;
            for (const [, call] of calls)
            {
                await expect(call()).rejects.toThrow('FORBIDDEN');
            }
            for (const fn of Object.values(manage))
            {
                expect(fn).not.toHaveBeenCalled();
            }
        });
    }

    it('lets an admin through, checks the role against the database, and validates input', async () =>
    {
        role = 'ADMIN';
        manage.addCameraPairNewZone.mockResolvedValue({ codes: ['E1', 'E2'], zoneCode: 'E', newZone: true });
        manage.moveZone.mockResolvedValue({ code: 'E' });
        manage.deleteZone.mockResolvedValue({ code: 'E' });
        expect(await actions.addCameraPairNewZone(-97.05, 27.83)).toEqual({ ok: true, codes: ['E1', 'E2'], zoneCode: 'E', newZone: true });
        expect(manage.addCameraPairNewZone).toHaveBeenCalledWith(expect.anything(), 'u1', [-97.05, 27.83]);
        expect(await actions.moveZone('E', [-97.05, 27.83], [-97.049, 27.831])).toEqual({ ok: true, code: 'E' });
        expect(await actions.deleteZone('E')).toEqual({ ok: true, code: 'E' });
        expect(findUnique).toHaveBeenCalled();
        expect(await actions.addCameraPairNewZone(-197, 27.83)).toMatchObject({ ok: false });
        expect(await actions.moveZone('e!', [0, 0], [0, 0])).toEqual({ ok: false, error: 'That move could not be read.' });
        expect(await actions.deleteZone('EE')).toEqual({ ok: false, error: 'That zone no longer exists.' });
        expect(manage.deleteZone).toHaveBeenCalledTimes(1);
        manage.setCameraSource.mockResolvedValue({ code: 'B1' });
        expect(await actions.setCameraSource('B1', null)).toEqual({ ok: true, code: 'B1' });
        expect(manage.setCameraSource).toHaveBeenCalledWith(expect.anything(), 'u1', 'B1', null);
        expect(await actions.setCameraSource('B1', 'x'.repeat(41))).toEqual({ ok: false, error: 'That source could not be read.' });
    });
});
