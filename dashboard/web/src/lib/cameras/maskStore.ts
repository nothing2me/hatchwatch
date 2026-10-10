import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'server-only';

// Camera masks are operator configuration shared with the research runner. Admins
// edit them here; the runner applies them at extraction. Never private truth.
//
// Saved to MASKS_ROOT (artifacts/operator, mounted writable in Compose), so the
// simulator's public output folder can stay read-only for the dashboard. Reads
// fall back to the older shared location in the public folder, then the repo default.

const fallbackConfig = resolve(process.cwd(), '../../config/camera-masks.json');
const MASKS_FILE = 'camera-masks.json';

/** Where admins' masks are saved: MASKS_ROOT, else (older setups) the live public folder. */
export function masksRoot(liveRoot: string, env: NodeJS.ProcessEnv = process.env): string
{
    return env.MASKS_ROOT ? resolve(process.cwd(), env.MASKS_ROOT) : liveRoot;
}

export function publicMasksPath(liveRoot: string): string
{
    return resolve(liveRoot, MASKS_FILE);
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

/** The active mask set: the admin-saved file, else the older public copy, else the repo default. */
export function readMasks(liveRoot: string, root: string = masksRoot(liveRoot)): MasksFile
{
    for (const file of [resolve(root, MASKS_FILE), publicMasksPath(liveRoot)])
    {
        if (existsSync(file))
        {
            return { cameras: parseMasksFile(file), source: 'public' };
        }
    }
    if (existsSync(fallbackConfig))
    {
        return { cameras: parseMasksFile(fallbackConfig), source: 'default' };
    }
    return { cameras: [], source: 'default' };
}

/** Atomically updates one camera's mask in the saved file (tmp + rename), starting from the active set. */
export function writeMask(liveRoot: string, camera: number, polygon: [number, number][], label?: string, root: string = masksRoot(liveRoot)): { ok: true; cameras: MaskEntry[] }
{
    const file = resolve(root, MASKS_FILE);
    const current = readMasks(liveRoot, root).cameras;
    const others = current.filter(entry => entry.camera !== camera);
    const next: MaskEntry[] = [...others, { camera, label, polygon }].sort((a, b) => a.camera - b.camera);
    const payload = {
        schema: 'nesttrace.camera_masks',
        version: 1,
        note: 'Operator-drawn per-camera watch areas in source-frame pixels (1280x720). The runner applies these at extraction: everything outside the polygon is excluded from the motion-signal grid (skies, surf, water, dune edges) while the raw camera feed is unchanged. This is operator configuration, never simulator truth. Changing a mask changes the video-to-signal distribution: registered experiments must be re-validated after any mask change.',
        cameras: next,
    };
    mkdirSync(root, { recursive: true });
    const temporary = resolve(root, `${MASKS_FILE}.tmp-${process.pid}`);
    writeFileSync(temporary, JSON.stringify(payload, null, 2));
    renameSync(temporary, file);
    return { ok: true, cameras: next };
}