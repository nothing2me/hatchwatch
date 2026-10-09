import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { mediaRoot, resolveMediaPath } from '@/lib/media';

describe('media paths', () =>
{
    const root = '/srv/media';

    it('resolves a relative path inside the root', () =>
    {
        expect(resolveMediaPath('sim/RUN/camera-0.mp4', root)).toBe('/srv/media/sim/RUN/camera-0.mp4');
    });

    it('rejects traversal and absolute paths', () =>
    {
        expect(resolveMediaPath('../etc/passwd', root)).toBeNull();
        expect(resolveMediaPath('sim/../../etc/passwd', root)).toBeNull();
        expect(resolveMediaPath('/etc/passwd', root)).toBeNull();
        expect(resolveMediaPath('', root)).toBeNull();
    });

    it('mediaRoot is absolute and honours MEDIA_ROOT relative to cwd', () =>
    {
        const previous = process.env.MEDIA_ROOT;
        process.env.MEDIA_ROOT = '../media';
        try
        {
            expect(mediaRoot()).toBe(resolve(process.cwd(), '../media'));
        }
        finally
        {
            process.env.MEDIA_ROOT = previous;
        }
    });
});
