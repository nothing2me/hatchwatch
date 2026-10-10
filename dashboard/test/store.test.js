// Store tests: logging, patrol validation, fading, archiving, persistence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beachZones, beachCameraPairs } from '../src/data/beachLayout.js';
import { summarizeNestSite } from '../src/utils/nestStatus.js';
import { convertChunk, validatePins } from '../server/liveChunkAdapter.js';
import { NestStore } from '../server/nestStore.js';

const fixtureFolder = new URL('./fixtures/live-000001-fixture/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('live-chunk.json', fixtureFolder), 'utf8'));
const { pins } = validatePins(JSON.parse(await readFile(new URL('pins/predictions.json', fixtureFolder), 'utf8')));
const settings = { fadeStartMinutes: 5, archiveAfterMinutes: 20, cameraStaleMinutes: 15, recentActivityMinutes: 5 };

// A controllable clock, starting just after the fixture chunk was published.
function makeClock(start = '2026-10-09T23:02:00.000Z')
{
    let current = Date.parse(start);
    return {
        now: () => new Date(current),
        advanceMinutes(minutes)
        {
            current += minutes * 60000;
        },
    };
}

async function makeStore(clock, dataDirectory)
{
    const store = new NestStore({ dataDirectory: dataDirectory ?? await mkdtemp(join(tmpdir(), 'nesttrace-store-')), zones: beachZones, cameraPairs: beachCameraPairs, settings, now: clock.now });
    await store.load();
    return store;
}

test('ingests a chunk once, numbering sites and starting them unprotected', async () =>
{
    const store = await makeStore(makeClock());
    const created = await store.ingestChunk(manifest, convertChunk(manifest, pins, beachZones, beachCameraPairs));
    assert.deepEqual(created.map((site) => site.nestIdentifier), ['NT-0001', 'NT-0002', 'NT-0003', 'NT-0004', 'NT-0005', 'NT-0006']);
    assert.ok(created.every((site) => summarizeNestSite(site).protectionStatus === 'unprotected'));
    assert.ok(created.every((site) => summarizeNestSite(site).nestingStatus === 'unresolved'));

    const again = await store.ingestChunk(manifest, convertChunk(manifest, pins, beachZones, beachCameraPairs));
    assert.equal(again.length, 0);
    assert.equal(store.snapshot().nestSites.length, 6);
});

test('validates patrol entries and flips protection only through the log', async () =>
{
    const store = await makeStore(makeClock());
    await store.ingestChunk(manifest, convertChunk(manifest, pins, beachZones, beachCameraPairs));

    await assert.rejects(store.addPatrolEntry('NT-9999', { type: 'patrolVisit', author: 'A' }), { statusCode: 404 });
    await assert.rejects(store.addPatrolEntry('NT-0001', { type: 'detected', author: 'A' }), { statusCode: 400 });
    await assert.rejects(store.addPatrolEntry('NT-0001', { type: 'patrolVisit', author: '   ' }), { statusCode: 400 });
    await assert.rejects(store.addPatrolEntry('NT-0001', { type: 'note', author: 'A', note: '' }), { statusCode: 400 });
    await assert.rejects(store.addPatrolEntry('NT-0001', { type: 'note', author: 'A', note: 'x'.repeat(501) }), { statusCode: 400 });

    await store.addPatrolEntry('NT-0001', { type: 'patrolVisit', author: ' Test Patrol ', note: 'On site' });
    const site = await store.addPatrolEntry('NT-0001', { type: 'protectionInstalled', author: 'Test Patrol' });
    const summary = summarizeNestSite(site);
    assert.equal(summary.protectionStatus, 'protected');
    assert.equal(summary.patrolVisited, true);
    assert.equal(site.events.at(-2).author, 'Test Patrol');
    assert.equal(new Set(site.events.map((event) => event.eventIdentifier)).size, site.events.length);
});

test('fades sites with age, then archives them with a logged entry', async () =>
{
    const clock = makeClock();
    const store = await makeStore(clock);
    await store.ingestChunk(manifest, convertChunk(manifest, pins, beachZones, beachCameraPairs));
    const visibility = () => store.snapshot().nestSites.find((site) => site.nestIdentifier === 'NT-0001').visibility;

    assert.equal(visibility(), 1);
    assert.equal(store.snapshot().zones.find((zone) => zone.zoneIdentifier === 'B').activityLevel, 'high');

    clock.advanceMinutes(10);
    assert.ok(visibility() < 1 && visibility() > 0.25, `faded to ${visibility()}`);
    assert.equal(store.snapshot().zones.find((zone) => zone.zoneIdentifier === 'B').activityLevel, 'medium');
    assert.equal((await store.sweep()).length, 0);

    clock.advanceMinutes(12);
    const archived = await store.sweep();
    assert.equal(archived.length, 6);
    assert.equal(visibility(), 0);
    const site = store.findSite('NT-0001');
    assert.equal(site.events.at(-1).type, 'archived');
    assert.equal(summarizeNestSite(site).isArchived, true);
    assert.equal(store.snapshot().zones.find((zone) => zone.zoneIdentifier === 'B').activityLevel, 'low');
    assert.equal((await store.sweep()).length, 0, 'archives each site once');
});

test('marks a camera pair offline once its footage goes stale', async () =>
{
    const clock = makeClock();
    const store = await makeStore(clock);
    await store.ingestChunk(manifest, convertChunk(manifest, pins, beachZones, beachCameraPairs));
    const pairB = () => store.snapshot().cameraPairs.find((pair) => pair.pairIdentifier === 'B');
    assert.deepEqual(pairB().cameras.map((camera) => camera.status), ['online', 'online']);
    assert.equal(pairB().cameras[0].videoUrl, '/media/live-000001-fixture/camera-1.mp4');
    assert.deepEqual(store.snapshot().cameraPairs.find((pair) => pair.pairIdentifier === 'A').cameras.map((camera) => camera.status), ['offline', 'offline']);

    clock.advanceMinutes(16);
    assert.deepEqual(pairB().cameras.map((camera) => camera.status), ['offline', 'offline']);
});

test('persists state and keeps an append-only audit trail', async () =>
{
    const clock = makeClock();
    const dataDirectory = await mkdtemp(join(tmpdir(), 'nesttrace-store-'));
    const store = await makeStore(clock, dataDirectory);
    await store.ingestChunk(manifest, convertChunk(manifest, pins, beachZones, beachCameraPairs));
    await store.addPatrolEntry('NT-0002', { type: 'patrolVisit', author: 'Test Patrol' });
    await store.pendingWrite;

    const reloaded = await makeStore(clock, dataDirectory);
    assert.equal(reloaded.snapshot().nestSites.length, 6);
    assert.equal(summarizeNestSite(reloaded.findSite('NT-0002')).patrolVisited, true);
    assert.ok(reloaded.hasChunk('live-000001-fixture'));

    const auditLines = (await readFile(join(dataDirectory, 'audit.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(auditLines.length, 6 * 3 + 1); // arrival, departure and alert per site, plus the patrol visit
    assert.equal(auditLines.at(-1).type, 'patrolVisit');
});
