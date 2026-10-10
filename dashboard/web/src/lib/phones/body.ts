// Reads a request body, giving up as soon as it passes `max` bytes (Content-Length may be absent or wrong).
export async function readCapped(request: Request, max: number): Promise<Buffer | 'too-large'>
{
    const declared = Number(request.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > max)
    {
        return 'too-large';
    }
    if (!request.body)
    {
        return Buffer.alloc(0);
    }
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;)
    {
        const { done, value } = await reader.read();
        if (done)
        {
            break;
        }
        size += value.byteLength;
        if (size > max)
        {
            await reader.cancel();
            return 'too-large';
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks);
}

// Every JPEG starts with FF D8.
export function isJpeg(body: Uint8Array): boolean
{
    return body.length >= 4 && body[0] === 0xff && body[1] === 0xd8;
}
