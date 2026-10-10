// Response-time maths: clocks start at the alert, waiting sites are kept
// out of the averages, and the worst cases come out in order.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatElapsed, responseFor, summarizeResponses } from '../src/utils/responseTimes.js';
import { beachZones, beachCameraPairs } from '../src/data/beachLayout.js';
import { NestStore } from '../server/nestStore.js';

const alertAt = '2026-10-09T23:00:00.000Z';

function site(nestIdentifier, patrolEntries, extra = {})
{
    return {
        nestIdentifier,
        zoneIdentifier: 'B',
        alertRaisedAt: alertAt,
        events:
        [
            { type: 'detected', time: '2026-10-09T22:58:30.000Z', source: 'system', author: 'Cameras', note: '' },
            { type: 'alertRaised', time: alertAt, source: 'system', author: 'Dashboard', note: '' },
            ...patrolEntries.map(([type, secondsAfterAlert, author = 'J. Alvarez']) => ({ type, time: new Date(Date.parse(alertAt) + secondsAfterAlert * 1000).toISOString(), source: 'patrol', author, note: '' })),
        ],
        ...extra,
    };
}

test('times are measured from the alert, not the arrival', () =>
{
    const response = responseFor(site('NT-0001', [['patrolVisit', 90], ['protectionInstalled', 300]]));
    assert.equal(response.millisecondsToFirstPatrol, 90000);
    assert.equal(response.millisecondsToProtect, 300000);
});

test('averages, median, worst case, and waiting sites', () =>
{
    const sites =
    [
        site('NT-0001', [['patrolVisit', 60], ['protectionInstalled', 120]]),
        site('NT-0002', [['patrolVisit', 60], ['protectionInstalled', 240, 'Demo patrol (simulated)']]),
        site('NT-0003', [['protectionInstalled', 600]]),
        site('NT-0004', [['patrolVisit', 30]]),                 // visited, not yet protected: waiting
        site('NT-0005', [['patrolVisit', 45], ['noNestFound', 50]]), // ruled out: neither protected nor waiting
        site('NT-0006', []),                                      // nobody yet: waiting
        { nestIdentifier: 'NT-0007', zoneIdentifier: 'A', events: [] }, // sample-style site with no alert: ignored
    ];
    const summary = summarizeResponses(sites, new Date(Date.parse(alertAt) + 900000));

    assert.equal(summary.responses.length, 6);
    assert.equal(summary.protectedCount, 3);
    assert.equal(summary.averageMillisecondsToProtect, (120 + 240 + 600) / 3 * 1000);
    assert.equal(summary.medianMillisecondsToProtect, 240000);
    assert.equal(summary.worstMillisecondsToProtect, 600000);
    assert.deepEqual(summary.worstProtected.map((response) => response.nestIdentifier), ['NT-0003', 'NT-0002', 'NT-0001']);
    assert.deepEqual(summary.waiting.map((response) => response.nestIdentifier), ['NT-0004', 'NT-0006']);
    assert.equal(summary.waiting[0].millisecondsWaiting, 900000);
    assert.ok(Math.abs(summary.simulatedShare - 1 / 3) < 1e-9);
    assert.equal(summary.averageMillisecondsToFirstPatrol, (60 + 60 + 600 + 30 + 45) / 5 * 1000);
});

test('formats response times for people', () =>
{
    assert.equal(formatElapsed(null), '—');
    assert.equal(formatElapsed(45000), '45 s');
    assert.equal(formatElapsed(185000), '3 min 05 s');
    assert.equal(formatElapsed(4320000), '1 h 12 min');
});

test('backfills an "Alert raised" entry for sites saved before it was logged', async () =>
{
    const dataDirectory = await mkdtemp(join(tmpdir(), 'nesttrace-backfill-'));
    const oldSite = site('NT-0001', []);
    oldSite.events = oldSite.events.filter((event) => event.type !== 'alertRaised');
    await writeFile(join(dataDirectory, 'state.json'), JSON.stringify({ version: 1, nextSiteNumber: 2, processedChunks: {}, feeds: {}, sites: [oldSite] }));

    const store = new NestStore({ dataDirectory, zones: beachZones, cameraPairs: beachCameraPairs, settings: { fadeStartMinutes: 5, archiveAfterMinutes: 20, cameraStaleMinutes: 15, recentActivityMinutes: 5 } });
    await store.load();
    await store.pendingWrite;
    const alert = store.findSite('NT-0001').events.find((event) => event.type === 'alertRaised');
    assert.equal(alert.time, alertAt);
    assert.ok((await readFile(join(dataDirectory, 'audit.jsonl'), 'utf8')).includes('alertRaised'));
});
