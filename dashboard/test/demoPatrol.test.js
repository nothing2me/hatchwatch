// Demo patrol tests: it visits and protects new sites, labels itself, never
// confirms a nest, and stands down when a real patrol member got there first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beachZones, beachCameraPairs } from '../src/data/beachLayout.js';
import { summarizeNestSite } from '../src/utils/nestStatus.js';
import { convertChunk, validatePins } from '../server/liveChunkAdapter.js';
import { NestStore } from '../server/nestStore.js';
import { demoPatrolName, startDemoPatrol } from '../server/demoPatrol.js';

const fixtureFolder = new URL('./fixtures/live-000001-fixture/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('live-chunk.json', fixtureFolder), 'utf8'));
const { pins } = validatePins(JSON.parse(await readFile(new URL('pins/predictions.json', fixtureFolder), 'utf8')));

// Runs scheduled callbacks by hand instead of waiting on real timers.
function manualTimers()
{
    const queue = [];
    return {
        schedule(callback)
        {
            const timer = { callback };
            queue.push(timer);
            return timer;
        },
        cancel(timer)
        {
            const index = queue.indexOf(timer);
            if (index >= 0)
            {
                queue.splice(index, 1);
            }
        },
        async runAll()
        {
            while (queue.length > 0)
            {
                queue.shift().callback();
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
        },
    };
}

test('visits and protects every new site, and never confirms a nest', async () =>
{
    const store = new NestStore({ dataDirectory: await mkdtemp(join(tmpdir(), 'nesttrace-patrol-')), zones: beachZones, cameraPairs: beachCameraPairs, settings: { fadeStartMinutes: 5, archiveAfterMinutes: 20, cameraStaleMinutes: 15, recentActivityMinutes: 5 }, now: () => new Date('2026-10-09T23:03:00Z') });
    await store.load();
    const timers = manualTimers();
    const stop = startDemoPatrol(store, { schedule: timers.schedule, cancel: timers.cancel, random: () => 0 });

    await store.ingestChunk(manifest, convertChunk(manifest, pins, beachZones, beachCameraPairs));
    // A real patrol member secures NT-0003 before the demo patrol gets there.
    await store.addPatrolEntry('NT-0003', { type: 'patrolVisit', author: 'J. Alvarez' });
    await timers.runAll();
    stop();

    for (const site of store.state.sites)
    {
        const summary = summarizeNestSite(site);
        const demoEntries = site.events.filter((event) => event.author === demoPatrolName);
        assert.equal(summary.nestingStatus, 'unresolved', `${site.nestIdentifier} stays unresolved`);
        assert.ok(demoEntries.every((event) => ['patrolVisit', 'protectionInstalled'].includes(event.type)));
        if (site.nestIdentifier === 'NT-0003')
        {
            assert.equal(demoEntries.length, 0, 'stands down when a real patrol visited');
        }
        else
        {
            assert.equal(summary.protectionStatus, 'protected', `${site.nestIdentifier} protected`);
            assert.deepEqual(demoEntries.map((event) => event.type), ['patrolVisit', 'protectionInstalled']);
        }
    }
});
