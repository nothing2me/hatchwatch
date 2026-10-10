import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { getRecorder, Recorder, recorderSettings, startRecorder, type RecorderOptions, type Sidecar } from '@/lib/phones/recorder';
import { fakeJpeg, parseAvi } from './aviTestUtils';

// Run the fake encoder through Node on every platform; exercise real child exits
// and filesystem writes without depending on a Unix shell on Windows.
vi.mock('node:child_process', async importOriginal =>
{
    const actual = await importOriginal<typeof import('node:child_process')>();
    return { ...actual, spawn: (command: string, args: readonly string[], options: import('node:child_process').SpawnOptions) =>
        command.includes('fake-ffmpeg-')
            ? actual.spawn(process.execPath, [command, ...args], options)
            : actual.spawn(command, args, options) };
});

const T0 = Date.UTC(2026, 9, 10, 7, 5, 9);
const meta = { deviceName: 'Dune phone', cameraCode: 'E1' };

function setup(ffmpeg: 'none' | 'ok' | 'fail' = 'none')
{
    const root = mkdtempSync(join(tmpdir(), 'nt-rec-'));
    const ffmpegPath = join(root, '..', `fake-ffmpeg-${ffmpeg}-${Math.random().toString(36).slice(2)}`);
    // Answers -version, then writes "mp4" to its last argument (or fails).
    writeFileSync(ffmpegPath, `const fs = require('node:fs');
if (process.argv.includes('-version')) process.exit(0);
${ffmpeg === 'fail' ? 'process.exit(1);' : "fs.writeFileSync(process.argv.at(-1), 'mp4');"}
`);
    const options: RecorderOptions = { root, fps: 5, segmentMinutes: 10, retentionHours: 72, ffmpegPath };
    return { root, options, make: (hasFfmpeg = ffmpeg !== 'none') => new Recorder(options, hasFfmpeg) };
}

// Only the variables under test; the rest of ProcessEnv (NODE_ENV) is irrelevant here.
const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;
const sidecar = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Sidecar;
const base = 'd1/2026-10-10/070509';

describe('Recorder', () =>
{
    it('writes an AVI and a sidecar per segment, keeping the .avi without ffmpeg', async () =>
    {
        const { root, make } = setup('none');
        const recorder = make();
        recorder.addFrame('d1', fakeJpeg(960, 540, 1), T0, meta);
        recorder.addFrame('d1', fakeJpeg(960, 540, 2), T0 + 600, { ...meta, cameraCode: 'B1' });
        expect(recorder.isRecording('d1')).toBe(true);
        await recorder.closeAll();
        expect(parseAvi(readFileSync(join(root, `${base}.avi`))).totalFrames).toBe(4);
        expect(sidecar(join(root, `${base}.json`))).toEqual({
            schema: 'hatchwatch.recording', version: 1, deviceId: 'd1', deviceName: 'Dune phone', cameraCode: 'E1',
            startedAt: new Date(T0).toISOString(), endedAt: new Date(T0 + 800).toISOString(), durationS: 0.8, fps: 5, frameCount: 4, width: 960, height: 540, file: '070509.avi',
        });
        const [listed] = await recorder.list();
        expect(listed).toMatchObject({ path: `${base}.avi`, deviceId: 'd1', cameraCode: 'E1', durationS: 0.8, playable: false });
    });

    it('lists sidecars written before the rename (nesttrace.recording) next to new ones, and skips other schemas', async () =>
    {
        const { root, make } = setup('none');
        const recorder = make();
        mkdirSync(join(root, 'd1/2026-10-01'), { recursive: true });
        const write = (name: string, schema: string) =>
        {
            writeFileSync(join(root, `d1/2026-10-01/${name}.mp4`), 'x');
            writeFileSync(join(root, `d1/2026-10-01/${name}.json`), JSON.stringify({ schema, version: 1, deviceId: 'd1', deviceName: 'p', cameraCode: null, startedAt: new Date(T0 - 600_000).toISOString(), endedAt: new Date(T0).toISOString(), durationS: 600, fps: 5, frameCount: 3000, width: 960, height: 540, file: `${name}.mp4` }));
        };
        write('010101', 'nesttrace.recording');
        write('020202', 'hatchwatch.recording');
        write('030303', 'other.recording');
        expect((await recorder.list()).map(item => item.path).sort()).toEqual(['d1/2026-10-01/010101.mp4', 'd1/2026-10-01/020202.mp4']);
    });

    it('converts with ffmpeg, then points the sidecar at the mp4 and deletes the avi', async () =>
    {
        const { root, make } = setup('ok');
        const recorder = make();
        recorder.addFrame('d1', fakeJpeg(960, 540, 1), T0, meta);
        await recorder.closeAll();
        expect(readFileSync(join(root, `${base}.mp4`), 'utf8')).toBe('mp4');
        expect(existsSync(join(root, `${base}.avi`))).toBe(false);
        expect(sidecar(join(root, `${base}.json`)).file).toBe('070509.mp4');
        expect((await recorder.list())[0]).toMatchObject({ path: `${base}.mp4`, playable: true, sizeBytes: 3 });
    });

    it('keeps the avi when ffmpeg fails', async () =>
    {
        const { root, make } = setup('fail');
        const recorder = make();
        recorder.addFrame('d1', fakeJpeg(960, 540, 1), T0, meta);
        await recorder.closeAll();
        expect(existsSync(join(root, `${base}.avi`))).toBe(true);
        expect(existsSync(join(root, `${base}.mp4`))).toBe(false);
        expect(sidecar(join(root, `${base}.json`)).file).toBe('070509.avi');
    });

    it('repairs and converts a segment a killed process left behind', async () =>
    {
        const { root, make } = setup('ok');
        const killed = make();
        for (let i = 0; i < 3; i++)
        {
            killed.addFrame('d1', fakeJpeg(960, 540, i), T0 + i * 200, meta);
        }
        await killed.settled();
        expect(sidecar(join(root, `${base}.json`)).file).toBe('070509.avi.part');
        expect(await killed.list()).toEqual([]);
        // Left by a process that died long ago, not one still writing.
        const old = (Date.now() - 5 * 60_000) / 1000;
        utimesSync(join(root, `${base}.avi.part`), old, old);

        const next = make();
        await next.recover();
        await next.settled();
        const repaired = sidecar(join(root, `${base}.json`));
        expect(repaired).toMatchObject({ file: '070509.mp4', frameCount: 3, endedAt: new Date(T0 + 600).toISOString() });
        expect(existsSync(join(root, `${base}.avi.part`))).toBe(false);
    });

    it('never reuses a file name when a device starts twice in one second', async () =>
    {
        const { root, make } = setup('none');
        const recorder = make();
        recorder.addFrame('d1', fakeJpeg(960, 540, 1), T0, meta);
        recorder.addFrame('d1', fakeJpeg(1280, 720, 2), T0 + 300, meta);
        await recorder.closeAll();
        expect(existsSync(join(root, `${base}.avi`))).toBe(true);
        expect(existsSync(join(root, `${base}-2.avi`))).toBe(true);
    });

    it('deletes recordings that ended more than 72 h ago', async () =>
    {
        const { root, make } = setup('none');
        const recorder = make();
        const write = (name: string, endedAt: number) =>
        {
            mkdirSync(join(root, 'd1/2026-10-01'), { recursive: true });
            writeFileSync(join(root, `d1/2026-10-01/${name}.mp4`), 'x');
            writeFileSync(join(root, `d1/2026-10-01/${name}.json`), JSON.stringify({ schema: 'hatchwatch.recording', version: 1, deviceId: 'd1', deviceName: 'p', cameraCode: null, startedAt: new Date(endedAt - 600_000).toISOString(), endedAt: new Date(endedAt).toISOString(), durationS: 600, fps: 5, frameCount: 3000, width: 960, height: 540, file: `${name}.mp4` }));
        };
        write('old', T0 - 73 * 3_600_000);
        write('new', T0 - 71 * 3_600_000);
        expect(await recorder.sweep(T0)).toBe(1);
        expect(existsSync(join(root, 'd1/2026-10-01/old.mp4'))).toBe(false);
        expect(existsSync(join(root, 'd1/2026-10-01/old.json'))).toBe(false);
        expect(existsSync(join(root, 'd1/2026-10-01/new.mp4'))).toBe(true);
    });
});

describe('Recorder after an interrupted close or past retention', () =>
{
    it('recovers a segment whose close renamed the .avi but died before rewriting the sidecar', async () =>
    {
        const { root, make } = setup('ok');
        const first = make(false);
        for (let i = 0; i < 3; i++)
        {
            first.addFrame('d1', fakeJpeg(960, 540, i), T0 + i * 200, meta);
        }
        await first.closeAll();
        // What a process killed between the rename and the sidecar rewrite leaves behind.
        const opened = sidecar(join(root, `${base}.json`));
        writeFileSync(join(root, `${base}.json`), JSON.stringify({ ...opened, file: '070509.avi.part', endedAt: null, frameCount: 0, durationS: 0 }));
        expect(existsSync(join(root, `${base}.avi.part`))).toBe(false);

        const next = make();
        await next.recover();
        await next.settled();
        expect(sidecar(join(root, `${base}.json`))).toMatchObject({ file: '070509.mp4', frameCount: 3, endedAt: new Date(T0 + 600).toISOString() });
        expect(existsSync(join(root, `${base}.avi`))).toBe(false);
        expect((await next.list())[0]).toMatchObject({ path: `${base}.mp4`, playable: true, durationS: 0.6 });
    });

    it('deletes an expired leftover .avi at start-up instead of converting it', async () =>
    {
        const { root, options } = setup('ok');
        const ended = Date.now() - 73 * 3_600_000;
        mkdirSync(join(root, 'd1/2026-10-01'), { recursive: true });
        writeFileSync(join(root, 'd1/2026-10-01/010203.avi'), 'avi');
        writeFileSync(join(root, 'd1/2026-10-01/010203.json'), JSON.stringify({ schema: 'hatchwatch.recording', version: 1, deviceId: 'd1', deviceName: 'p', cameraCode: null, startedAt: new Date(ended - 600_000).toISOString(), endedAt: new Date(ended).toISOString(), durationS: 600, fps: 5, frameCount: 3000, width: 960, height: 540, file: '010203.avi' }));
        const before = { term: process.listeners('SIGTERM'), int: process.listeners('SIGINT') };
        try
        {
            const recorder = await startRecorder(options);
            await recorder!.settled();
            await new Promise(resolve => setTimeout(resolve, 50));
            await recorder!.settled();
            for (const extension of ['avi', 'mp4', 'json'])
            {
                expect(existsSync(join(root, `d1/2026-10-01/010203.${extension}`))).toBe(false);
            }
        }
        finally
        {
            delete (globalThis as { __hatchwatchRecorder?: Recorder }).__hatchwatchRecorder;
            process.listeners('SIGTERM').filter(listener => !before.term.includes(listener)).forEach(listener => process.off('SIGTERM', listener));
            process.listeners('SIGINT').filter(listener => !before.int.includes(listener)).forEach(listener => process.off('SIGINT', listener));
        }
        expect(getRecorder()).toBeNull();
    });

    it('sweeps video files with no valid sidecar once they are older than retention', async () =>
    {
        const { root, make } = setup('none');
        const recorder = make();
        mkdirSync(join(root, 'd1/2026-10-01'), { recursive: true });
        const orphan = (name: string, age: number) =>
        {
            const path = join(root, `d1/2026-10-01/${name}`);
            writeFileSync(path, 'x');
            utimesSync(path, (T0 - age) / 1000, (T0 - age) / 1000);
            return path;
        };
        const oldMp4 = orphan('old.mp4', 73 * 3_600_000);
        const oldAvi = orphan('corrupt.avi', 73 * 3_600_000);
        writeFileSync(join(root, 'd1/2026-10-01/corrupt.json'), '{not json');
        const freshMp4 = orphan('fresh.mp4', 3_600_000);
        expect(await recorder.sweep(T0)).toBe(2);
        expect(existsSync(oldMp4)).toBe(false);
        expect(existsSync(oldAvi)).toBe(false);
        expect(existsSync(freshMp4)).toBe(true);
    });
});

describe('Recorder sharing a folder', () =>
{
    const reset = () => { delete (globalThis as { __hatchwatchRecorder?: Recorder }).__hatchwatchRecorder; };

    it('leaves a fresh .avi.part alone but recovers an old one', async () =>
    {
        const { root, make } = setup('none');
        const writer = make();
        for (let i = 0; i < 3; i++)
        {
            writer.addFrame('d1', fakeJpeg(960, 540, i), T0 + i * 200, meta);
        }
        await writer.settled();
        const part = join(root, `${base}.avi.part`);

        const other = make();
        await other.recover();
        expect(existsSync(part)).toBe(true);
        expect(sidecar(join(root, `${base}.json`)).file).toBe('070509.avi.part');

        const old = (Date.now() - 5 * 60_000) / 1000;
        utimesSync(part, old, old);
        await other.recover();
        expect(existsSync(part)).toBe(false);
        expect(sidecar(join(root, `${base}.json`))).toMatchObject({ file: '070509.avi', frameCount: 3 });
    });

    it('refuses a second recorder on the same root until the first releases the lock', async () =>
    {
        const { root, options } = setup('none');
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        try
        {
            const first = await startRecorder(options);
            expect(first).not.toBeNull();
            expect(existsSync(join(root, '.recorder.lock'))).toBe(true);
            reset();
            expect(await startRecorder(options)).toBeNull();
            expect(error).toHaveBeenCalledWith(`Recording disabled: another process is recording into ${root}`);
            await first?.closeAll();
            expect(existsSync(join(root, '.recorder.lock'))).toBe(false);
            expect(await startRecorder(options)).not.toBeNull();
        }
        finally
        {
            reset();
            vi.restoreAllMocks();
        }
    });

    it('takes over a stale lock', async () =>
    {
        const { root, options } = setup('none');
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        try
        {
            const lock = join(root, '.recorder.lock');
            writeFileSync(lock, JSON.stringify({ pid: 1, startedAt: 'long ago' }));
            const old = (Date.now() - 10 * 60_000) / 1000;
            utimesSync(lock, old, old);
            expect(await startRecorder(options)).not.toBeNull();
            expect(readFileSync(lock, 'utf8')).toContain(`"pid":${process.pid}`);
        }
        finally
        {
            reset();
            vi.restoreAllMocks();
        }
    });
});

describe('recorderSettings', () =>
{
    it('reads the environment', () =>
    {
        expect(recorderSettings(env({ RECORDING: 'off' }))).toBeNull();
        expect(recorderSettings(env({ RECORDINGS_ROOT: '/recordings' }))).toEqual({ root: resolve('/recordings'), fps: 5, segmentMinutes: 10, retentionHours: 72, ffmpegPath: 'ffmpeg' });
        expect(recorderSettings(env({ RECORDINGS_ROOT: '/r', RECORDING_RETENTION_HOURS: '24', FFMPEG_PATH: '/usr/bin/ffmpeg' }))).toMatchObject({ retentionHours: 24, ffmpegPath: '/usr/bin/ffmpeg' });
        expect(recorderSettings(env({ RECORDINGS_ROOT: '/r', RECORDING_RETENTION_HOURS: 'soon' }))?.retentionHours).toBe(72);
    });
});
