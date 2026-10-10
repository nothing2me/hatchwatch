// Talks to the camera relay in server/server.mjs. Phones send frames with
// sendFrame(); the dashboard lists cameras and shows each one's MJPEG stream.
//
// The access key is stored in this browser's localStorage so people only
// type it once per device.

const keyStorageName = 'nesttrace.accessKey';

export function loadAccessKey()
{
    try
    {
        return localStorage.getItem(keyStorageName) ?? '';
    }
    catch
    {
        return '';
    }
}

export function saveAccessKey(accessKey)
{
    try
    {
        localStorage.setItem(keyStorageName, accessKey);
    }
    catch
    {
        // Private mode or blocked storage: the key just won't be remembered.
    }
}

// Thrown when the relay rejects the access key, so callers can ask for it again.
export class AccessKeyError extends Error
{
}

// Returns [{ cameraIdentifier, online, lastFrameTime, viewerCount }] for every camera that has sent a frame.
export async function fetchLiveCameras(accessKey)
{
    const response = await fetch('/api/cameras', { headers: { 'X-NestTrace-Key': accessKey } });

    if (response.status === 401)
    {
        throw new AccessKeyError('Wrong access key');
    }

    if (!response.ok)
    {
        throw new Error(`Camera relay returned ${response.status}`);
    }

    return (await response.json()).cameras;
}

// Fetches a camera's newest frame. Pass the frameTag from the previous call
// to get null back (cheaply) when no new frame has arrived since. viewerId
// lets the relay count how many people are watching.
export async function fetchLatestFrame(cameraIdentifier, accessKey, previousFrameTag, viewerId)
{
    const headers = { 'X-NestTrace-Key': accessKey, 'X-NestTrace-Viewer': viewerId };

    if (previousFrameTag)
    {
        headers['If-None-Match'] = previousFrameTag;
    }

    const response = await fetch(`/api/cameras/${encodeURIComponent(cameraIdentifier)}/latest.jpg`, { headers, cache: 'no-store' });

    if (response.status === 304)
    {
        return null;
    }

    if (response.status === 401)
    {
        throw new AccessKeyError('Wrong access key');
    }

    if (!response.ok)
    {
        throw new Error(`Camera relay returned ${response.status}`);
    }

    return { jpeg: await response.blob(), frameTag: response.headers.get('ETag') };
}

// Sends one JPEG frame. Resolves with the number of people watching.
export async function sendFrame(cameraIdentifier, accessKey, jpegBlob)
{
    const response = await fetch(`/api/cameras/${encodeURIComponent(cameraIdentifier)}/frame`,
    {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg', 'X-NestTrace-Key': accessKey },
        body: jpegBlob,
    });

    if (response.status === 401)
    {
        throw new AccessKeyError('Wrong access key');
    }

    if (!response.ok)
    {
        throw new Error(`Camera relay returned ${response.status}`);
    }

    return (await response.json()).viewers;
}

// Returns { enabled, convertsToMp4, recordings: [{ cameraIdentifier, startedAt, durationSeconds, sizeBytes, path, ... }] }, newest first.
export async function fetchRecordings(accessKey, cameraIdentifier)
{
    const query = cameraIdentifier ? `?camera=${encodeURIComponent(cameraIdentifier)}` : '';
    const response = await fetch(`/api/recordings${query}`, { headers: { 'X-NestTrace-Key': accessKey } });

    if (response.status === 401)
    {
        throw new AccessKeyError('Wrong access key');
    }

    if (!response.ok)
    {
        throw new Error(`Camera relay returned ${response.status}`);
    }

    return response.json();
}

export function recordingUrl(recordingPath, accessKey, { download = false } = {})
{
    const base = `/api/recordings/file?path=${encodeURIComponent(recordingPath)}&key=${encodeURIComponent(accessKey)}`;
    return download ? `${base}&download` : base;
}
