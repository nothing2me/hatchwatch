// Production server for the NestTrace dashboard.
//
// One Node process, no dependencies:
//   - serves the built dashboard from dist/ (run `npm run build` first)
//   - relays live camera frames: phones open /camera and POST JPEG frames,
//     dashboards watch them as an MJPEG stream.
//   - records every camera to disk in video segments (see recorder.mjs).
//
// Nothing here talks to the research simulator, the local research API, or
// the detector (see agent.md).
//
// Environment:
//   NESTTRACE_ACCESS_KEY  required, at least 12 characters. Phones and viewers
//                         must present it to send or watch frames.
//   PORT                  default 5182
//   TLS_CERT, TLS_KEY     optional PEM file paths. Phone browsers only allow
//                         camera access over HTTPS, so set these unless a host
//                         or proxy in front of this server already does TLS.
//   NESTTRACE_RECORDING            "off" disables recording (default on)
//   NESTTRACE_RECORDINGS_DIR       default dashboard/recordings
//   NESTTRACE_RECORDING_FPS        frames per second in recordings, default 5
//   NESTTRACE_SEGMENT_MINUTES      length of each video file, default 10
//   NESTTRACE_RETENTION_HOURS      recordings older than this are deleted, default 72
//   FFMPEG_PATH                    default "ffmpeg"; without it recordings stay .avi

import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createReadStream, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createRecorder } from './recorder.mjs';

const port = Number(process.env.PORT ?? 5182);
const accessKey = process.env.NESTTRACE_ACCESS_KEY ?? '';
const distDirectory = resolve(fileURLToPath(new URL('../dist', import.meta.url)));

const maximumFrameBytes = 2 * 1024 * 1024;
// A camera counts as online if it sent a frame this recently.
const onlineWindowMilliseconds = 10_000;
// A viewer polling latest.jpg counts as watching for this long after its last request.
const pollingViewerWindowMilliseconds = 5_000;
// Skip frames for a viewer whose connection has this much unsent data queued.
const maximumViewerBacklogBytes = 4 * 1024 * 1024;
const cameraIdentifierPattern = /^[A-Za-z0-9-]{1,32}$/;
const streamBoundary = 'nesttraceframe';

if (accessKey.length < 12)
{
    console.error('Set NESTTRACE_ACCESS_KEY to a secret of at least 12 characters before starting the server.');
    process.exit(1);
}

const accessKeyDigest = digest(accessKey);

const recorder = process.env.NESTTRACE_RECORDING === 'off' ? null : await createRecorder(
{
    directory: resolve(process.env.NESTTRACE_RECORDINGS_DIR ?? fileURLToPath(new URL('../recordings', import.meta.url))),
    framesPerSecond: Number(process.env.NESTTRACE_RECORDING_FPS ?? 5),
    segmentMinutes: Number(process.env.NESTTRACE_SEGMENT_MINUTES ?? 10),
    retentionHours: Number(process.env.NESTTRACE_RETENTION_HOURS ?? 72),
    ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
});

// cameraIdentifier -> { frame: Buffer, receivedAt: number, viewers: Set<ServerResponse>, pollingViewers: Map<viewerId, lastSeen> }
const cameras = new Map();

const contentTypes =
{
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp4': 'video/mp4',
    '.avi': 'video/x-msvideo',
    '.woff2': 'font/woff2',
};

function digest(text)
{
    return createHash('sha256').update(text).digest();
}

// The key comes in a header (fetch) or a query parameter (<img> tags can't send headers).
function hasValidKey(request, url)
{
    const presented = request.headers['x-nesttrace-key'] ?? url.searchParams.get('key') ?? '';
    return timingSafeEqual(digest(String(presented)), accessKeyDigest);
}

function sendJson(response, status, body)
{
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
}

function getCamera(cameraIdentifier)
{
    let camera = cameras.get(cameraIdentifier);

    if (!camera)
    {
        camera = { frame: null, receivedAt: 0, viewers: new Set(), pollingViewers: new Map() };
        cameras.set(cameraIdentifier, camera);
    }

    return camera;
}

// People watching a camera: open MJPEG streams plus viewers that polled latest.jpg recently.
function countViewers(camera)
{
    const cutoff = Date.now() - pollingViewerWindowMilliseconds;

    for (const [viewerId, lastSeen] of camera.pollingViewers)
    {
        if (lastSeen < cutoff)
        {
            camera.pollingViewers.delete(viewerId);
        }
    }

    return camera.viewers.size + camera.pollingViewers.size;
}

function writeFrame(viewer, frame)
{
    viewer.write(`--${streamBoundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
    viewer.write(frame);
    viewer.write('\r\n');
}

function readBody(request, limit)
{
    return new Promise(function collectBody(resolveBody, rejectBody)
    {
        const chunks = [];
        let size = 0;

        request.on('data', function handleChunk(chunk)
        {
            size += chunk.length;

            // Over the limit: keep draining so the client still gets the 413 answer.
            if (size > limit)
            {
                rejectBody(new Error('too large'));
                return;
            }

            chunks.push(chunk);
        });
        request.on('end', function handleEnd()
        {
            resolveBody(Buffer.concat(chunks));
        });
        request.on('error', rejectBody);
    });
}

async function receiveFrame(request, response, cameraIdentifier)
{
    let frame;

    if (Number(request.headers['content-length']) > maximumFrameBytes)
    {
        response.setHeader('Connection', 'close');
        return sendJson(response, 413, { error: 'Frame too large' });
    }

    try
    {
        frame = await readBody(request, maximumFrameBytes);
    }
    catch
    {
        response.setHeader('Connection', 'close');
        return sendJson(response, 413, { error: 'Frame too large' });
    }

    // Every JPEG starts with FF D8.
    if (frame.length < 4 || frame[0] !== 0xFF || frame[1] !== 0xD8)
    {
        return sendJson(response, 415, { error: 'Frames must be JPEG' });
    }

    const camera = getCamera(cameraIdentifier);
    camera.frame = frame;
    camera.receivedAt = Date.now();
    recorder?.addFrame(cameraIdentifier, frame, camera.receivedAt);

    for (const viewer of camera.viewers)
    {
        if (viewer.writableLength < maximumViewerBacklogBytes)
        {
            writeFrame(viewer, frame);
        }
    }

    sendJson(response, 200, { ok: true, viewers: countViewers(camera) });
}

function streamCamera(request, response, cameraIdentifier)
{
    const camera = getCamera(cameraIdentifier);

    response.writeHead(200,
    {
        'Content-Type': `multipart/x-mixed-replace; boundary=${streamBoundary}`,
        'Cache-Control': 'no-store',
        'Connection': 'keep-alive',
        // Stops nginx-style proxies from buffering the stream.
        'X-Accel-Buffering': 'no',
    });

    if (camera.frame)
    {
        writeFrame(response, camera.frame);
    }

    camera.viewers.add(response);
    request.on('close', function removeViewer()
    {
        camera.viewers.delete(response);
    });
}

function listCameras(response)
{
    const now = Date.now();
    const list = [];

    for (const [cameraIdentifier, camera] of cameras)
    {
        if (!camera.frame)
        {
            continue;
        }

        list.push(
        {
            cameraIdentifier,
            online: now - camera.receivedAt < onlineWindowMilliseconds,
            lastFrameTime: new Date(camera.receivedAt).toISOString(),
            viewerCount: countViewers(camera),
            recording: recorder?.isRecording(cameraIdentifier) ?? false,
        });
    }

    sendJson(response, 200, { cameras: list });
}

async function listRecordings(response, url)
{
    if (!recorder)
    {
        return sendJson(response, 200, { enabled: false, recordings: [] });
    }

    const cameraIdentifier = url.searchParams.get('camera') || undefined;
    const recordings = await recorder.listRecordings({ cameraIdentifier });
    sendJson(response, 200, { enabled: true, convertsToMp4: recorder.hasFfmpeg, recordings });
}

// Sends one recording, with byte ranges so the browser's video player can seek.
async function sendRecording(request, response, url)
{
    const requested = url.searchParams.get('path') ?? '';
    const file = recorder ? resolve(recorder.directory, requested) : '';
    const extension = extname(file);

    if (!recorder || !file.startsWith(recorder.directory + sep) || (extension !== '.mp4' && extension !== '.avi'))
    {
        return sendJson(response, 404, { error: 'Not found' });
    }

    const fileStats = await stat(file).catch(() => null);

    if (!fileStats?.isFile())
    {
        return sendJson(response, 404, { error: 'Not found' });
    }

    const headers = { 'Content-Type': contentTypes[extension], 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store' };

    if (url.searchParams.has('download'))
    {
        headers['Content-Disposition'] = `attachment; filename="${file.split(sep).pop()}"`;
    }

    let start = 0;
    let end = fileStats.size - 1;
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');

    if (range && (range[1] || range[2]))
    {
        start = range[1] ? Number(range[1]) : Math.max(0, fileStats.size - Number(range[2]));
        end = range[1] && range[2] ? Math.min(Number(range[2]), end) : end;

        if (start > end)
        {
            response.writeHead(416, { 'Content-Range': `bytes */${fileStats.size}` });
            return response.end();
        }

        headers['Content-Range'] = `bytes ${start}-${end}/${fileStats.size}`;
        response.writeHead(206, { ...headers, 'Content-Length': end - start + 1 });
    }
    else
    {
        response.writeHead(200, { ...headers, 'Content-Length': fileStats.size });
    }

    createReadStream(file, { start, end }).pipe(response);
}

async function handleApi(request, response, url)
{
    if (url.pathname === '/api/health')
    {
        return sendJson(response, 200, { ok: true });
    }

    if (!hasValidKey(request, url))
    {
        return sendJson(response, 401, { error: 'Missing or wrong access key' });
    }

    if (url.pathname === '/api/cameras' && request.method === 'GET')
    {
        return listCameras(response);
    }

    if (url.pathname === '/api/recordings' && request.method === 'GET')
    {
        return listRecordings(response, url);
    }

    if (url.pathname === '/api/recordings/file' && request.method === 'GET')
    {
        return sendRecording(request, response, url);
    }

    const match = /^\/api\/cameras\/([^/]+)\/(frame|stream\.mjpg|latest\.jpg)$/.exec(url.pathname);

    if (!match || !cameraIdentifierPattern.test(match[1]))
    {
        return sendJson(response, 404, { error: 'Not found' });
    }

    const [, cameraIdentifier, action] = match;

    if (action === 'frame' && request.method === 'POST')
    {
        return receiveFrame(request, response, cameraIdentifier);
    }

    if (action === 'stream.mjpg' && request.method === 'GET')
    {
        return streamCamera(request, response, cameraIdentifier);
    }

    if (action === 'latest.jpg' && request.method === 'GET')
    {
        const camera = cameras.get(cameraIdentifier);

        if (!camera?.frame)
        {
            return sendJson(response, 404, { error: 'No frame yet' });
        }

        const viewerId = String(request.headers['x-nesttrace-viewer'] ?? '').slice(0, 64);

        if (viewerId)
        {
            camera.pollingViewers.set(viewerId, Date.now());
        }

        // Viewers poll this several times a second; answer 304 when they already have this frame.
        const frameTag = `"${camera.receivedAt}"`;

        if (request.headers['if-none-match'] === frameTag)
        {
            response.writeHead(304, { 'ETag': frameTag, 'Cache-Control': 'no-store' });
            return response.end();
        }

        response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'ETag': frameTag });
        return response.end(camera.frame);
    }

    sendJson(response, 405, { error: 'Method not allowed' });
}

async function serveStatic(request, response, url)
{
    if (request.method !== 'GET' && request.method !== 'HEAD')
    {
        return sendJson(response, 405, { error: 'Method not allowed' });
    }

    // The phone page is its own entry; everything else falls back to the dashboard.
    const pageAliases = { '/': '/index.html', '/camera': '/camera.html', '/camera/': '/camera.html', '/motion': '/motion.html', '/motion/': '/motion.html' };
    let pathname = pageAliases[url.pathname];

    try
    {
        pathname ??= decodeURIComponent(url.pathname);
    }
    catch
    {
        return sendJson(response, 400, { error: 'Bad path' });
    }

    let file = resolve(join(distDirectory, pathname));

    if (file !== distDirectory && !file.startsWith(distDirectory + sep))
    {
        return sendJson(response, 403, { error: 'Forbidden' });
    }

    let fileStats = await stat(file).catch(() => null);

    if (!fileStats?.isFile())
    {
        file = join(distDirectory, 'index.html');
        fileStats = await stat(file).catch(() => null);

        if (!fileStats)
        {
            return sendJson(response, 503, { error: 'Dashboard not built. Run npm run build.' });
        }
    }

    const isHashedAsset = file.startsWith(join(distDirectory, 'assets') + sep);

    response.writeHead(200,
    {
        'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    response.end(request.method === 'HEAD' ? undefined : await readFile(file));
}

async function handleRequest(request, response)
{
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(self), microphone=()');

    try
    {
        const url = new URL(request.url, 'http://localhost');

        if (url.pathname.startsWith('/api/'))
        {
            await handleApi(request, response, url);
        }
        else
        {
            await serveStatic(request, response, url);
        }
    }
    catch (error)
    {
        console.error(error);

        if (!response.headersSent)
        {
            sendJson(response, 500, { error: 'Server error' });
        }
        else
        {
            response.destroy();
        }
    }
}

const useTls = Boolean(process.env.TLS_CERT && process.env.TLS_KEY);
const server = useTls
    ? createHttpsServer({ cert: readFileSync(process.env.TLS_CERT), key: readFileSync(process.env.TLS_KEY) }, handleRequest)
    : createHttpServer(handleRequest);

server.listen(port, function announce()
{
    console.log(`NestTrace dashboard on ${useTls ? 'https' : 'http'}://localhost:${port} (phone page: /camera)`);

    if (!recorder)
    {
        console.log('Recording is off.');
    }
    else
    {
        console.log(`Recording to ${recorder.directory}${recorder.hasFfmpeg ? ' (converted to .mp4)' : ' as .avi (install ffmpeg for smaller .mp4 files)'}`);
    }
});

// Finish the open video files before exiting, so Ctrl+C never leaves a broken recording.
let isShuttingDown = false;

async function shutDown()
{
    if (isShuttingDown)
    {
        return;
    }

    isShuttingDown = true;
    console.log('Saving open recordings…');
    await recorder?.closeAll();
    process.exit(0);
}

process.on('SIGINT', shutDown);
process.on('SIGTERM', shutDown);
