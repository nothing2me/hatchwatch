import { expect } from 'vitest';

// Smallest buffer jpegSize() accepts: SOI, then an SOF0 segment with height and width; the last byte tags the frame.
export function fakeJpeg(width: number, height: number, tag: number, extra = 0): Buffer
{
    return Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        Buffer.alloc(extra, 0x55),
        Buffer.from([tag]),
    ]);
}

// Walks a finished file the way a reader would: header counts, movi chunks, idx1.
export function parseAvi(file: Buffer)
{
    const moviEnd = 220 + file.readUInt32LE(216);
    const frames: Buffer[] = [];
    for (let at = 224; at < moviEnd;)
    {
        expect(file.toString('latin1', at, at + 4)).toBe('00dc');
        const length = file.readUInt32LE(at + 4);
        frames.push(file.subarray(at + 8, at + 8 + length));
        at += 8 + length + (length % 2);
    }
    const entries = file.readUInt32LE(moviEnd + 4) / 16;
    const offsets = Array.from({ length: entries }, (_, i) => file.readUInt32LE(moviEnd + 8 + i * 16 + 8));
    return {
        riff: file.toString('latin1', 0, 4), form: file.toString('latin1', 8, 12), riffSize: file.readUInt32LE(4), size: file.length,
        microsPerFrame: file.readUInt32LE(32), totalFrames: file.readUInt32LE(48), width: file.readUInt32LE(64), height: file.readUInt32LE(68),
        handler: file.toString('latin1', 112, 116), rate: file.readUInt32LE(132), streamLength: file.readUInt32LE(140),
        movi: file.toString('latin1', 220, 224), idx1: file.toString('latin1', moviEnd, moviEnd + 4), offsets, frames,
    };
}
