import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { LEGACY_RECORDING_SCHEMA } from '@/lib/legacyNames';
import type { RecordingView } from '@/lib/types';
import { AVI_HEADER_BYTES, AviWriter, MAX_SEGMENT_BYTES, repairAvi } from './avi';
import type { FrameRecorder } from './http';
import { recordingsRoot, segmentBase } from './recordingPaths';
import { Segmenter, type SegmentMeta, type SegmentSink, type SegmentStart } from './segmenter';

export interface RecorderOptions
{
    root: string;
    fps: number;
    segmentMinutes: number;
    retentionHours: number;
    ffmpegPath: string;
}

export const RECORDING_SCHEMA = 'hatchwatch.recording';

// Written when a segment opens (file = .avi.part) and rewritten when it closes or converts.
export interface Sidecar
{
    schema: typeof RECORDING_SCHEMA | typeof LEGACY_RECORDING_SCHEMA;
    version: 1;
    deviceId: string;
    deviceName: string;
    cameraCode: string | null;
    startedAt: string;
    endedAt: string | null;
    durationS: number;
    fps: number;
    frameCount: number;
    width: number;
    height: number;
    file: string;
}

const MAX_GAP_MS = 10_000;
// A live writer flushes every 200 ms, so a part file touched this recently belongs to a running recorder.
const LIVE_WRITER_MS = 60_000;
const LOCK_NAME = '.recorder.lock';
const LOCK_STALE_MS = 120_000;
const LOCK_REFRESH_MS = 30_000;

export function recorderSettings(env: NodeJS.ProcessEnv = process.env): RecorderOptions | null
{
    if (env.RECORDING === 'off')
    {
        return null;
    }
    const hours = Number(env.RECORDING_RETENTION_HOURS ?? 72);
    return { root: recordingsRoot(env), fps: 5, segmentMinutes: 10, retentionHours: Number.isFinite(hours) && hours > 0 ? hours : 72, ffmpegPath: env.FFMPEG_PATH || 'ffmpeg' };
}

export function canRun(command: string, args: string[]): Promise<boolean>
{
    return new Promise(resolve =>
    {
        const child = spawn(command, args, { stdio: 'ignore' });
        child.on('error', () => resolve(false));
        child.on('exit', code => resolve(code === 0));
    });
}

async function findFiles(root: string, extensions: string[]): Promise<string[]>
{
    const entries = await readdir(root, { withFileTypes: true, recursive: true }).catch(() => []);
    return entries.filter(entry => entry.isFile() && extensions.some(extension => entry.name.endsWith(extension))).map(entry => join(entry.parentPath, entry.name));
}

const findSidecars = (root: string) => findFiles(root, ['.json']);

async function readSidecar(path: string): Promise<Sidecar | null>
{
    try
    {
        const value = JSON.parse(await readFile(path, 'utf8')) as Sidecar;
        return (value.schema === RECORDING_SCHEMA || value.schema === LEGACY_RECORDING_SCHEMA) && typeof value.file === 'string' && typeof value.startedAt === 'string' ? value : null;
    }
    catch
    {
        return null;
    }
}

async function writeSidecar(base: string, sidecar: Sidecar): Promise<void>
{
    // A rewrite of a sidecar from before the rename is saved under the new id.
    await writeFile(`${base}.json.tmp`, JSON.stringify({ ...sidecar, schema: RECORDING_SCHEMA }, null, 2));
    await rename(`${base}.json.tmp`, `${base}.json`);
}

function sidecarOf(start: SegmentStart, frameCount: number, file: string, closed: boolean): Sidecar
{
    const durationS = frameCount / start.fps;
    return {
        schema: RECORDING_SCHEMA, version: 1, deviceId: start.deviceId, deviceName: start.deviceName, cameraCode: start.cameraCode,
        startedAt: new Date(start.startedAt).toISOString(), endedAt: closed ? new Date(start.startedAt + durationS * 1000).toISOString() : null,
        durationS, fps: start.fps, frameCount, width: start.width, height: start.height, file,
    };
}

export class Recorder implements FrameRecorder
{
    private segmenter: Segmenter;
    private pending = new Set<Promise<void>>();
    private conversions: Promise<void> = Promise.resolve();
    private bases = new Set<string>();
    releaseLock: (() => Promise<void>) | null = null;

    constructor(readonly options: RecorderOptions, readonly hasFfmpeg: boolean)
    {
        this.segmenter = new Segmenter({ fps: options.fps, segmentMs: options.segmentMinutes * 60_000, maxGapMs: MAX_GAP_MS, maxBytes: MAX_SEGMENT_BYTES, open: start => this.openSink(start) });
    }

    addFrame(deviceId: string, jpeg: Buffer, at: number, meta: SegmentMeta): void
    {
        this.segmenter.addFrame(deviceId, jpeg, at, meta);
    }

    isRecording(deviceId: string): boolean
    {
        return this.segmenter.isRecording(deviceId);
    }

    closeIdle(now: number = Date.now()): void
    {
        this.segmenter.closeIdle(now);
    }

    async closeAll(): Promise<void>
    {
        this.segmenter.closeAll();
        await this.settled();
        await this.releaseLock?.();
    }

    // Resolves when every queued file write, close and conversion has finished.
    async settled(): Promise<void>
    {
        while (this.pending.size > 0)
        {
            await Promise.all([...this.pending]);
        }
        await this.conversions;
    }

    // Start-up: finish segments a killed process left as .avi.part, and convert leftover .avi files.
    async recover(): Promise<void>
    {
        for (const path of await findSidecars(this.options.root))
        {
            try
            {
                await this.recoverOne(path);
            }
            catch (error)
            {
                console.error(`Could not recover recording ${path}:`, (error as Error).message);
            }
        }
    }

    private async recoverOne(path: string): Promise<void>
    {
        const sidecar = await readSidecar(path);
        const base = path.slice(0, -'.json'.length);
        if (!sidecar || this.expired(sidecar, Date.now()))
        {
            return;
        }
        if (sidecar.file.endsWith('.avi.part'))
        {
            const part = await stat(`${base}.avi.part`).catch(() => null);
            if (part && Date.now() - part.mtimeMs < LIVE_WRITER_MS)
            {
                // Another process (host dev next to the container) is still writing this segment.
                return;
            }
            // A close killed between its rename and the sidecar rewrite leaves only the .avi; finish from that.
            const source = existsSync(`${base}.avi.part`) ? `${base}.avi.part` : `${base}.avi`;
            const repaired = existsSync(source) ? await repairAvi(source, sidecar.fps).catch(() => null) : null;
            if (!repaired)
            {
                console.error(`Could not repair recording ${source}; leaving it as it is.`);
                return;
            }
            if (source !== `${base}.avi`)
            {
                await rename(source, `${base}.avi`);
            }
            const start = Date.parse(sidecar.startedAt);
            const durationS = repaired.frameCount / sidecar.fps;
            await writeSidecar(base, { ...sidecar, frameCount: repaired.frameCount, durationS, endedAt: new Date(start + durationS * 1000).toISOString(), file: `${basename(base)}.avi` });
            this.queueConversion(base);
        }
        else if (sidecar.file.endsWith('.avi'))
        {
            this.queueConversion(base);
        }
        else if (sidecar.file.endsWith('.mp4'))
        {
            // Converted, but killed before the .avi was deleted.
            await rm(`${base}.avi`, { force: true });
        }
    }

    private expired(sidecar: Sidecar, now: number): boolean
    {
        const end = sidecar.endedAt ? Date.parse(sidecar.endedAt) : Date.parse(sidecar.startedAt) + this.options.segmentMinutes * 60_000;
        return end < now - this.options.retentionHours * 3_600_000;
    }

    // Deletes every recording that ended more than retentionHours before `now`, and any video file no valid
    // sidecar names (orphan, corrupt sidecar) once its mtime is that old. Returns how many recordings and orphans.
    async sweep(now: number = Date.now()): Promise<number>
    {
        const cutoff = now - this.options.retentionHours * 3_600_000;
        let removed = 0;
        const named = new Set<string>();
        for (const path of await findSidecars(this.options.root))
        {
            const sidecar = await readSidecar(path);
            if (!sidecar)
            {
                continue;
            }
            const base = path.slice(0, -'.json'.length);
            if (!this.expired(sidecar, now))
            {
                named.add(join(dirname(path), sidecar.file));
                continue;
            }
            await Promise.all(['.avi.part', '.avi', '.mp4', '.json'].map(extension => rm(base + extension, { force: true })));
            removed += 1;
        }
        for (const video of await findFiles(this.options.root, ['.mp4', '.avi', '.avi.part']))
        {
            if (named.has(video))
            {
                continue;
            }
            const info = await stat(video).catch(() => null);
            if (info && info.mtimeMs < cutoff)
            {
                await rm(video, { force: true });
                removed += 1;
            }
        }
        return removed;
    }

    // Finished segments, newest first; `path` is relative to the root with forward slashes.
    async list(limit = 200): Promise<RecordingView[]>
    {
        const views: RecordingView[] = [];
        for (const path of await findSidecars(this.options.root))
        {
            const sidecar = await readSidecar(path);
            if (!sidecar || sidecar.file.endsWith('.part'))
            {
                continue;
            }
            const video = join(dirname(path), sidecar.file);
            const info = await stat(video).catch(() => null);
            if (!info?.isFile())
            {
                continue;
            }
            views.push({
                path: relative(this.options.root, video).split(sep).join('/'), deviceId: sidecar.deviceId, deviceName: sidecar.deviceName, cameraCode: sidecar.cameraCode,
                startedAt: sidecar.startedAt, durationS: sidecar.durationS, sizeBytes: info.size, playable: sidecar.file.endsWith('.mp4'),
            });
        }
        return views.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
    }

    private baseFor(start: SegmentStart): string
    {
        const plain = join(this.options.root, segmentBase(start.deviceId, start.startedAt));
        for (let n = 1; ; n++)
        {
            const candidate = n === 1 ? plain : `${plain}-${n}`;
            if (!this.bases.has(candidate) && !existsSync(`${candidate}.json`))
            {
                this.bases.add(candidate);
                return candidate;
            }
        }
    }

    private openSink(start: SegmentStart): SegmentSink
    {
        const base = this.baseFor(start);
        const name = basename(base);
        const ready = (async () =>
        {
            await mkdir(dirname(base), { recursive: true });
            await writeSidecar(base, sidecarOf(start, 0, `${name}.avi.part`, false));
            return AviWriter.create(`${base}.avi.part`, start.width, start.height, start.fps);
        })();
        const sink = {
            bytes: AVI_HEADER_BYTES,
            write: (jpeg: Buffer) =>
            {
                sink.bytes += 8 + jpeg.length + (jpeg.length % 2);
                // Tracked until the bytes are on disk, so settled() means "nothing in flight".
                this.track(ready.then(writer => { writer.write(jpeg); return writer.flush(); }));
            },
            close: (frameCount: number) =>
            {
                this.track((async () =>
                {
                    const writer = await ready;
                    await writer.finish();
                    await rename(`${base}.avi.part`, `${base}.avi`);
                    await writeSidecar(base, sidecarOf(start, frameCount, `${name}.avi`, true));
                    this.queueConversion(base);
                })());
            },
        };
        return sink;
    }

    // One conversion at a time so phones never fight for CPU. The sidecar moves to the mp4 before the avi goes.
    private queueConversion(base: string): void
    {
        if (!this.hasFfmpeg)
        {
            return;
        }
        this.conversions = this.conversions.then(async () =>
        {
            const ok = await canRun(this.options.ffmpegPath, [
                '-y', '-loglevel', 'error', '-i', `${base}.avi`,
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p',
                '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-movflags', '+faststart', `${base}.mp4`,
            ]);
            if (!ok)
            {
                console.error(`Could not convert ${base}.avi to mp4; keeping the .avi.`);
                await rm(`${base}.mp4`, { force: true });
                return;
            }
            const sidecar = await readSidecar(`${base}.json`);
            if (!sidecar)
            {
                // Swept while converting: nothing would ever list or expire this mp4.
                await rm(`${base}.mp4`, { force: true });
            }
            else
            {
                await writeSidecar(base, { ...sidecar, file: `${basename(base)}.mp4` });
            }
            await rm(`${base}.avi`, { force: true });
        }).catch((error: unknown) => { console.error('Recording conversion failed:', (error as Error).message); });
    }

    private track(work: Promise<unknown>): void
    {
        const tracked: Promise<void> = work.then(() => undefined, (error: unknown) => { console.error('Recording write failed:', (error as Error).message); })
            .finally(() => { this.pending.delete(tracked); });
        this.pending.add(tracked);
    }
}

// Exclusive lock in the recordings root so two processes never write the same folder. Returns a release function, or null if held.
async function takeLock(root: string): Promise<(() => Promise<void>) | null>
{
    const path = join(root, LOCK_NAME);
    const body = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
    for (let attempt = 0; attempt < 2; attempt++)
    {
        try
        {
            await writeFile(path, body, { flag: 'wx' });
            break;
        }
        catch (error)
        {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
            {
                throw error;
            }
            const info = await stat(path).catch(() => null);
            if (info && Date.now() - info.mtimeMs < LOCK_STALE_MS)
            {
                return null;
            }
            await rm(path, { force: true });
            if (attempt === 1)
            {
                return null;
            }
        }
    }
    const timer = setInterval(() => { void utimes(path, new Date(), new Date()).catch(() => undefined); }, LOCK_REFRESH_MS);
    timer.unref();
    return async () =>
    {
        clearInterval(timer);
        await rm(path, { force: true });
    };
}

const globalRecorder = globalThis as unknown as { __hatchwatchRecorder?: Recorder };

export function getRecorder(): Recorder | null
{
    return globalRecorder.__hatchwatchRecorder ?? null;
}

// Called once from instrumentation.ts in the web process.
export async function startRecorder(options: RecorderOptions): Promise<Recorder | null>
{
    if (globalRecorder.__hatchwatchRecorder)
    {
        return globalRecorder.__hatchwatchRecorder;
    }
    await mkdir(options.root, { recursive: true });
    const releaseLock = await takeLock(options.root);
    if (!releaseLock)
    {
        console.error(`Recording disabled: another process is recording into ${options.root}`);
        return null;
    }
    const recorder = new Recorder(options, await canRun(options.ffmpegPath, ['-version']));
    recorder.releaseLock = releaseLock;
    const sweep = () => recorder.sweep().catch((error: unknown) => { console.error('Recording retention sweep failed:', (error as Error).message); });
    // Sweep before recovering so an expired leftover is deleted rather than queued for conversion.
    await sweep();
    await recorder.recover();
    // Registered only once start-up succeeded, so a failed start leaves recording off rather than half on.
    globalRecorder.__hatchwatchRecorder = recorder;
    setInterval(() => recorder.closeIdle(), 5_000).unref();
    setInterval(() => { void sweep(); }, 3_600_000).unref();
    // Best effort: finish open files on stop (5 s cap). Anything cut off is repaired by recover() next start.
    const stop = () => { void Promise.race([recorder.closeAll(), new Promise(resolve => setTimeout(resolve, 5_000))]).finally(() => process.exit(0)); };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    console.log(`Recording phones to ${options.root}${recorder.hasFfmpeg ? ' (converted to mp4)' : ' as .avi (ffmpeg not found)'}`);
    return recorder;
}
