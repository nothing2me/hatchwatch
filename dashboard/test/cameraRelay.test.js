// The phone camera relay mounted in the dashboard backend: one process
// serves the live feed and the cameras, and the relay stays locked without
// the team access key.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDashboardServer } from '../server/server.js';

const accessKey = 'test-access-key-123';
// Smallest buffer the relay accepts as a JPEG: it only checks the FF D8 start.
const frame = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
const running = [];

async function startBackend(extraSettings)
{
    const dashboard = await createDashboardServer(
    {
        port: 0,
        publicRoot: await mkdtemp(join(tmpdir(), 'nesttrace-public-')),
        dataDirectory: await mkdtemp(join(tmpdir(), 'nesttrace-data-')),
        allowedOrigins: ['http://localhost:5180'],
        demoPatrol: false,
        pollSeconds: 60,
        sweepSeconds: 60,
        store: { fadeStartMinutes: 5, archiveAfterMinutes: 20, cameraStaleMinutes: 15, recentActivityMinutes: 5 },
        ...extraSettings,
    }, { log: () => {} });
    running.push(dashboard);
    return `http://127.0.0.1:${await dashboard.listen(0)}`;
}

after(async () =>
{
    await Promise.all(running.map((dashboard) => dashboard.close()));
});

test('without an access key the feed runs and the camera routes are off', async () =>
{
    const baseUrl = await startBackend({});

    const health = await (await fetch(`${baseUrl}/api/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.phoneCameras, false);
    assert.equal((await fetch(`${baseUrl}/api/snapshot`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/cameras`, { headers: { 'x-nesttrace-key': accessKey } })).status, 503);
});

test('with an access key phones can send frames next to the live feed', async () =>
{
    const baseUrl = await startBackend({ accessKey, recording: null });
    const withKey = { 'x-nesttrace-key': accessKey };

    const health = await (await fetch(`${baseUrl}/api/health`)).json();
    assert.equal(health.phoneCameras, true);
    assert.equal(health.recording, false);
    assert.equal((await fetch(`${baseUrl}/api/snapshot`)).status, 200);

    assert.equal((await fetch(`${baseUrl}/api/cameras/B1/frame`, { method: 'POST', body: frame })).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/cameras/B1/frame`, { method: 'POST', headers: { 'x-nesttrace-key': 'wrong-key-wrong-key' }, body: frame })).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/cameras/B1/frame`, { method: 'POST', headers: withKey, body: Buffer.from('not a jpeg') })).status, 415);

    const sent = await fetch(`${baseUrl}/api/cameras/B1/frame`, { method: 'POST', headers: withKey, body: frame });
    assert.equal(sent.status, 200);

    const { cameras } = await (await fetch(`${baseUrl}/api/cameras`, { headers: withKey })).json();
    assert.deepEqual(cameras.map((camera) => [camera.cameraIdentifier, camera.online]), [['B1', true]]);

    // <img> tags send the key as a query parameter.
    const latest = await fetch(`${baseUrl}/api/cameras/B1/latest.jpg?key=${accessKey}`);
    assert.equal(latest.status, 200);
    assert.equal(latest.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await latest.arrayBuffer()), frame);
    assert.equal((await fetch(`${baseUrl}/api/cameras/B1/latest.jpg?key=${accessKey}`, { headers: { 'if-none-match': latest.headers.get('etag') } })).status, 304);

    const recordings = await (await fetch(`${baseUrl}/api/recordings`, { headers: withKey })).json();
    assert.equal(recordings.enabled, false);
});

test('patrol posts from a page this backend served are same-origin', async () =>
{
    const baseUrl = await startBackend({});
    const host = new URL(baseUrl).host;

    const foreign = await fetch(`${baseUrl}/api/nest-sites/NT-0001/patrol-entries`, { method: 'POST', headers: { origin: 'http://evil.example', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(foreign.status, 403);

    // Passes the origin check, then fails on the unknown site, not with 403.
    const sameOrigin = await fetch(`${baseUrl}/api/nest-sites/NT-0001/patrol-entries`, { method: 'POST', headers: { origin: `http://${host}`, 'content-type': 'application/json' }, body: '{}' });
    assert.notEqual(sameOrigin.status, 403);
});
