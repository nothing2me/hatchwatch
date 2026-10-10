// The adapter between the continuous simulator and the dashboard.
//
// It reads ONLY reviewed public outputs, through the versioned contract in
// schemas/live-chunk.v1.json: a chunk's live-chunk.json manifest and its
// pins/predictions.json. File names are fixed by the contract, so nothing a
// manifest says can point the dashboard at private artifact folders, simulator
// state, seeds, or evaluator truth (agent.md, "Integration boundary").
//
// It turns each two-camera pin into a dashboard nest site: map position,
// arrival/departure times, which cameras saw it, and a location description.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { detectionAlertText } from '../src/config/nestEvents.js';

export const manifestFileName = 'live-chunk.json';
const chunkFolderPattern = /^live-[0-9]{6}-[A-Za-z0-9]+$/;
const evidenceTiers = ['two_camera', 'single_camera'];

function isFiniteNumber(value)
{
    return typeof value === 'number' && Number.isFinite(value);
}

function isIsoTime(value)
{
    return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

// Checks a manifest against schemas/live-chunk.v1.json. Returns a list of
// problems; an empty list means the manifest can be used.
export function validateManifest(manifest, folderName)
{
    const problems = [];

    if (!manifest || typeof manifest !== 'object')
    {
        return ['manifest is not an object'];
    }
    if (manifest.schema !== 'nesttrace.live-chunk' || manifest.version !== 1)
    {
        problems.push(`unsupported schema ${manifest.schema} v${manifest.version}`);
    }
    if (typeof manifest.chunk_id !== 'string' || !chunkFolderPattern.test(manifest.chunk_id) || manifest.chunk_id !== folderName)
    {
        problems.push('chunk_id must match its folder name');
    }
    if (!Number.isInteger(manifest.sequence) || manifest.sequence < 0)
    {
        problems.push('sequence must be a non-negative integer');
    }
    if (!isIsoTime(manifest.recording_started_at) || !isIsoTime(manifest.published_at))
    {
        problems.push('recording_started_at and published_at must be ISO times');
    }
    if (!isFiniteNumber(manifest.clip_seconds) || manifest.clip_seconds <= 0 || !isFiniteNumber(manifest.fps) || manifest.fps <= 0)
    {
        problems.push('clip_seconds and fps must be positive numbers');
    }
    if (!['synthetic-daylight', 'synthetic-very-dark'].includes(manifest.rendering))
    {
        problems.push('unknown rendering');
    }

    const bounds = manifest.ground_bounds_m;
    if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(isFiniteNumber) || bounds[0] >= bounds[1] || bounds[2] >= bounds[3])
    {
        problems.push('ground_bounds_m must be [x_min, x_max, z_min, z_max]');
    }

    const cameras = manifest.cameras;
    const camerasValid = Array.isArray(cameras)
        && cameras.length === 2
        && cameras.every(function isValidCamera(camera)
        {
            return camera
                && [0, 1].includes(camera.index)
                && ['x_min', 'x_max'].includes(camera.end)
                && camera.video === `camera-${camera.index}.mp4`
                && camera.calibration === `calibration-${camera.index}.json`;
        })
        && cameras[0].index !== cameras[1].index
        && cameras[0].end !== cameras[1].end;
    if (!camerasValid)
    {
        problems.push('cameras must list indexes 0 and 1 with their fixed file names and opposite ends');
    }

    if (manifest.pins !== 'pins/predictions.json')
    {
        problems.push('pins must be pins/predictions.json');
    }

    return problems;
}

// Keeps only well-formed pins; returns { pins, dropped }.
export function validatePins(pinsDocument)
{
    if (!pinsDocument || pinsDocument.schema_version !== 1 || !pinsDocument.methods || !Array.isArray(pinsDocument.methods.pins))
    {
        throw new Error('pins file is not schema_version 1 with methods.pins');
    }

    const pins = [];
    let dropped = 0;

    for (const pin of pinsDocument.methods.pins)
    {
        const isValid = pin
            && typeof pin.id === 'string'
            && Array.isArray(pin.point) && pin.point.length === 2 && pin.point.every(isFiniteNumber)
            && isFiniteNumber(pin.radius_m) && pin.radius_m > 0
            && Array.isArray(pin.interval) && pin.interval.length === 2 && pin.interval.every(isFiniteNumber) && pin.interval[0] <= pin.interval[1]
            && evidenceTiers.includes(pin.evidence_tier)
            && Array.isArray(pin.source_views) && pin.source_views.length > 0 && pin.source_views.every(function isView(view)
            {
                return view === 0 || view === 1;
            });

        if (isValid)
        {
            pins.push(pin);
        }
        else
        {
            dropped += 1;
        }
    }

    return { pins, dropped };
}

function lerp(firstPoint, secondPoint, fraction)
{
    return [
        firstPoint[0] + (secondPoint[0] - firstPoint[0]) * fraction,
        firstPoint[1] + (secondPoint[1] - firstPoint[1]) * fraction,
    ];
}

// Maps a ground point in metres onto a zone's outline on the map image.
// x runs from the camera at x_min's end (the zone's south end) to the north
// end; z runs from the water (z_min) to the dunes (z_max). The zone outline
// is [north-land, south-land, south-water, north-water].
export function worldToMap(point, bounds, zone)
{
    const [xMin, xMax, zMin, zMax] = bounds;
    const alongShore = Math.min(1, Math.max(0, (point[0] - xMin) / (xMax - xMin)));
    const towardDunes = Math.min(1, Math.max(0, (point[1] - zMin) / (zMax - zMin)));
    const [northLand, southLand, southWater, northWater] = zone.outlinePoints;

    const southEdge = lerp(southWater, southLand, towardDunes);
    const northEdge = lerp(northWater, northLand, towardDunes);
    const [x, y] = lerp(southEdge, northEdge, alongShore);

    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

// Live chunks rotate around the beach so every camera pair gets footage.
export function zoneForSequence(sequence, zones)
{
    return zones[sequence % zones.length];
}

// The simulated camera at x_min sits at the zone's south end facing north,
// which is the pair's second camera; the one at x_max is the first.
export function dashboardCameraFor(simulatedCamera, cameraPair)
{
    return simulatedCamera.end === 'x_min' ? cameraPair.cameras[1] : cameraPair.cameras[0];
}

function describeLocation(point, bounds, zone)
{
    const metresFromSouthEnd = Math.round(point[0] - bounds[0]);
    const metresFromWaterSide = Math.round(point[1] - bounds[2]);
    return `${zone.name}: about ${metresFromSouthEnd} m north of the zone's south end, ${metresFromWaterSide} m up from its water side`;
}

function addSeconds(isoTime, seconds)
{
    return new Date(Date.parse(isoTime) + seconds * 1000).toISOString();
}

// Converts a validated chunk into the feed update and the new sites it adds.
// Site identifiers are assigned later by the store.
export function convertChunk(manifest, pins, zones, cameraPairs)
{
    const zone = zoneForSequence(manifest.sequence, zones);
    const cameraPair = cameraPairs.find(function matchesZone(pair)
    {
        return pair.zoneIdentifier === zone.zoneIdentifier;
    });

    const cameraByView = {};
    for (const simulatedCamera of manifest.cameras)
    {
        cameraByView[simulatedCamera.index] =
        {
            cameraIdentifier: dashboardCameraFor(simulatedCamera, cameraPair).cameraIdentifier,
            videoUrl: `/media/${manifest.chunk_id}/${simulatedCamera.video}`,
        };
    }

    const feed =
    {
        pairIdentifier: cameraPair.pairIdentifier,
        chunkId: manifest.chunk_id,
        sequence: manifest.sequence,
        rendering: manifest.rendering,
        recordingStartedAt: manifest.recording_started_at,
        lastFrameTime: addSeconds(manifest.recording_started_at, manifest.clip_seconds),
        publishedAt: manifest.published_at,
        // Ordered like the pair's cameras (first = north end, facing south).
        cameras: cameraPair.cameras.map(function findVideo(camera)
        {
            const view = Object.values(cameraByView).find(function matches(entry)
            {
                return entry.cameraIdentifier === camera.cameraIdentifier;
            });
            return { cameraIdentifier: camera.cameraIdentifier, videoUrl: view ? view.videoUrl : null };
        }),
    };

    const sites = pins.map(function pinToSite(pin)
    {
        const arrivedAt = addSeconds(manifest.recording_started_at, pin.interval[0]);
        const departedAt = addSeconds(manifest.recording_started_at, pin.interval[1]);
        // Listed in the pair's own order (north camera first), like everywhere else.
        const seenByCameras = pin.source_views
            .map(function toIdentifier(view)
            {
                return cameraByView[view].cameraIdentifier;
            })
            .sort();
        const cameraLabel = seenByCameras.length === 2 ? `Cameras ${seenByCameras.join(' + ')}` : `Camera ${seenByCameras[0]} only`;

        return {
            zoneIdentifier: zone.zoneIdentifier,
            position: worldToMap(pin.point, manifest.ground_bounds_m, zone),
            groundPointMetres: { x: Math.round(pin.point[0] * 100) / 100, z: Math.round(pin.point[1] * 100) / 100 },
            radiusMetres: pin.radius_m,
            locationDescription: describeLocation(pin.point, manifest.ground_bounds_m, zone),
            seenByCameras,
            evidenceTier: pin.evidence_tier,
            alertRaisedAt: manifest.published_at,
            source: { chunkId: manifest.chunk_id, pinIdentifier: pin.id, rendering: manifest.rendering },
            events:
            [
                { type: 'detected', time: arrivedAt, source: 'system', author: cameraLabel, note: detectionAlertText },
                { type: 'departed', time: departedAt, source: 'system', author: cameraLabel, note: 'Activity ended; no movement at the site.' },
                // When the pipeline finished and the dashboard was told: the patrol's response clock starts here.
                { type: 'alertRaised', time: manifest.published_at, source: 'system', author: 'Dashboard', note: 'Alert sent to every connected dashboard.' },
            ],
        };
    });

    return { feed, sites };
}

// Reads every complete chunk in the public folder. Folders without a manifest
// are still being written and are skipped; invalid ones are reported.
export async function readPublishedChunks(publicRoot, alreadyProcessed)
{
    let folderNames = [];
    try
    {
        folderNames = await readdir(publicRoot);
    }
    catch
    {
        return { chunks: [], problems: [] };
    }

    const chunks = [];
    const problems = [];

    for (const folderName of folderNames)
    {
        if (!chunkFolderPattern.test(folderName) || alreadyProcessed.has(folderName))
        {
            continue;
        }

        let manifest;
        try
        {
            manifest = JSON.parse(await readFile(join(publicRoot, folderName, manifestFileName), 'utf8'));
        }
        catch (error)
        {
            if (error.code !== 'ENOENT')
            {
                problems.push({ chunkId: folderName, problem: `unreadable manifest: ${error.message}` });
            }
            continue;
        }

        const manifestProblems = validateManifest(manifest, folderName);
        if (manifestProblems.length > 0)
        {
            problems.push({ chunkId: folderName, problem: manifestProblems.join('; ') });
            continue;
        }

        try
        {
            const pinsDocument = JSON.parse(await readFile(join(publicRoot, folderName, 'pins', 'predictions.json'), 'utf8'));
            const { pins, dropped } = validatePins(pinsDocument);
            if (dropped > 0)
            {
                problems.push({ chunkId: folderName, problem: `${dropped} malformed pins skipped` });
            }
            chunks.push({ manifest, pins });
        }
        catch (error)
        {
            problems.push({ chunkId: folderName, problem: `pins unusable: ${error.message}` });
        }
    }

    chunks.sort(function bySequence(first, second)
    {
        return first.manifest.sequence - second.manifest.sequence;
    });

    return { chunks, problems };
}
