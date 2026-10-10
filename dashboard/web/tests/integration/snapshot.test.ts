import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrismaClient } from '@/lib/db';
import { importSimRun } from '@/lib/sim/importRun';
import { addSiteEvent } from '@/lib/sites/events';
import { loadMapSnapshot } from '@/server/snapshot';
import { backfillSiteEvents } from '../../prisma/backfill-site-events';
import { seedDatabase } from '../../prisma/seed';

const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
let work: string;

function makeRun(name: string): string
{
    const dir = join(work, 'artifacts/public', name);
    mkdirSync(join(dir, 'view-0'), { recursive: true });
    mkdirSync(join(dir, 'view-1'), { recursive: true });
    mkdirSync(join(dir, 'pins'), { recursive: true });
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
    const pins = [{ id: 'pin-1', point: [2, 3], interval: [4, 9], score: 1.2, evidence_tier: 'two_camera', source_views: [0, 1] }];
    writeFileSync(join(dir, 'pins/predictions.json'), JSON.stringify({ schema_version: 1, methods: { pins } }));
    return dir;
}

// One imported site, moved back in time, plus `newer` closed sites created after it.
async function oldSiteBehind(newer: number): Promise<string>
{
    await importSimRun({ runDir: makeRun('A-snapshot-1'), pair: 'B', mediaRoot: join(work, 'media'), prisma });
    const old = await prisma.alert.findFirstOrThrow();
    await prisma.alert.update({ where: { id: old.id }, data: { createdAt: new Date('2026-01-01T00:00:00Z') } });
    const { id: _id, createdAt: _createdAt, detectedAt: _detectedAt, ...copy } = old;
    await prisma.alert.createMany({ data: Array.from({ length: newer }, (_, i) => ({ ...copy, status: 'DISMISSED' as const, createdAt: new Date(Date.UTC(2026, 1, 1, 0, i)) })) });
    return old.id;
}

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
    work = mkdtempSync(join(tmpdir(), 'nt-snap-'));
});
afterAll(async () =>
{
    await prisma.$disconnect();
});

describe('loadMapSnapshot', () =>
{
    it('keeps an old site whose outcome a person just recorded', async () =>
    {
        const oldId = await oldSiteBehind(100);
        await addSiteEvent(prisma, { alertId: oldId, type: 'nestConfirmed', userId: null, author: 'Una' });
        await addSiteEvent(prisma, { alertId: oldId, type: 'lost', userId: null, author: 'Una', at: new Date(Date.now() + 1000) });
        const snapshot = await loadMapSnapshot(prisma);
        expect(snapshot.alerts.find(alert => alert.id === oldId)?.status).toBe('LOST');
    });

    it('drops an old closed site nobody has touched in the last six hours', async () =>
    {
        const oldId = await oldSiteBehind(100);
        await addSiteEvent(prisma, { alertId: oldId, type: 'noNestFound', userId: null, author: 'Una' });
        await prisma.siteEvent.updateMany({ where: { alertId: oldId }, data: { createdAt: new Date(Date.now() - 7 * 3600_000) } });
        const snapshot = await loadMapSnapshot(prisma);
        expect(snapshot.alerts.some(alert => alert.id === oldId)).toBe(false);
        expect(snapshot.alerts).toHaveLength(100);
    });

    it('counts outcomes from cached statuses across every site', async () =>
    {
        await oldSiteBehind(3);
        const snapshot = await loadMapSnapshot(prisma);
        expect(snapshot.outcomes).toEqual({ saved: 0, notSaved: 0, pending: 1 });
    });
});

describe('backfillSiteEvents', () =>
{
    it('gives every site without a log a detected entry and recomputes its status, once', async () =>
    {
        await oldSiteBehind(2);
        const bare = await prisma.alert.findMany({ where: { events: { none: {} } } });
        expect(bare).toHaveLength(2);
        expect(await backfillSiteEvents(prisma)).toBe(2);
        expect(await backfillSiteEvents(prisma)).toBe(0);
        for (const alert of bare)
        {
            const after = await prisma.alert.findUniqueOrThrow({ where: { id: alert.id }, include: { events: true } });
            expect(after.events.map(event => [event.type, event.author, event.userId, event.at.toISOString()])).toEqual([['detected', 'Camera', null, alert.createdAt.toISOString()]]);
            expect(after.status).toBe('NEW');
        }
        expect(await prisma.siteEvent.count()).toBe(3);
    });
});
