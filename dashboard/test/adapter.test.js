// Adapter boundary tests: what the dashboard accepts from the live
// simulator, and how pins become map positions, times, and camera names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beachZones, beachCameraPairs } from '../src/data/beachLayout.js';
import { detectionAlertText } from '../src/config/nestEvents.js';
import { convertChunk, readPublishedChunks, validateManifest, validatePins, worldToMap, zoneForSequence } from '../server/liveChunkAdapter.js';

const fixtureFolder = new URL('./fixtures/live-000001-fixture/', import.meta.url);
const fixtureManifest = JSON.parse(await readFile(new URL('live-chunk.json', fixtureFolder), 'utf8'));
const fixturePins = JSON.parse(await readFile(new URL('pins/predictions.json', fixtureFolder), 'utf8'));
const bounds = fixtureManifest.ground_bounds_m;

function pointInPolygon([x, y], polygon)
{
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++)
    {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
        {
            inside = !inside;
        }
    }
    return inside;
}

test('accepts the fixture manifest', () =>
{
    assert.deepEqual(validateManifest(fixtureManifest, 'live-000001-fixture'), []);
});

test('rejects manifests that break the v1 contract', () =>
{
    const cases =
    {
        'wrong schema': { ...fixtureManifest, schema: 'other' },
        'future version': { ...fixtureManifest, version: 2 },
        'folder mismatch': fixtureManifest,
        'pins path escape': { ...fixtureManifest, pins: '../../private/live-000001-fixture/truth.json' },
        'video path escape': { ...fixtureManifest, cameras: [{ ...fixtureManifest.cameras[0], video: '../private/truth.json' }, fixtureManifest.cameras[1]] },
        'same camera twice': { ...fixtureManifest, cameras: [fixtureManifest.cameras[0], fixtureManifest.cameras[0]] },
        'bad bounds': { ...fixtureManifest, ground_bounds_m: [12, -12, -8, 8] },
        'bad time': { ...fixtureManifest, published_at: 'later' },
        'unknown rendering': { ...fixtureManifest, rendering: 'infrared' },
    };
    for (const [name, manifest] of Object.entries(cases))
    {
        const folder = name === 'folder mismatch' ? 'live-000002-other' : 'live-000001-fixture';
        assert.notDeepEqual(validateManifest(manifest, folder), [], name);
    }
});

test('keeps well-formed pins and drops malformed ones', () =>
{
    const document = structuredClone(fixturePins);
    document.methods.pins.push({ id: 'broken', point: [1], interval: [0, 1], evidence_tier: 'two_camera', source_views: [0, 1], radius_m: 0.9 });
    document.methods.pins.push({ ...document.methods.pins[0], id: 'bad-tier', evidence_tier: 'three_camera' });
    const { pins, dropped } = validatePins(document);
    assert.equal(pins.length, fixturePins.methods.pins.length);
    assert.equal(dropped, 2);
    assert.throws(() => validatePins({ schema_version: 2, methods: { pins: [] } }));
});

test('maps the ground corners onto the zone outline corners', () =>
{
    const zone = beachZones[1];
    const [northLand, southLand, southWater, northWater] = zone.outlinePoints;
    assert.deepEqual(worldToMap([bounds[0], bounds[2]], bounds, zone), { x: southWater[0], y: southWater[1] });
    assert.deepEqual(worldToMap([bounds[0], bounds[3]], bounds, zone), { x: southLand[0], y: southLand[1] });
    assert.deepEqual(worldToMap([bounds[1], bounds[2]], bounds, zone), { x: northWater[0], y: northWater[1] });
    assert.deepEqual(worldToMap([bounds[1], bounds[3]], bounds, zone), { x: northLand[0], y: northLand[1] });
    // Out-of-bounds points are clamped to the zone edge, never placed off the beach.
    assert.deepEqual(worldToMap([99, -99], bounds, zone), { x: northWater[0], y: northWater[1] });
});

test('rotates chunks around all four zones', () =>
{
    assert.deepEqual([0, 1, 2, 3, 4].map((sequence) => zoneForSequence(sequence, beachZones).zoneIdentifier), ['A', 'B', 'C', 'D', 'A']);
});

test('converts every pin into a site inside its zone with logged arrival and departure', () =>
{
    const { pins } = validatePins(fixturePins);
    const { feed, sites } = convertChunk(fixtureManifest, pins, beachZones, beachCameraPairs);
    const zone = zoneForSequence(fixtureManifest.sequence, beachZones);

    assert.equal(sites.length, pins.length);
    assert.equal(feed.pairIdentifier, zone.zoneIdentifier);
    assert.equal(feed.lastFrameTime, '2026-10-09T23:00:40.000Z');

    sites.forEach((site, index) =>
    {
        const pin = pins[index];
        assert.equal(site.zoneIdentifier, zone.zoneIdentifier);
        assert.ok(pointInPolygon([site.position.x, site.position.y], zone.outlinePoints), `${pin.id} lands inside zone ${zone.zoneIdentifier}`);
        assert.equal(site.evidenceTier, pin.evidence_tier);
        assert.equal(site.events[0].type, 'detected');
        assert.equal(site.events[0].note, detectionAlertText);
        assert.equal(site.events[0].time, new Date(Date.parse(fixtureManifest.recording_started_at) + pin.interval[0] * 1000).toISOString());
        assert.equal(site.events[1].type, 'departed');
        assert.equal(site.events[1].time, new Date(Date.parse(fixtureManifest.recording_started_at) + pin.interval[1] * 1000).toISOString());
        assert.equal(site.seenByCameras.length, pin.source_views.length);
        assert.equal(site.source.chunkId, fixtureManifest.chunk_id);
    });
});

test('maps simulated cameras to the right end of the pair', () =>
{
    const { pins } = validatePins(fixturePins);
    const { feed, sites } = convertChunk(fixtureManifest, pins, beachZones, beachCameraPairs);
    // Zone B: camera 0 sits at the south end (B2, facing north), camera 1 at the north end (B1, facing south).
    assert.deepEqual(feed.cameras, [
        { cameraIdentifier: 'B1', videoUrl: '/media/live-000001-fixture/camera-1.mp4' },
        { cameraIdentifier: 'B2', videoUrl: '/media/live-000001-fixture/camera-0.mp4' },
    ]);
    const singleCamera = sites.find((site) => site.evidenceTier === 'single_camera');
    assert.deepEqual(singleCamera.seenByCameras, ['B1']); // source_views [1]
    assert.ok(singleCamera.events[0].author.includes('only'));
});

test('only picks up complete, valid chunks', async () =>
{
    const publicRoot = await mkdtemp(join(tmpdir(), 'nesttrace-adapter-'));
    await cp(fixtureFolder, join(publicRoot, 'live-000001-fixture'), { recursive: true });

    // Still being written: no manifest yet.
    await mkdir(join(publicRoot, 'live-000002-partial', 'pins'), { recursive: true });
    // Not a live chunk at all (research runs share the folder).
    await mkdir(join(publicRoot, 'A-swarm-11-123'), { recursive: true });
    await writeFile(join(publicRoot, 'A-swarm-11-123', 'live-chunk.json'), JSON.stringify(fixtureManifest));
    // A live chunk whose manifest points somewhere it shouldn't.
    await mkdir(join(publicRoot, 'live-000003-evil'), { recursive: true });
    await writeFile(join(publicRoot, 'live-000003-evil', 'live-chunk.json'), JSON.stringify({ ...fixtureManifest, chunk_id: 'live-000003-evil', pins: '../../private/x.json' }));

    const { chunks, problems } = await readPublishedChunks(publicRoot, new Set());
    assert.deepEqual(chunks.map((chunk) => chunk.manifest.chunk_id), ['live-000001-fixture']);
    assert.deepEqual(problems.map((problem) => problem.chunkId), ['live-000003-evil']);

    const again = await readPublishedChunks(publicRoot, new Set(['live-000001-fixture']));
    assert.equal(again.chunks.length, 0);
});
