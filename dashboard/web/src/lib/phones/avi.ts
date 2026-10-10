import { open, type FileHandle } from 'node:fs/promises';

// MJPEG in AVI 1.0: the phone's JPEGs stored as-is (no encoder), readable by ffmpeg and OpenCV.
export const AVI_HEADER_BYTES = 224;
const MOVI_FOURCC_AT = 220;
// AVI 1.0 files must stay under 1 GB for many readers.
export const MAX_SEGMENT_BYTES = 900 * 1024 * 1024;

interface IndexEntry
{
    offset: number;
    length: number;
}

export function jpegSize(jpeg: Uint8Array): { width: number; height: number } | null
{
    const view = Buffer.from(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength);
    if (view[0] !== 0xff || view[1] !== 0xd8)
    {
        return null;
    }
    let at = 2;
    while (at + 9 < view.length)
    {
        if (view[at] !== 0xff)
        {
            return null;
        }
        const marker = view[at + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        {
            return { height: view.readUInt16BE(at + 5), width: view.readUInt16BE(at + 7) };
        }
        at += 2 + view.readUInt16BE(at + 2);
    }
    return null;
}

// RIFF/AVI header for one MJPEG stream; counts stay zero until finalize().
export function aviHeader(width: number, height: number, fps: number): Buffer
{
    const header = Buffer.alloc(AVI_HEADER_BYTES);
    let at = 0;
    const fourcc = (text: string) => { header.write(text, at, 'latin1'); at += 4; };
    const u32 = (value: number) => { header.writeUInt32LE(value >>> 0, at); at += 4; };
    const u16 = (value: number) => { header.writeUInt16LE(value, at); at += 2; };

    fourcc('RIFF'); u32(0); fourcc('AVI ');
    fourcc('LIST'); u32(192); fourcc('hdrl');
    fourcc('avih'); u32(56);
    u32(Math.round(1_000_000 / fps)); u32(0); u32(0); u32(0x10); u32(0); u32(0); u32(1); u32(0); u32(width); u32(height);
    at += 16;
    fourcc('LIST'); u32(116); fourcc('strl');
    fourcc('strh'); u32(56); fourcc('vids'); fourcc('MJPG');
    u32(0); u16(0); u16(0); u32(0); u32(1); u32(fps); u32(0); u32(0); u32(0); u32(0xffffffff); u32(0);
    u16(0); u16(0); u16(width); u16(height);
    fourcc('strf'); u32(40);
    u32(40); u32(width); u32(height); u16(1); u16(24); fourcc('MJPG'); u32(width * height * 3);
    at += 16;
    fourcc('LIST'); u32(0); fourcc('movi');
    return header;
}

function aviIndex(entries: IndexEntry[]): Buffer
{
    const index = Buffer.alloc(8 + entries.length * 16);
    index.write('idx1', 0, 'latin1');
    index.writeUInt32LE(entries.length * 16, 4);
    entries.forEach((entry, i) =>
    {
        const at = 8 + i * 16;
        index.write('00dc', at, 'latin1');
        index.writeUInt32LE(0x10, at + 4);   // keyframe: every JPEG stands alone
        index.writeUInt32LE(entry.offset, at + 8);
        index.writeUInt32LE(entry.length, at + 12);
    });
    return index;
}

// Writes idx1 after the last chunk and patches the sizes and counts only known at the end.
async function finalize(handle: FileHandle, index: IndexEntry[], moviEnd: number, largest: number, fps: number): Promise<void>
{
    const tail = aviIndex(index);
    await handle.write(tail, 0, tail.length, moviEnd);
    const buffer = largest + 8;
    const patches: [number, number][] = [
        [4, moviEnd + tail.length - 8], [36, Math.ceil(buffer * fps)], [48, index.length], [60, buffer],
        [140, index.length], [144, buffer], [216, moviEnd - MOVI_FOURCC_AT],
    ];
    for (const [at, value] of patches)
    {
        const field = Buffer.alloc(4);
        field.writeUInt32LE(value >>> 0);
        await handle.write(field, 0, 4, at);
    }
}

export class AviWriter
{
    frameCount = 0;
    bytes = AVI_HEADER_BYTES;
    private largest = 0;
    private index: IndexEntry[] = [];
    private chain: Promise<unknown> = Promise.resolve();
    private failed: Error | null = null;

    private constructor(private handle: FileHandle, private fps: number) {}

    static async create(path: string, width: number, height: number, fps: number): Promise<AviWriter>
    {
        const handle = await open(path, 'w');
        await handle.write(aviHeader(width, height, fps), 0, AVI_HEADER_BYTES, 0);
        return new AviWriter(handle, fps);
    }

    // Queued so frames land in order; a write error (full disk) stops this file only.
    write(jpeg: Buffer): void
    {
        const pad = jpeg.length % 2;
        const head = Buffer.alloc(8);
        head.write('00dc', 0, 'latin1');
        head.writeUInt32LE(jpeg.length, 4);
        const position = this.bytes;
        this.index.push({ offset: position - MOVI_FOURCC_AT, length: jpeg.length });
        this.bytes += 8 + jpeg.length + pad;
        this.frameCount += 1;
        this.largest = Math.max(this.largest, jpeg.length);
        const parts = pad ? [head, jpeg, Buffer.alloc(1)] : [head, jpeg];
        this.enqueue(() => this.handle.writev(parts, position));
    }

    async flush(): Promise<void>
    {
        await this.chain;
    }

    async finish(): Promise<void>
    {
        this.enqueue(() => finalize(this.handle, this.index, this.bytes, this.largest, this.fps));
        await this.chain;
        await this.handle.close();
        if (this.failed)
        {
            throw this.failed;
        }
    }

    // Closes without an index, as a killed process would; tests use it to exercise repairAvi.
    async abandon(): Promise<void>
    {
        await this.chain;
        await this.handle.close();
    }

    private enqueue(task: () => Promise<unknown>): void
    {
        this.chain = this.chain.then(() => (this.failed ? undefined : task())).catch((error: unknown) => { this.failed = error as Error; });
    }
}

// Finishes a segment left without an index (process killed): keeps every whole chunk, drops a torn last one.
export async function repairAvi(path: string, fps: number): Promise<{ frameCount: number } | null>
{
    const handle = await open(path, 'r+');
    try
    {
        const { size } = await handle.stat();
        const head = Buffer.alloc(AVI_HEADER_BYTES);
        await handle.read(head, 0, AVI_HEADER_BYTES, 0);
        if (size < AVI_HEADER_BYTES || head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'AVI ' || head.toString('latin1', MOVI_FOURCC_AT, AVI_HEADER_BYTES) !== 'movi')
        {
            return null;
        }
        const index: IndexEntry[] = [];
        const chunk = Buffer.alloc(8);
        let position = AVI_HEADER_BYTES;
        let largest = 0;
        while (position + 8 <= size)
        {
            await handle.read(chunk, 0, 8, position);
            if (chunk.toString('latin1', 0, 4) !== '00dc')
            {
                break;
            }
            const length = chunk.readUInt32LE(4);
            const next = position + 8 + length + (length % 2);
            if (next > size)
            {
                break;
            }
            index.push({ offset: position - MOVI_FOURCC_AT, length });
            largest = Math.max(largest, length);
            position = next;
        }
        await handle.truncate(position);
        await finalize(handle, index, position, largest, fps);
        return { frameCount: index.length };
    }
    finally
    {
        await handle.close();
    }
}
