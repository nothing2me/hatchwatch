import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'server-only';

// Camera masks are shared with the research runner through the PUBLIC artifacts
// directory: the runner seeds artifacts/public/camera-masks.json from config/
// and applies it at extraction; admins edit it here. Never private truth.

const fallbackConfig = resolve(process.cwd(), '../../config/camera-masks.json');

export function publicMasksPath(liveRoot: string): string
{
    return resolve(liveRoot, 'camera-masks.json');
}

export interface MaskEntry
{
    camera: number;
    label?: string;
    polygon: [number, number][];
}

export interface MasksFile
{
    cameras: MaskEntry[];
    source: 'public' | 'default';
}

function parseMasksFile(path: string): MaskEntry[]
{
    const data = JSON.parse(readFileSync(path, 'utf8')) as { cameras?: unknown };
    const cameras = Array.isArray(data.cameras) ? data.cameras : [];
    return cameras.flatMap((entry) =>
    {
        const candidate = entry as { camera?: unknown; polygon?: unknown; label?: unknown };
        if (typeof candidate?.camera !== 'number' || !Array.isArray(candidate.polygon)) return [];
        return [{
            camera: candidate.camera,
            label: typeof candidate.label === 'string' ? candidate.label : undefined,
            polygon: candidate.polygon as [number, number][],
        }];
    });
}

/** The active mask set: the dashboard-edited public file, else the repo default. */
export function readMasks(liveRoot: string): MasksFile
{
    const publicFile = publicMasksPath(liveRoot);
    if (existsSync(publicFile))
    {
        return { cameras: parseMasksFile(publicFile), source: 'public' };
    }
    if (existsSync(fallbackConfig))
    {
        return { cameras: parseMasksFile(fallbackConfig), source: 'default' };
    }
    return { cameras: [], source: 'default' };
}

/** Atomically updates one camera's mask in the shared public file (tmp + rename). */
export function writeMask(liveRoot: string, camera: number, polygon: [number, number][], label?: string): { ok: true; cameras: MaskEntry[] }
{
    const file = publicMasksPath(liveRoot);
    const current = existsSync(file) ? parseMasksFile(file) : (existsSync(fallbackConfig) ? parseMasksFile(fallbackConfig) : []);
    const others = current.filter(entry => entry.camera !== camera);
    const next: MaskEntry[] = [...others, { camera, label, polygon }].sort((a, b) => a.camera - b.camera);
    const payload = {
        schema: 'nesttrace.camera_masks',
        version: 1,
        note: 'Operator-drawn per-camera watch areas in source-frame pixels (1280x720). The runner applies these at extraction: everything outside the polygon is excluded from the motion-signal grid (skies, surf, water, dune edges) while the raw camera feed is unchanged. This is operator configuration, never simulator truth. Changing a mask changes the video-to-signal distribution: registered experiments must be re-validated after any mask change.',
        cameras: next,
    };
    mkdirSync(liveRoot, { recursive: true });
    const temporary = resolve(liveRoot, `camera-masks.json.tmp-${process.pid}`);
    writeFileSync(temporary, JSON.stringify(payload, null, 2));
    renameSync(temporary, file);
    return { ok: true, cameras: next };
}