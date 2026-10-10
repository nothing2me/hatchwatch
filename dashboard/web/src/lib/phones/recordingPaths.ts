import { isAbsolute, relative, resolve, sep } from 'node:path';

const LAYOUT = /^[a-z0-9]{1,40}\/\d{4}-\d{2}-\d{2}\/\d{6}(-\d{1,3})?\.(mp4|avi)$/;

export function recordingsRoot(env: NodeJS.ProcessEnv = process.env): string
{
    return resolve(process.cwd(), env.RECORDINGS_ROOT || '../recordings');
}

export function segmentBase(deviceId: string, startedAt: number): string
{
    const iso = new Date(startedAt).toISOString();
    return `${deviceId}/${iso.slice(0, 10)}/${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}`;
}

// Only finished segment files in our own layout; nothing outside the root.
export function resolveRecordingPath(root: string, relativePath: string): string | null
{
    if (!LAYOUT.test(relativePath))
    {
        return null;
    }
    const full = resolve(root, relativePath);
    const inside = relative(root, full);
    if (!inside || inside.startsWith('..') || isAbsolute(inside) || inside.split(sep).includes('..'))
    {
        return null;
    }
    return full;
}
