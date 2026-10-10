// NestTrace dashboard backend (its own process and port, separate from the
// simulator's research API on 5174; see agent.md).
//
//   GET  /api/health                         backend, feed and camera status
//   GET  /api/snapshot                       zones, camera pairs, nest sites
//   GET  /api/stream                         server-sent events: "snapshot" and "alert"
//   POST /api/nest-sites/:id/patrol-entries  add a patrol entry to a site's log
//   GET  /media/:chunkId/camera-N.mp4        a camera clip from an accepted chunk
//   /api/cameras/..., /api/recordings/...    phone camera relay (cameraRelay.js)
//   anything else                            the built dashboard from dist/
//
// It polls the simulator's public artifacts for new live chunks through the
// adapter (liveChunkAdapter.js), records them in its own store, fades and
// archives old sites, and pushes every change to connected dashboards.
//
// Phones send JPEG frames to the camera relay, which needs the team access
// key (NESTTRACE_ACCESS_KEY, at least 12 characters; the relay is off without
// it) and records every camera to disk (recorder.js).
//
// Listens on loopback only; `--lan` (npm start) listens on every interface
// so phones can reach it directly. Phone browsers only open the camera on
// HTTPS pages: set TLS_CERT and TLS_KEY unless a proxy in front does TLS.

import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createReadStream, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beachZones, beachCameraPairs } from '../src/data/beachLayout.js';
import { convertChunk, readPublishedChunks } from './liveChunkAdapter.js';
import { NestStore } from './nestStore.js';
import { startDemoPatrol } from './demoPatrol.js';
import { createCameraRelay, isCameraRoute, minimumAccessKeyLength } from './cameraRelay.js';
import { createRecorder } from './recorder.js';
import { serveStatic } from './staticFiles.js';

const serverDirectory = dirname(fileURLToPath(import.meta.url));
const maximumBodyBytes = 4096;
const mediaFileNames = new Set(['camera-0.mp4', 'camera-1.mp4']);

function numberFromEnvironment(name, fallback)
{
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function settingsFromEnvironment()
{
    return {
        // PORT is what container hosts set.
        port: numberFromEnvironment('NESTTRACE_DASHBOARD_API_PORT', numberFromEnvironment('PORT', 5182)),
        host: process.argv.includes('--lan') ? '0.0.0.0' : (process.env.NESTTRACE_DASHBOARD_HOST || '127.0.0.1'),
        tls: process.env.TLS_CERT && process.env.TLS_KEY ? { cert: process.env.TLS_CERT, key: process.env.TLS_KEY } : null,
        distDirectory: resolve(process.env.NESTTRACE_DIST_DIR || join(serverDirectory, '..', 'dist')),
        accessKey: process.env.NESTTRACE_ACCESS_KEY || '',
        recording: process.env.NESTTRACE_RECORDING === 'off' ? null :
        {
            directory: resolve(process.env.NESTTRACE_RECORDINGS_DIR || join(serverDirectory, '..', 'recordings')),
            framesPerSecond: numberFromEnvironment('NESTTRACE_RECORDING_FPS', 5),
            segmentMinutes: numberFromEnvironment('NESTTRACE_SEGMENT_MINUTES', 10),
            retentionHours: numberFromEnvironment('NESTTRACE_RETENTION_HOURS', 72),
            ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
        },
        publicRoot: resolve(process.env.NESTTRACE_PUBLIC_ARTIFACTS || join(serverDirectory, '..', '..', 'artifacts', 'public')),
        dataDirectory: resolve(process.env.NESTTRACE_DASHBOARD_DATA || join(serverDirectory, '..', 'server-data')),
        allowedOrigins: (process.env.NESTTRACE_DASHBOARD_ORIGINS || 'http://localhost:5180,http://127.0.0.1:5180').split(',').map((origin) => origin.trim()),
        demoPatrol: process.env.NESTTRACE_DEMO_PATROL === '1' || process.argv.includes('--demo-patrol'),
        pollSeconds: numberFromEnvironment('NESTTRACE_POLL_SECONDS', 3),
        sweepSeconds: numberFromEnvironment('NESTTRACE_SWEEP_SECONDS', 15),
        store:
        {
            fadeStartMinutes: numberFromEnvironment('NESTTRACE_FADE_START_MINUTES', 5),
            archiveAfterMinutes: numberFromEnvironment('NESTTRACE_ARCHIVE_AFTER_MINUTES', 20),
            cameraStaleMinutes: numberFromEnvironment('NESTTRACE_CAMERA_STALE_MINUTES', 15),
            recentActivityMinutes: numberFromEnvironment('NESTTRACE_RECENT_ACTIVITY_MINUTES', 5),
        },
    };
}

function sendJson(response, statusCode, body)
{
    response.writeHead(statusCode, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
}

async function readJsonBody(request)
{
    let text = '';
    for await (const chunk of request)
    {
        text += chunk;
        if (text.length > maximumBodyBytes)
        {
            throw Object.assign(new Error('Request too large'), { statusCode: 413 });
        }
    }
    try
    {
        return JSON.parse(text);
    }
    catch
    {
        throw Object.assign(new Error('Body must be JSON'), { statusCode: 400 });
    }
}

// Same-origin posts come from a page this server hosted itself (npm start),
// whatever address the browser used to reach it.
function isAllowedOrigin(request, origin, allowedOrigins)
{
    if (allowedOrigins.includes(origin))
    {
        return true;
    }
    try
    {
        return new URL(origin).host === request.headers.host;
    }
    catch
    {
        return false;
    }
}

function alertFor(site, zones)
{
    const zone = zones.find((candidate) => candidate.zoneIdentifier === site.zoneIdentifier);
    return {
        nestIdentifier: site.nestIdentifier,
        zoneIdentifier: site.zoneIdentifier,
        zoneName: zone ? zone.name : site.zoneIdentifier,
        seenByCameras: site.seenByCameras,
        evidenceTier: site.evidenceTier,
        alertRaisedAt: site.alertRaisedAt,
        text: site.events[0].note,
    };
}

export async function createDashboardServer(settings, { now = () => new Date(), log = console.log } = {})
{
    const store = new NestStore({ dataDirectory: settings.dataDirectory, zones: beachZones, cameraPairs: beachCameraPairs, settings: settings.store, now });
    await store.load();

    const streams = new Set();
    const reportedProblems = new Set();

    // The phone camera relay is optional: without an access key nobody may send or watch frames.
    const hasAccessKey = (settings.accessKey ?? '').length >= minimumAccessKeyLength;
    const cameraRelay = hasAccessKey
        ? createCameraRelay({ accessKey: settings.accessKey, recorder: settings.recording ? await createRecorder(settings.recording) : null })
        : null;

    function broadcast(eventName, data)
    {
        const message = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
        for (const response of streams)
        {
            response.write(message);
        }
    }

    store.on('change', (change) =>
    {
        if (change.reason === 'chunk')
        {
            change.newSites.forEach((site) => broadcast('alert', alertFor(site, beachZones)));
        }
        broadcast('snapshot', store.snapshot());
    });

    let ingesting = false;
    async function ingestNewChunks()
    {
        if (ingesting)
        {
            return;
        }
        ingesting = true;
        try
        {
            const { chunks, problems } = await readPublishedChunks(settings.publicRoot, store.processedChunkIdentifiers());
            for (const { chunkId, problem } of problems)
            {
                if (!reportedProblems.has(chunkId))
                {
                    reportedProblems.add(chunkId);
                    log(`[adapter] Skipped ${chunkId}: ${problem}`);
                }
            }
            for (const { manifest, pins } of chunks)
            {
                const newSites = await store.ingestChunk(manifest, convertChunk(manifest, pins, beachZones, beachCameraPairs));
                log(`[adapter] ${manifest.chunk_id}: ${newSites.length} sites in zone ${newSites[0]?.zoneIdentifier ?? '-'}`);
            }
        }
        catch (error)
        {
            log(`[adapter] Poll failed: ${error.message}`);
        }
        finally
        {
            ingesting = false;
        }
    }

    async function sweepAndRefresh()
    {
        try
        {
            const archived = await store.sweep();
            if (archived.length === 0)
            {
                // Fading is time-based, so send a fresh snapshot even when nothing archived.
                broadcast('snapshot', store.snapshot());
            }
        }
        catch (error)
        {
            log(`[store] Sweep failed: ${error.message}`);
        }
    }

    async function serveMedia(request, response, chunkId, fileName)
    {
        if (!store.hasChunk(chunkId) || !mediaFileNames.has(fileName))
        {
            return sendJson(response, 404, { error: 'Not found' });
        }
        const file = join(settings.publicRoot, chunkId, fileName);
        let fileStats;
        try
        {
            fileStats = await stat(file);
        }
        catch
        {
            return sendJson(response, 404, { error: 'Clip no longer kept' });
        }

        let start = 0;
        let end = fileStats.size - 1;
        const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'max-age=3600' };
        const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || '');
        if (request.headers.range)
        {
            if (!range || (range[1] === '' && range[2] === ''))
            {
                return sendJson(response, 416, { error: 'Invalid range' });
            }
            if (range[1] === '')
            {
                start = Math.max(0, fileStats.size - Number(range[2]));
            }
            else
            {
                start = Number(range[1]);
                end = range[2] ? Math.min(Number(range[2]), end) : end;
            }
            if (start > end)
            {
                response.writeHead(416, { 'Content-Range': `bytes */${fileStats.size}` });
                return response.end();
            }
            response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${fileStats.size}`, 'Content-Length': end - start + 1 });
        }
        else
        {
            response.writeHead(200, { ...headers, 'Content-Length': fileStats.size });
        }
        createReadStream(file, { start, end }).pipe(response);
    }

    async function handleRequest(request, response)
    {
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.setHeader('Permissions-Policy', 'camera=(self), microphone=()');
        try
        {
            const url = new URL(request.url, 'http://127.0.0.1');
            const path = url.pathname;

            if (request.method === 'GET' && path === '/api/health')
            {
                const snapshot = store.snapshot();
                return sendJson(response, 200,
                {
                    ok: true,
                    feed: snapshot.feed,
                    sites: snapshot.nestSites.length,
                    demoPatrol: settings.demoPatrol,
                    phoneCameras: Boolean(cameraRelay),
                    recording: Boolean(cameraRelay?.recorder),
                });
            }

            if (request.method === 'GET' && path === '/api/snapshot')
            {
                return sendJson(response, 200, store.snapshot());
            }

            if (request.method === 'GET' && path === '/api/stream')
            {
                response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
                response.write(`retry: 3000\nevent: snapshot\ndata: ${JSON.stringify(store.snapshot())}\n\n`);
                streams.add(response);
                request.on('close', () => streams.delete(response));
                return undefined;
            }

            const patrolMatch = /^\/api\/nest-sites\/(NT-\d{4,})\/patrol-entries$/.exec(path);
            if (patrolMatch && request.method === 'POST')
            {
                // Browsers always send Origin on cross-site POSTs; requiring JSON blocks plain form posts.
                const origin = request.headers.origin;
                if (origin && !isAllowedOrigin(request, origin, settings.allowedOrigins))
                {
                    return sendJson(response, 403, { error: 'Origin not allowed' });
                }
                if (!(request.headers['content-type'] || '').startsWith('application/json'))
                {
                    return sendJson(response, 415, { error: 'Send JSON' });
                }
                const body = await readJsonBody(request);
                const site = await store.addPatrolEntry(patrolMatch[1], body ?? {});
                return sendJson(response, 201, { site });
            }

            const mediaMatch = /^\/media\/(live-[0-9]{6}-[A-Za-z0-9]+)\/([A-Za-z0-9.-]+)$/.exec(path);
            if (mediaMatch && request.method === 'GET')
            {
                return serveMedia(request, response, mediaMatch[1], mediaMatch[2]);
            }

            if (isCameraRoute(path))
            {
                if (!cameraRelay)
                {
                    return sendJson(response, 503, { error: 'Phone cameras are off: start the backend with NESTTRACE_ACCESS_KEY set' });
                }
                return cameraRelay.handle(request, response, url);
            }

            if (settings.distDirectory && !path.startsWith('/api/') && !path.startsWith('/media/'))
            {
                return serveStatic(request, response, url, settings.distDirectory);
            }

            return sendJson(response, 404, { error: 'Not found' });
        }
        catch (error)
        {
            if (!response.headersSent)
            {
                return sendJson(response, error.statusCode || 500, { error: error.statusCode ? error.message : 'Server error' });
            }
            response.end();
            return undefined;
        }
    }

    const server = settings.tls
        ? createHttpsServer({ cert: readFileSync(settings.tls.cert), key: readFileSync(settings.tls.key) }, handleRequest)
        : createHttpServer(handleRequest);

    // A named event (not a comment) so browsers can tell a silent, dead
    // connection from a quiet night and reconnect (see liveDataSource.js).
    const heartbeat = setInterval(() => broadcast('heartbeat', { at: now().toISOString() }), 15000);
    const poller = setInterval(ingestNewChunks, settings.pollSeconds * 1000);
    const sweeper = setInterval(sweepAndRefresh, settings.sweepSeconds * 1000);
    const stopDemoPatrol = settings.demoPatrol ? startDemoPatrol(store) : () => {};

    await ingestNewChunks();
    await store.sweep();

    return {
        server,
        store,
        cameraRelay,
        ingestNewChunks,
        listen(port = settings.port)
        {
            return new Promise((done) => server.listen(port, settings.host || '127.0.0.1', () => done(server.address().port)));
        },
        async close()
        {
            clearInterval(heartbeat);
            clearInterval(poller);
            clearInterval(sweeper);
            stopDemoPatrol();
            for (const response of streams)
            {
                response.end();
            }
            await cameraRelay?.close();
            const closed = new Promise((done) => server.close(done));
            server.closeAllConnections();
            await closed;
            await store.pendingWrite;
        },
    };
}

// Run directly: node server/server.js
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
{
    const settings = settingsFromEnvironment();
    const dashboard = await createDashboardServer(settings);
    const port = await dashboard.listen();
    const isLan = settings.host === '0.0.0.0';
    console.log(`NestTrace dashboard backend: ${settings.tls ? 'https' : 'http'}://${isLan ? 'localhost' : settings.host}:${port}${isLan ? ' (all interfaces)' : ''}`);
    console.log(`  reading live chunks from ${settings.publicRoot}`);
    const recorder = dashboard.cameraRelay?.recorder;
    if (!dashboard.cameraRelay)
    {
        console.log(`  phone cameras OFF (set NESTTRACE_ACCESS_KEY to a secret of at least ${minimumAccessKeyLength} characters)`);
    }
    else
    {
        const recordingNote = recorder
            ? `recording to ${recorder.directory}${recorder.hasFfmpeg ? ' as .mp4' : ' as .avi (install ffmpeg for smaller .mp4 files)'}`
            : 'recording off';
        console.log(`  phone cameras ON (phone page: /camera); ${recordingNote}`);
    }
    console.log(`  storing sites in ${settings.dataDirectory}`);
    console.log(`  sites fade after ${settings.store.fadeStartMinutes} min and leave the live map after ${settings.store.archiveAfterMinutes} min${settings.demoPatrol ? '; demo patrol ON' : ''}`);

    for (const signal of ['SIGINT', 'SIGTERM'])
    {
        process.on(signal, async () =>
        {
            // Finishes the open video files, so Ctrl+C never leaves a broken recording.
            await dashboard.close();
            process.exit(0);
        });
    }
}
