// Records every camera's frames to disk as video segments.
//
// Frames arrive whenever a phone manages to send them, so the recorder lays
// them onto a fixed frame-rate timeline tied to the wall clock: a slot with
// no new frame repeats the previous one. A video second is a real second,
// which the detector relies on.
//
// Each segment is an MJPEG .avi (the phone's JPEGs stored as-is, which needs
// no encoder and is readable by OpenCV), plus a .json sidecar with the real
// start time. If ffmpeg is installed, finished segments are converted to
// H.264 .mp4, about ten times smaller and playable in browsers.
//
// Layout: <directory>/<camera>/<YYYY-MM-DD>/<camera>_<start time>.{avi|mp4,json}

import { open, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, relative, sep } from 'node:path';

// Start a new segment rather than fill a gap this long with a frozen frame.
const maximumGapMilliseconds = 10_000;
// AVI 1.0 files must stay under 1 GB for many readers.
const maximumSegmentBytes = 900 * 1024 * 1024;
// Header layout written by aviHeader(); positions of the fields patched on close.
const aviHeaderBytes = 224;
const moviFourccPosition = 220;

export async function createRecorder(
{
    directory,
    framesPerSecond = 5,
    segmentMinutes = 10,
    retentionHours = 72,
    ffmpegPath = 'ffmpeg',
})
{
    await mkdir(directory, { recursive: true });

    const segmentMilliseconds = segmentMinutes * 60_000;
    const hasFfmpeg = await canRun(ffmpegPath, ['-version']);
    // cameraIdentifier -> open segment
    const segments = new Map();
    let conversionQueue = Promise.resolve();

    function addFrame(cameraIdentifier, frame, receivedAt)
    {
        const size = jpegSize(frame);

        if (!size)
        {
            return;
        }

        let segment = segments.get(cameraIdentifier);

        if (segment && (
            receivedAt - segment.lastFrameAt > maximumGapMilliseconds
            || receivedAt - segment.startedAt >= segmentMilliseconds
            || segment.position > maximumSegmentBytes
            || size.width !== segment.width
            || size.height !== segment.height))
        {
            closeSegment(segment);
            segment = null;
        }

        if (!segment)
        {
            segment = openSegment(cameraIdentifier, receivedAt, size);
        }

        // Which slot on the timeline this frame belongs in. Fill any skipped
        // slots with the previous frame; extra frames within one slot are dropped.
        const slot = Math.floor((receivedAt - segment.startedAt) * framesPerSecond / 1000);

        while (segment.frameCount < slot)
        {
            writeChunk(segment, segment.lastFrame);
        }

        if (segment.frameCount === slot)
        {
            writeChunk(segment, frame);
        }

        segment.lastFrame = frame;
        segment.lastFrameAt = receivedAt;
    }

    function openSegment(cameraIdentifier, startedAt, size)
    {
        const startText = new Date(startedAt).toISOString();
        const folder = join(directory, cameraIdentifier, startText.slice(0, 10));
        const baseName = `${cameraIdentifier}_${startText.replace(/[:.]/g, '-')}`;

        const segment =
        {
            cameraIdentifier,
            startedAt,
            folder,
            baseName,
            width: size.width,
            height: size.height,
            frameCount: 0,
            largestChunk: 0,
            index: [],
            position: aviHeaderBytes,
            lastFrame: null,
            lastFrameAt: startedAt,
            failed: false,
            handle: null,
        };

        // All file work for a segment runs in order on this chain.
        segment.work = (async function createFile()
        {
            await mkdir(folder, { recursive: true });
            segment.handle = await open(join(folder, `${baseName}.avi.part`), 'w');
            await segment.handle.write(aviHeader(segment.width, segment.height, framesPerSecond));
        })();

        segments.set(cameraIdentifier, segment);
        return segment;
    }

    function queue(segment, task)
    {
        segment.work = segment.work.then(function runTask()
        {
            return segment.failed ? undefined : task();
        }).catch(function recordFailure(error)
        {
            // Usually a full disk. Stop writing this segment; the next one tries again.
            segment.failed = true;
            console.error(`Recording ${segment.cameraIdentifier} failed:`, error.message);
        });
    }

    function writeChunk(segment, frame)
    {
        const padding = frame.length % 2;
        const chunkHeader = Buffer.alloc(8);
        chunkHeader.write('00dc', 0, 'latin1');
        chunkHeader.writeUInt32LE(frame.length, 4);

        segment.index.push({ offset: segment.position - moviFourccPosition, length: frame.length });
        segment.position += 8 + frame.length + padding;
        segment.frameCount += 1;
        segment.largestChunk = Math.max(segment.largestChunk, frame.length);

        queue(segment, function writeFrame()
        {
            const parts = padding ? [chunkHeader, frame, Buffer.alloc(1)] : [chunkHeader, frame];
            return segment.handle.writev(parts);
        });
    }

    function closeSegment(segment)
    {
        segments.delete(segment.cameraIdentifier);

        queue(segment, async function finishFile()
        {
            await finishAvi(segment, framesPerSecond);
            await segment.handle.close();

            const aviPath = join(segment.folder, `${segment.baseName}.avi`);
            await rename(join(segment.folder, `${segment.baseName}.avi.part`), aviPath);

            const durationSeconds = segment.frameCount / framesPerSecond;
            const metadata =
            {
                cameraIdentifier: segment.cameraIdentifier,
                startedAt: new Date(segment.startedAt).toISOString(),
                endedAt: new Date(segment.startedAt + durationSeconds * 1000).toISOString(),
                durationSeconds,
                framesPerSecond,
                frameCount: segment.frameCount,
                width: segment.width,
                height: segment.height,
                file: `${segment.baseName}.avi`,
            };
            await writeFile(join(segment.folder, `${segment.baseName}.json`), JSON.stringify(metadata, null, 2));
            queueConversion(segment.folder, segment.baseName);
        });

        return segment.work;
    }

    // Converts a finished .avi to .mp4 (one at a time, so cameras don't fight for CPU).
    function queueConversion(folder, baseName)
    {
        if (!hasFfmpeg)
        {
            return;
        }

        conversionQueue = conversionQueue.then(async function convert()
        {
            const aviPath = join(folder, `${baseName}.avi`);
            const mp4Path = join(folder, `${baseName}.mp4`);
            const converted = await canRun(ffmpegPath,
            [
                '-y', '-loglevel', 'error', '-i', aviPath,
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p',
                // Even width and height, which yuv420p requires.
                '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
                '-movflags', '+faststart', mp4Path,
            ]);

            if (!converted)
            {
                console.error(`Could not convert ${aviPath} to mp4; keeping the .avi.`);
                await rm(mp4Path, { force: true });
                return;
            }

            const metadataPath = join(folder, `${baseName}.json`);
            const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
            metadata.file = `${baseName}.mp4`;
            await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
            await rm(aviPath, { force: true });
        }).catch(function reportConversionFailure(error)
        {
            console.error('Conversion failed:', error.message);
        });
    }

    // Newest first. Each entry's `path` is relative to the recordings directory.
    async function listRecordings({ cameraIdentifier, limit = 200 } = {})
    {
        const recordings = [];

        for (const metadataPath of await findFiles(directory, '.json'))
        {
            try
            {
                const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));

                if (cameraIdentifier && metadata.cameraIdentifier !== cameraIdentifier)
                {
                    continue;
                }

                const videoPath = join(metadataPath, '..', metadata.file);
                const videoStats = await stat(videoPath);
                recordings.push(
                {
                    ...metadata,
                    path: relative(directory, videoPath).split(sep).join('/'),
                    sizeBytes: videoStats.size,
                });
            }
            catch
            {
                // Half-written or removed while listing; skip it.
            }
        }

        recordings.sort(function newestFirst(first, second)
        {
            return second.startedAt.localeCompare(first.startedAt);
        });

        return recordings.slice(0, limit);
    }

    async function deleteExpired()
    {
        const cutoff = Date.now() - retentionHours * 3_600_000;

        for (const metadataPath of await findFiles(directory, '.json'))
        {
            try
            {
                const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));

                if (Date.parse(metadata.endedAt) < cutoff)
                {
                    const baseName = metadataPath.slice(0, -'.json'.length);
                    await Promise.all(['.avi', '.mp4', '.json'].map(function remove(extension)
                    {
                        return rm(baseName + extension, { force: true });
                    }));
                }
            }
            catch
            {
                // Skip anything unreadable; it is retried next sweep.
            }
        }
    }

    // Close segments whose camera stopped sending, and sweep old recordings.
    const idleTimer = setInterval(function closeIdleSegments()
    {
        for (const segment of [...segments.values()])
        {
            if (Date.now() - segment.lastFrameAt > maximumGapMilliseconds)
            {
                closeSegment(segment);
            }
        }
    }, 5_000);
    const retentionTimer = setInterval(deleteExpired, 10 * 60_000);
    idleTimer.unref();
    retentionTimer.unref();
    deleteExpired();

    // Convert segments left as .avi by an earlier run (stopped mid-conversion, or ffmpeg added since).
    for (const metadataPath of await findFiles(directory, '.json'))
    {
        try
        {
            const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));

            if (metadata.file.endsWith('.avi'))
            {
                queueConversion(join(metadataPath, '..'), metadata.file.slice(0, -'.avi'.length));
            }
        }
        catch
        {
            // Not a recording sidecar.
        }
    }

    return {
        hasFfmpeg,
        directory,
        addFrame,
        listRecordings,
        isRecording(cameraIdentifier)
        {
            return segments.has(cameraIdentifier);
        },
        // Finish every open segment so the files are playable. Call before exiting.
        async closeAll()
        {
            clearInterval(idleTimer);
            clearInterval(retentionTimer);
            await Promise.all([...segments.values()].map(closeSegment));
        },
    };
}

// Fills in the frame counts, sizes and index that are only known at the end.
async function finishAvi(segment, framesPerSecond)
{
    const index = Buffer.alloc(8 + segment.index.length * 16);
    index.write('idx1', 0, 'latin1');
    index.writeUInt32LE(segment.index.length * 16, 4);
    segment.index.forEach(function writeEntry(entry, entryNumber)
    {
        const at = 8 + entryNumber * 16;
        index.write('00dc', at, 'latin1');
        index.writeUInt32LE(0x10, at + 4); // keyframe: every JPEG stands alone
        index.writeUInt32LE(entry.offset, at + 8);
        index.writeUInt32LE(entry.length, at + 12);
    });
    await segment.handle.write(index, 0, index.length, segment.position);

    const fileSize = segment.position + index.length;
    const bufferSize = segment.largestChunk + 8;
    const patches =
    [
        [4, fileSize - 8],                                   // RIFF size
        [48, segment.frameCount],                            // avih total frames
        [36, Math.ceil(bufferSize * framesPerSecond)],       // avih max bytes per second
        [60, bufferSize],                                    // avih suggested buffer
        [140, segment.frameCount],                           // strh length
        [144, bufferSize],                                   // strh suggested buffer
        [216, segment.position - moviFourccPosition],        // movi list size
    ];

    for (const [position, value] of patches)
    {
        const field = Buffer.alloc(4);
        field.writeUInt32LE(value);
        await segment.handle.write(field, 0, 4, position);
    }
}

// RIFF/AVI header for one MJPEG video stream. Counts are zero until finishAvi().
function aviHeader(width, height, framesPerSecond)
{
    const header = Buffer.alloc(aviHeaderBytes);
    let at = 0;

    function fourcc(text)
    {
        header.write(text, at, 'latin1');
        at += 4;
    }

    function u32(value)
    {
        header.writeUInt32LE(value >>> 0, at);
        at += 4;
    }

    function u16(value)
    {
        header.writeUInt16LE(value, at);
        at += 2;
    }

    fourcc('RIFF'); u32(0); fourcc('AVI ');
    fourcc('LIST'); u32(192); fourcc('hdrl');

    fourcc('avih'); u32(56);
    u32(Math.round(1_000_000 / framesPerSecond)); // microseconds per frame
    u32(0);          // max bytes per second
    u32(0);          // padding granularity
    u32(0x10);       // AVIF_HASINDEX
    u32(0);          // total frames
    u32(0);          // initial frames
    u32(1);          // streams
    u32(0);          // suggested buffer size
    u32(width);
    u32(height);
    at += 16;        // reserved

    fourcc('LIST'); u32(116); fourcc('strl');

    fourcc('strh'); u32(56);
    fourcc('vids'); fourcc('MJPG');
    u32(0);          // flags
    u16(0); u16(0);  // priority, language
    u32(0);          // initial frames
    u32(1);          // scale
    u32(framesPerSecond); // rate: frames per second = rate / scale
    u32(0);          // start
    u32(0);          // length in frames
    u32(0);          // suggested buffer size
    u32(0xFFFFFFFF); // quality: default
    u32(0);          // sample size
    u16(0); u16(0); u16(width); u16(height);

    fourcc('strf'); u32(40);
    u32(40);         // BITMAPINFOHEADER size
    u32(width);
    u32(height);
    u16(1);          // planes
    u16(24);         // bits per pixel
    fourcc('MJPG');
    u32(width * height * 3);
    at += 16;        // pixels per meter, colors used, colors important

    fourcc('LIST'); u32(0); fourcc('movi');

    return header;
}

// Reads width and height from a JPEG's start-of-frame marker, or null if it isn't one.
export function jpegSize(jpeg)
{
    let at = 2;

    while (at + 9 < jpeg.length)
    {
        if (jpeg[at] !== 0xFF)
        {
            return null;
        }

        const marker = jpeg[at + 1];
        const length = jpeg.readUInt16BE(at + 2);
        const isStartOfFrame = marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;

        if (isStartOfFrame)
        {
            return { height: jpeg.readUInt16BE(at + 5), width: jpeg.readUInt16BE(at + 7) };
        }

        at += 2 + length;
    }

    return null;
}

async function findFiles(folder, extension)
{
    const entries = await readdir(folder, { withFileTypes: true, recursive: true }).catch(() => []);

    return entries
        .filter(function matches(entry)
        {
            return entry.isFile() && entry.name.endsWith(extension);
        })
        .map(function fullPath(entry)
        {
            return join(entry.parentPath ?? entry.path, entry.name);
        });
}

function canRun(command, args)
{
    return new Promise(function runCommand(resolve)
    {
        const child = spawn(command, args, { stdio: 'ignore' });
        child.on('error', function cannotStart()
        {
            resolve(false);
        });
        child.on('exit', function finished(code)
        {
            resolve(code === 0);
        });
    });
}
