import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AVI_HEADER_BYTES, AviWriter, jpegSize, repairAvi } from '@/lib/phones/avi';
import { fakeJpeg, parseAvi } from './aviTestUtils';

const dir = () => mkdtempSync(join(tmpdir(), 'nt-avi-'));

describe('jpegSize', () =>
{
    it('reads width and height from the SOF marker and rejects non-JPEG', () =>
    {
        expect(jpegSize(fakeJpeg(960, 540, 1))).toEqual({ width: 960, height: 540 });
        expect(jpegSize(Buffer.from('not a jpeg at all, really'))).toBeNull();
    });
});

describe('AviWriter', () =>
{
    it('writes a 5 fps MJPEG AVI with counts, padding and an idx1 index', async () =>
    {
        const path = join(dir(), 'a.avi');
        const writer = await AviWriter.create(path, 960, 540, 5);
        const frames = [fakeJpeg(960, 540, 1), fakeJpeg(960, 540, 2, 1), fakeJpeg(960, 540, 3)];
        frames.forEach(frame => writer.write(frame));
        await writer.finish();
        const avi = parseAvi(readFileSync(path));
        expect(avi).toMatchObject({ riff: 'RIFF', form: 'AVI ', movi: 'movi', idx1: 'idx1', handler: 'MJPG', microsPerFrame: 200_000, rate: 5, totalFrames: 3, streamLength: 3, width: 960, height: 540 });
        expect(avi.riffSize).toBe(avi.size - 8);
        expect(avi.frames).toEqual(frames);
        expect(avi.offsets[0]).toBe(AVI_HEADER_BYTES - 220);
        expect(writer.frameCount).toBe(3);
    });

    it('repairs a file cut off mid-write so it reads like a finished one', async () =>
    {
        const path = join(dir(), 'b.avi.part');
        const writer = await AviWriter.create(path, 640, 360, 5);
        const frames = [1, 2, 3].map(tag => fakeJpeg(640, 360, tag));
        frames.forEach(frame => writer.write(frame));
        await writer.flush();
        await writer.abandon();
        appendFileSync(path, Buffer.from([0x30, 0x30, 0x64, 0x63, 0x40, 0, 0, 0, 1, 2, 3]));   // half a fourth chunk
        expect(await repairAvi(path, 5)).toEqual({ frameCount: 3 });
        const avi = parseAvi(readFileSync(path));
        expect(avi.totalFrames).toBe(3);
        expect(avi.idx1).toBe('idx1');
        expect(avi.frames).toEqual(frames);
        expect(await repairAvi(path, 5)).toEqual({ frameCount: 3 });   // idempotent
    });

    it('refuses to repair something that is not one of our AVI files', async () =>
    {
        const path = join(dir(), 'c.avi.part');
        appendFileSync(path, Buffer.alloc(300, 1));
        expect(await repairAvi(path, 5)).toBeNull();
    });
});
