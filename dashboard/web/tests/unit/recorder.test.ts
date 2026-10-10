import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Recorder, recorderSettings, type RecorderOptions, type Sidecar } from '@/lib/phones/recorder';
import { fakeJpeg, parseAvi } from './aviTestUtils';

const T0 = Date.UTC(2026, 9, 10, 7, 5, 9);
const meta = { deviceName: 'Dune phone', cameraCode: 'E1' };

function setup(ffmpeg: 'none' | 'ok' | 'fail' = 'none')
{
    const root = mkdtempSync(join(tmpdir(), 'nt-rec-'));
    const ffmpegPath = join(root, '..', `fake-ffmpeg-${ffmpeg}-${Math.random().toString(36).slice(2)}`);
    // Stands in for ffmpeg: answers -version, then writes "mp4" to its last argument (or fails).
    writeFileSync(ffmpegPath, ffmpeg === 'fail'
        ? '#!/bin/sh\nif [ "$1" = "-version" ]; then exit 0; fi\nexit 1\n'
        : '#!/bin/sh\nif [ "$1" = "-version" ]; then exit 0; fi\nfor last; do :; done\nprintf mp4 > "$last"\n');
    chmodSync(ffmpegPath, 0o755);
    const options: RecorderOptions = { root, fps: 5, segmentMinutes: 10, retentionHours: 72, ffmpegPath };
    return { root, options, make: () => new Recorder(options, ffmpeg !== 'none') };
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
            schema: 'nesttrace.recording', version: 1, deviceId: 'd1', deviceName: 'Dune phone', cameraCode: 'E1',
            startedAt: new Date(T0).toISOString(), endedAt: new Date(T0 + 800).toISOString(), durationS: 0.8, fps: 5, frameCount: 4, width: 960, height: 540, file: '070509.avi',
        });
        const [listed] = await recorder.list();
        expect(listed).toMatchObject({ path: `${base}.avi`, deviceId: 'd1', cameraCode: 'E1', durationS: 0.8, playable: false });
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
            writeFileSync(join(root, `d1/2026-10-01/${name}.json`), JSON.stringify({ schema: 'nesttrace.recording', version: 1, deviceId: 'd1', deviceName: 'p', cameraCode: null, startedAt: new Date(endedAt - 600_000).toISOString(), endedAt: new Date(endedAt).toISOString(), durationS: 600, fps: 5, frameCount: 3000, width: 960, height: 540, file: `${name}.mp4` }));
        };
        write('old', T0 - 73 * 3_600_000);
        write('new', T0 - 71 * 3_600_000);
        expect(await recorder.sweep(T0)).toBe(1);
        expect(existsSync(join(root, 'd1/2026-10-01/old.mp4'))).toBe(false);
        expect(existsSync(join(root, 'd1/2026-10-01/old.json'))).toBe(false);
        expect(existsSync(join(root, 'd1/2026-10-01/new.mp4'))).toBe(true);
    });
});

describe('recorderSettings', () =>
{
    it('reads the environment', () =>
    {
        expect(recorderSettings(env({ RECORDING: 'off' }))).toBeNull();
        expect(recorderSettings(env({ RECORDINGS_ROOT: '/recordings' }))).toEqual({ root: '/recordings', fps: 5, segmentMinutes: 10, retentionHours: 72, ffmpegPath: 'ffmpeg' });
        expect(recorderSettings(env({ RECORDINGS_ROOT: '/r', RECORDING_RETENTION_HOURS: '24', FFMPEG_PATH: '/usr/bin/ffmpeg' }))).toMatchObject({ retentionHours: 24, ffmpegPath: '/usr/bin/ffmpeg' });
        expect(recorderSettings(env({ RECORDINGS_ROOT: '/r', RECORDING_RETENTION_HOURS: 'soon' }))?.retentionHours).toBe(72);
    });
});
