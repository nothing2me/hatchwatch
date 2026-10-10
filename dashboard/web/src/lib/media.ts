import { isAbsolute, relative, resolve, sep } from 'node:path';

// Absolute media directory. Compose sets /media; host dev uses ../media (dashboard/media).
export function mediaRoot(): string
{
    return resolve(process.cwd(), process.env.MEDIA_ROOT || '../media');
}

// Joins a DB-stored relative path onto the media root; null if it would escape the root.
export function resolveMediaPath(relativePath: string, root: string = mediaRoot()): string | null
{
    if (!relativePath || isAbsolute(relativePath))
    {
        return null;
    }
    const full = resolve(root, relativePath);
    const inside = relative(root, full);
    if (!inside || inside.startsWith('..') || inside.split(sep).includes('..') || isAbsolute(inside))
    {
        return null;
    }
    return full;
}
