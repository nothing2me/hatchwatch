// Phone camera relay, mounted by the dashboard backend (server.js).
//
//   GET  /api/cameras                        cameras that have sent a frame
//   POST /api/cameras/:id/frame              a phone sends one JPEG frame
//   GET  /api/cameras/:id/stream.mjpg        watch a camera as an MJPEG stream
//   GET  /api/cameras/:id/latest.jpg         the newest frame (polled by viewers)
//   GET  /api/recordings[?camera=ID]         recorded segments (see recorder.js)
//   GET  /api/recordings/file?path=...       one recording, with byte ranges
//
// Every route needs the team access key, in the x-nesttrace-key header or a
// ?key= query parameter (<img> tags can't send headers).
//
// Nothing here talks to the research simulator, the local research API, or
// the detector (see agent.md).

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';

const maximumFrameBytes = 2 * 1024 * 1024;
// A camera counts as online if it sent a frame this recently.
const onlineWindowMilliseconds = 10_000;
// A viewer polling latest.jpg counts as watching for this long after its last request.
const pollingViewerWindowMilliseconds = 5_000;
// Skip frames for a viewer whose connection has this much unsent data queued.
const maximumViewerBacklogBytes = 4 * 1024 * 1024;
const cameraIdentifierPattern = /^[A-Za-z0-9-]{1,32}$/;
const streamBoundary = 'nesttraceframe';
const recordingContentTypes = { '.mp4': 'video/mp4', '.avi': 'video/x-msvideo' };

export const minimumAccessKeyLength = 12;

export function isCameraRoute(path)
{
    return path === '/api/cameras' || path.startsWith('/api/cameras/')
        || path === '/api/recordings' || path.startsWith('/api/recordings/');
}

function digest(text)
{
    return createHash('sha256').update(text).digest();
}

function sendJson(response, status, body)
{
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
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

// `recorder` is optional (null turns recording off).
export function createCameraRelay({ accessKey, recorder = null })
{
    if (typeof accessKey !== 'string' || accessKey.length < minimumAccessKeyLength)
    {
        throw new Error(`The camera access key must be at least ${minimumAccessKeyLength} characters.`);
    }

    const accessKeyDigest = digest(accessKey);

    // cameraIdentifier -> { frame: Buffer, receivedAt: number, viewers: Set<ServerResponse>, pollingViewers: Map<viewerId, lastSeen> }
    const cameras = new Map();

    function hasValidKey(request, url)
    {
        const presented = request.headers['x-nesttrace-key'] ?? url.searchParams.get('key') ?? '';
        return timingSafeEqual(digest(String(presented)), accessKeyDigest);
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

    function sendLatestFrame(request, response, cameraIdentifier)
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

        if (!recorder || !file.startsWith(recorder.directory + sep) || !recordingContentTypes[extension])
        {
            return sendJson(response, 404, { error: 'Not found' });
        }

        const fileStats = await stat(file).catch(() => null);

        if (!fileStats?.isFile())
        {
            return sendJson(response, 404, { error: 'Not found' });
        }

        const headers = { 'Content-Type': recordingContentTypes[extension], 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store' };

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

    // Answers one request whose path passed isCameraRoute().
    async function handle(request, response, url)
    {
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
            return sendLatestFrame(request, response, cameraIdentifier);
        }

        sendJson(response, 405, { error: 'Method not allowed' });
    }

    // Ends every open stream and finishes the open video files, so stopping
    // the server never leaves a broken recording.
    async function close()
    {
        for (const camera of cameras.values())
        {
            for (const viewer of camera.viewers)
            {
                viewer.end();
            }
        }

        await recorder?.closeAll();
    }

    return { handle, close, recorder };
}
