import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrismaClient } from '@/lib/db';
import { onChange } from '@/lib/changes';
import { importSimRun } from '@/lib/sim/importRun';
import { addSiteEvent, SiteEventError } from '@/lib/sites/events';
import { statusFor, summarizeSite } from '@/lib/sites/summary';
import { seedDatabase } from '../../prisma/seed';

const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
let work: string;

function makeRun(name: string, pins: unknown[] | null): string
{
    const dir = join(work, 'artifacts/public', name);
    mkdirSync(join(dir, 'view-0'), { recursive: true });
    mkdirSync(join(dir, 'view-1'), { recursive: true });
    for (const file of ['camera-0.mp4', 'camera-1.mp4', 'view-0/pure-motion.mp4', 'view-1/pure-motion.mp4'])
    {
        writeFileSync(join(dir, file), `video:${name}:${file}`);
    }
    for (const camera of [0, 1])
    {
        writeFileSync(join(dir, `calibration-${camera}.json`), JSON.stringify({ camera, width: 1280, height: 720, ground_bounds: [-12, 12, -8, 8] }));
    }
    writeFileSync(join(dir, 'timestamps.json'), JSON.stringify(Array.from({ length: 81 }, (_, i) => i * 0.125)));
    writeFileSync(join(dir, 'analysis.json'), JSON.stringify({ cameras: [0, 1], inference_complete: true }));
    if (pins)
    {
        mkdirSync(join(dir, 'pins'), { recursive: true });
        writeFileSync(join(dir, 'pins/predictions.json'), JSON.stringify({ schema_version: 1, methods: { pins } }));
    }
    return dir;
}

const pin = (id: string, tier: 'two_camera' | 'single_camera') => ({
    id, point: [2, 3], interval: [4, 9], score: 1.2, evidence_tier: tier, source_views: tier === 'two_camera' ? [0, 1] : [1],
});

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
    await prisma.$executeRawUnsafe('TRUNCATE "SiteEvent","LiveChunk","AuditLog","AlertStatusChange","AlertNote","Alert","Track","Job","Video","Camera","Zone","User" CASCADE');
    await seedDatabase(prisma, { adminEmail: 'admin@test.local', adminPassword: 'pw-for-tests' });
    work = mkdtempSync(join(tmpdir(), 'nt-sim-'));
});
afterAll(async () =>
{
    await prisma.$disconnect();
});

describe('addSiteEvent', () =>
{
    async function freshSite(): Promise<string>
    {
        const runDir = makeRun('A-site-log-1', [pin('pin-1', 'two_camera')]);
        await importSimRun({ runDir, pair: 'B', mediaRoot: join(work, 'media'), prisma });
        return (await prisma.alert.findFirstOrThrow()).id;
    }

    it('writes a detected event on import', async () =>
    {
        const alertId = await freshSite();
        const events = await prisma.siteEvent.findMany({ where: { alertId } });
        expect(events.map(event => [event.type, event.author])).toEqual([['detected', 'Camera']]);
        expect((await prisma.alert.findUniqueOrThrow({ where: { id: alertId } })).detectedAt).not.toBeNull();
    });

    it('refuses hatched before a confirmed nest and writes nothing', async () =>
    {
        const alertId = await freshSite();
        await expect(addSiteEvent(prisma, { alertId, type: 'hatched', userId: null, author: 'Una' })).rejects.toMatchObject({ code: 'NEEDS_CONFIRMED' });
        expect(await prisma.siteEvent.count({ where: { alertId } })).toBe(1);
    });

    it('confirmed then hatched closes the site as HATCHED', async () =>
    {
        const alertId = await freshSite();
        await addSiteEvent(prisma, { alertId, type: 'nestConfirmed', userId: null, author: 'Una', at: new Date(Date.now() + 1000) });
        const summary = await addSiteEvent(prisma, { alertId, type: 'hatched', userId: null, author: 'Una', at: new Date(Date.now() + 2000) });
        expect(summary.outcome).toBe('hatched');
        expect((await prisma.alert.findUniqueOrThrow({ where: { id: alertId } })).status).toBe('HATCHED');
    });

    it('allows system events only with system: true', async () =>
    {
        const alertId = await freshSite();
        await expect(addSiteEvent(prisma, { alertId, type: 'archived', userId: null, author: 'Camera' })).rejects.toBeInstanceOf(SiteEventError);
        await expect(addSiteEvent(prisma, { alertId, type: 'archived', userId: null, author: 'Camera' })).rejects.toMatchObject({ code: 'NOT_PERSON_EVENT' });
        const summary = await addSiteEvent(prisma, { alertId, type: 'archived', userId: null, author: 'Camera', system: true });
        expect(summary.active).toBe(false);
        expect((await prisma.alert.findUniqueOrThrow({ where: { id: alertId } })).status).toBe('ARCHIVED');
    });

    it('reports unknown sites and publishes one change per successful event', async () =>
    {
        const alertId = await freshSite();
        await expect(addSiteEvent(prisma, { alertId: 'nope', type: 'note', userId: null, author: 'Una' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
        const seen: string[] = [];
        const off = onChange(reason => seen.push(reason));
        await addSiteEvent(prisma, { alertId, type: 'note', note: 'hi', userId: null, author: 'Una' });
        await addSiteEvent(prisma, { alertId, type: 'hatched', userId: null, author: 'Una' }).catch(() => undefined);
        off();
        expect(seen).toEqual(['site-event']);
    });

    it('serialises concurrent events so the cached status matches the log', async () =>
    {
        for (let round = 0; round < 5; round++)
        {
            const alertId = await freshSite();
            await Promise.all([
                addSiteEvent(prisma, { alertId, type: 'archived', userId: null, author: 'Camera', system: true }),
                addSiteEvent(prisma, { alertId, type: 'patrolVisit', userId: null, author: 'Una' }),
            ]);
            const events = (await prisma.siteEvent.findMany({ where: { alertId }, orderBy: [{ at: 'asc' }, { createdAt: 'asc' }] }))
                .map(event => ({ type: event.type as never, at: event.at, createdAt: event.createdAt }));
            const alert = await prisma.alert.findUniqueOrThrow({ where: { id: alertId } });
            expect(alert.status).toBe(statusFor(summarizeSite(events), events));
        }
    });
});
