import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'server-only';
import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { asCameraMask, toPixels, type MaskPoint } from './masks';
import { masksRoot, readDefaultMasks, type MaskEntry } from './maskStore';

// Keeps the research runner's camera-masks.json in step with the per-camera masks in
// the database. The frozen runner (pipeline/extract.py) reads only cameras[] by slot,
// so those entries are derived; by_code carries each camera's own mask.

export const RESEARCH_MASKS_SCHEMA = 'hatchwatch.camera_masks';

const MASKS_FILE = 'camera-masks.json';
const LEGACY_FILE = 'camera-masks.legacy.json';

/** The runner slot a dashboard camera feeds: live chunks put slot 0 on odd-numbered cameras, slot 1 on even ones. */
export function researchSlot(code: string): 0 | 1 | null
{
    const match = /^[A-Z]+(\d+)$/.exec(code);
    if (!match)
    {
        return null;
    }
    return Number(match[1]) % 2 === 1 ? 0 : 1;
}

export interface MaskedCamera
{
    code: string;
    mask: MaskPoint[];
    updatedAt: Date;
}

export interface ResearchMasksFile
{
    schema: string;
    version: 1;
    note: string;
    cameras: { camera: 0 | 1; label: string; polygon: [number, number][] }[];
    by_code: Record<string, { polygon: [number, number][]; updated_at: string }>;
}

export function buildResearchMasks(cameras: MaskedCamera[], defaults: MaskEntry[]): ResearchMasksFile
{
    const sorted = [...cameras].sort((a, b) => a.code.localeCompare(b.code));
    const slots = ([0, 1] as const).flatMap(slot =>
    {
        const newest = sorted.filter(camera => researchSlot(camera.code) === slot)
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
        if (newest)
        {
            return [{ camera: slot, label: `From camera ${newest.code} (newest ${slot === 0 ? 'odd' : 'even'}-numbered camera mask)`, polygon: toPixels(newest.mask) }];
        }
        const fallback = defaults.find(entry => entry.camera === slot);
        return fallback ? [{ camera: slot, label: fallback.label ?? `Repository default for camera ${slot}`, polygon: fallback.polygon }] : [];
    });
    return {
        schema: RESEARCH_MASKS_SCHEMA,
        version: 1,
        note: 'Written by the HatchWatch dashboard from per-camera watch areas. by_code: each dashboard camera\'s mask in 1280x720 source-frame pixels. cameras[]: the per-slot masks older runners read (slot 0 = newest odd-numbered camera mask, slot 1 = newest even-numbered one, else the repository default). Operator configuration, never simulator truth. Changing a mask changes the video-to-signal distribution: registered experiments must be re-validated after any mask change.',
        cameras: slots,
        by_code: Object.fromEntries(sorted.map(camera => [camera.code, { polygon: toPixels(camera.mask), updated_at: camera.updatedAt.toISOString() }])),
    };
}

// A file written by the older per-slot editor has no by_code.
function isLegacyFile(path: string): boolean
{
    try
    {
        return !('by_code' in (JSON.parse(readFileSync(path, 'utf8')) as object));
    }
    catch
    {
        return true;
    }
}

/** Rewrites <root>/camera-masks.json from the database. Never throws: a failed write is logged and reported. */
export async function syncResearchMasks(prisma: PrismaClient, liveRoot: string, root: string = masksRoot(liveRoot)): Promise<'written' | 'failed'>
{
    try
    {
        const rows = await prisma.camera.findMany({ where: { maskPolygon: { not: Prisma.DbNull } }, select: { code: true, maskPolygon: true, maskUpdatedAt: true } });
        const cameras = rows.flatMap(row =>
        {
            const mask = asCameraMask(row.maskPolygon);
            return mask ? [{ code: row.code, mask, updatedAt: row.maskUpdatedAt ?? new Date(0) }] : [];
        });
        const payload = buildResearchMasks(cameras, readDefaultMasks());
        mkdirSync(root, { recursive: true });
        const file = resolve(root, MASKS_FILE);
        const legacy = resolve(root, LEGACY_FILE);
        if (existsSync(file) && !existsSync(legacy) && isLegacyFile(file))
        {
            copyFileSync(file, legacy);
        }
        const temporary = resolve(root, `${MASKS_FILE}.tmp-${process.pid}`);
        writeFileSync(temporary, JSON.stringify(payload, null, 2));
        renameSync(temporary, file);
        return 'written';
    }
    catch (error)
    {
        // Usually a read-only or missing masks folder (see MASKS_ROOT in docker-compose.yml).
        console.error('[masks] could not write the research mask file:', (error as NodeJS.ErrnoException).code ?? (error as Error).message);
        return 'failed';
    }
}
