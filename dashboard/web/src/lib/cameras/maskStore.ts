import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'server-only';
import { DEFAULT_MASK } from './masks';

// The research runner's camera-masks.json: operator configuration the runner applies
// at extraction, never private truth. The dashboard writes it from per-camera masks
// (researchMasks.ts) to MASKS_ROOT (artifacts/operator, mounted writable in Compose), so
// the simulator's public output folder can stay read-only for the dashboard. Reads fall
// back to the older shared location in the public folder, then the repo default.

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

export interface CodeMaskEntry
{
    polygon: [number, number][];
    updated_at: string;
}

export interface MasksFile
{
    cameras: MaskEntry[];
    /** Per dashboard camera code, in source-frame pixels; empty in files written before per-camera masks. */
    byCode: Record<string, CodeMaskEntry>;
    source: 'public' | 'default';
}

function parseByCode(data: { by_code?: unknown }): Record<string, CodeMaskEntry>
{
    if (!data.by_code || typeof data.by_code !== 'object' || Array.isArray(data.by_code))
    {
        return {};
    }
    return Object.fromEntries(Object.entries(data.by_code as Record<string, unknown>).flatMap(([code, entry]) =>
    {
        const candidate = entry as { polygon?: unknown; updated_at?: unknown };
        return Array.isArray(candidate?.polygon) && typeof candidate.updated_at === 'string'
            ? [[code, { polygon: candidate.polygon as [number, number][], updated_at: candidate.updated_at }]]
            : [];
    }));
}

function parseMasksFile(path: string): Omit<MasksFile, 'source'>
{
    const data = JSON.parse(readFileSync(path, 'utf8')) as { cameras?: unknown; by_code?: unknown };
    const cameras = Array.isArray(data.cameras) ? data.cameras : [];
    const entries = cameras.flatMap((entry) =>
    {
        const candidate = entry as { camera?: unknown; polygon?: unknown; label?: unknown };
        if (typeof candidate?.camera !== 'number' || !Array.isArray(candidate.polygon)) return [];
        return [{
            camera: candidate.camera,
            label: typeof candidate.label === 'string' ? candidate.label : undefined,
            polygon: candidate.polygon as [number, number][],
        }];
    });
    return { cameras: entries, byCode: parseByCode(data) };
}

/** The repository default per-slot masks (config/camera-masks.json, read only); the same strip built in when the repo is not mounted (Docker). */
export function readDefaultMasks(): MaskEntry[]
{
    if (existsSync(fallbackConfig))
    {
        return parseMasksFile(fallbackConfig).cameras;
    }
    // Live chunks need at least one cameras[] entry, so both slots always have one.
    return [0, 1].map(camera => ({ camera, label: `Repository default for camera ${camera}`, polygon: DEFAULT_MASK.map(([x, y]) => [x, y] as [number, number]) }));
}

/** The active mask set: the admin-saved file, else the older public copy, else the repo default. */
export function readMasks(liveRoot: string, root: string = masksRoot(liveRoot)): MasksFile
{
    for (const file of [resolve(root, MASKS_FILE), publicMasksPath(liveRoot)])
    {
        if (existsSync(file))
        {
            return { ...parseMasksFile(file), source: 'public' };
        }
    }
    return { cameras: readDefaultMasks(), byCode: {}, source: 'default' };
}
