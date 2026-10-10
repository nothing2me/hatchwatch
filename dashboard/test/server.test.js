// Integration check at the adapter boundary: a real backend on a random
// port, reading a temporary public folder the way it reads the simulator's.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDashboardServer } from '../server/server.js';

const fixtureFolder = new URL('./fixtures/live-000001-fixture/', import.meta.url);
let dashboard;
let baseUrl;
let publicRoot;

before(async () =>
{
    publicRoot = await mkdtemp(join(tmpdir(), 'nesttrace-public-'));
    await cp(fixtureFolder, join(publicRoot, 'live-000001-fixture'), { recursive: true });
    dashboard = await createDashboardServer(
    {
        port: 0,
        publicRoot,
        dataDirectory: await mkdtemp(join(tmpdir(), 'nesttrace-data-')),
        allowedOrigins: ['http://localhost:5180'],
        demoPatrol: false,
        pollSeconds: 60,
        sweepSeconds: 60,
        store: { fadeStartMinutes: 5, archiveAfterMinutes: 20, cameraStaleMinutes: 100000, recentActivityMinutes: 100000 },
    }, { log: () => {}, now: () => new Date('2026-10-09T23:03:00Z') }); // fixed clock: shortly after the fixture chunk
    baseUrl = `http://127.0.0.1:${await dashboard.listen(0)}`;
});

after(async () =>
{
    await dashboard.close();
});

// Reads server-sent events until `predicate` matches one, or times out.
async function waitForEvent(response, predicate, timeoutMilliseconds = 5000)
{
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const deadline = Date.now() + timeoutMilliseconds;
    try
    {
        while (Date.now() < deadline)
        {
            const { value, done } = await Promise.race([reader.read(), new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), deadline - Date.now()))]);
            if (done || value === undefined)
            {
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            let boundary;
            while ((boundary = buffer.indexOf('\n\n')) >= 0)
            {
                const block = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                const eventName = /^event: (.+)$/m.exec(block)?.[1];
                const data = /^data: (.+)$/m.exec(block)?.[1];
                if (eventName && data && predicate(eventName, JSON.parse(data)))
                {
                    return { eventName, data: JSON.parse(data) };
                }
            }
        }
    }
    finally
    {
        reader.cancel().catch(() => {});
    }
    throw new Error('Timed out waiting for event');
}

test('serves the fixture chunk as nest sites on the map', async () =>
{
    const snapshot = await (await fetch(`${baseUrl}/api/snapshot`)).json();
    assert.equal(snapshot.mode, 'live');
    assert.equal(snapshot.feed.chunksProcessed, 1);
    assert.equal(snapshot.nestSites.length, 6);
    assert.ok(snapshot.nestSites.every((site) => site.zoneIdentifier === 'B' && site.visibility > 0));
    const pairB = snapshot.cameraPairs.find((pair) => pair.pairIdentifier === 'B');
    assert.equal(pairB.feed.chunkId, 'live-000001-fixture');
});

test('streams an alert and a fresh snapshot when a new chunk is published', async () =>
{
    const stream = await fetch(`${baseUrl}/api/stream`);
    assert.equal(stream.headers.get('content-type'), 'text/event-stream');

    const manifest = JSON.parse(await readFile(new URL('live-chunk.json', fixtureFolder), 'utf8'));
    const nextFolder = join(publicRoot, 'live-000002-second');
    await cp(fixtureFolder, nextFolder, { recursive: true });
    await writeFile(join(nextFolder, 'live-chunk.json'), JSON.stringify({ ...manifest, chunk_id: 'live-000002-second', sequence: 2 }));

    const waiting = waitForEvent(stream, (eventName, data) => eventName === 'alert' && data.zoneIdentifier === 'C');
    await dashboard.ingestNewChunks();
    const { data: alert } = await waiting;
    assert.equal(alert.text, 'Digging activity detected; nesting unresolved.');
    assert.match(alert.nestIdentifier, /^NT-00(0[7-9]|1[0-2])$/);

    const snapshot = await (await fetch(`${baseUrl}/api/snapshot`)).json();
    assert.equal(snapshot.nestSites.length, 12);
});

test('accepts patrol entries from the dashboard and rejects other origins', async () =>
{
    const post = (body, headers = {}) => fetch(`${baseUrl}/api/nest-sites/NT-0001/patrol-entries`,
    {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5180', ...headers },
        body: JSON.stringify(body),
    });

    assert.equal((await post({ type: 'patrolVisit', author: 'Test Patrol' }, { Origin: 'http://evil.example' })).status, 403);
    assert.equal((await post({ type: 'patrolVisit', author: 'Test Patrol' }, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await post({ type: 'nestConfirmed' })).status, 400);

    const accepted = await post({ type: 'protectionInstalled', author: 'Test Patrol', note: 'Stakes up' });
    assert.equal(accepted.status, 201);
    const { site } = await accepted.json();
    assert.equal(site.events.at(-1).type, 'protectionInstalled');

    const snapshot = await (await fetch(`${baseUrl}/api/snapshot`)).json();
    assert.equal(snapshot.nestSites.find((entry) => entry.nestIdentifier === 'NT-0001').events.at(-1).author, 'Test Patrol');
});

test('serves clips only from accepted chunks, with byte ranges', async () =>
{
    const whole = await fetch(`${baseUrl}/media/live-000001-fixture/camera-0.mp4`);
    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get('content-type'), 'video/mp4');

    const part = await fetch(`${baseUrl}/media/live-000001-fixture/camera-0.mp4`, { headers: { Range: 'bytes=0-3' } });
    assert.equal(part.status, 206);
    assert.equal(await part.text(), 'fake');

    assert.equal((await fetch(`${baseUrl}/media/live-000001-fixture/live-chunk.json`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/media/live-000099-unknown/camera-0.mp4`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/media/live-000001-fixture/..%2F..%2Fprivate%2Ftruth.json`)).status, 404);
});
