'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireCurrentUser } from '@/lib/auth/guard';
import {
    addCameraPair as addPair,
    addCameraPairNewZone as addPairNewZone,
    addCameraPairToZone as addPairToZone,
    CameraEditError,
    deleteCamera as removeCamera,
    deleteZone as removeZone,
    moveZone as shiftZone,
    faceOcean as turnToSea,
    mergeZoneInto as mergeZone,
    setCameraSource as saveSource,
    updateCamera as saveCamera,
} from '@/lib/cameras/manage';
import { syncResearchMasks } from '@/lib/cameras/researchMasks';
import { prisma } from '@/lib/db';
import { liveSettings } from '@/lib/live/watcher';
import type { LngLat } from '@/lib/types';

export type PairActionResult = { ok: true; codes: [string, string]; zoneCode: string; newZone: boolean } | { ok: false; error: string };
export type ZoneActionResult = { ok: true; code: string } | { ok: false; error: string };
export type CameraActionResult = { ok: true; code: string } | { ok: false; error: string };
export type FaceOceanResult = { ok: true; codes: string[] } | { ok: false; error: string };
export type MergeActionResult = { ok: true; targetCode: string; moved: { from: string; to: string }[] } | { ok: false; error: string };

const clickSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const cameraCodeSchema = z.string().min(1).max(8);
const zoneCodeSchema = z.string().regex(/^[A-Z]$/);
const patchSchema = z.object({
    code: z.string().max(8).optional(),
    lng: z.number().optional(),
    lat: z.number().optional(),
    headingDeg: z.number().optional(),
    fovDeg: z.number().optional(),
    rangeM: z.number().optional(),
    status: z.enum(['ONLINE', 'OFFLINE']).optional(),
}).strict();

// Every camera edit: DB-backed admin check, domain errors returned as messages, Setup page refreshed.
async function run<T extends object>(work: (actorId: string) => Promise<T>): Promise<({ ok: true } & T) | { ok: false; error: string }>
{
    const actor = await requireCurrentUser('ADMIN');
    try
    {
        const result = await work(actor.id);
        revalidatePath('/settings/cameras');
        return { ok: true, ...result };
    }
    catch (error)
    {
        if (error instanceof CameraEditError)
        {
            return { ok: false, error: error.message };
        }
        throw error;
    }
}

export async function addCameraPair(click: LngLat): Promise<PairActionResult>
{
    await requireCurrentUser('ADMIN');
    const parsed = clickSchema.safeParse(click);
    if (!parsed.success)
    {
        return { ok: false, error: 'Click a point on the map.' };
    }
    return run(actorId => addPair(prisma, actorId, parsed.data));
}

export async function addCameraPairToZone(zoneCode: string, lng: number, lat: number): Promise<PairActionResult>
{
    await requireCurrentUser('ADMIN');
    const zone = zoneCodeSchema.safeParse(zoneCode);
    const at = clickSchema.safeParse([lng, lat]);
    if (!zone.success)
    {
        return { ok: false, error: 'Choose a zone.' };
    }
    if (!at.success)
    {
        return { ok: false, error: 'Enter a longitude between -180 and 180 and a latitude between -90 and 90.' };
    }
    return run(actorId => addPairToZone(prisma, actorId, zone.data, at.data));
}

export async function addCameraPairNewZone(lng: number, lat: number): Promise<PairActionResult>
{
    await requireCurrentUser('ADMIN');
    const at = clickSchema.safeParse([lng, lat]);
    if (!at.success)
    {
        return { ok: false, error: 'Enter a longitude between -180 and 180 and a latitude between -90 and 90.' };
    }
    return run(actorId => addPairNewZone(prisma, actorId, at.data));
}

export async function moveZone(code: string, from: LngLat, to: LngLat): Promise<ZoneActionResult>
{
    await requireCurrentUser('ADMIN');
    const parsed = z.object({ code: zoneCodeSchema, from: clickSchema, to: clickSchema }).safeParse({ code, from, to });
    if (!parsed.success)
    {
        return { ok: false, error: 'That move could not be read.' };
    }
    return run(actorId => shiftZone(prisma, actorId, parsed.data.code, parsed.data.from, parsed.data.to));
}

export async function deleteZone(code: string): Promise<ZoneActionResult>
{
    await requireCurrentUser('ADMIN');
    const parsed = zoneCodeSchema.safeParse(code);
    if (!parsed.success)
    {
        return { ok: false, error: 'That zone no longer exists.' };
    }
    return run(actorId => removeZone(prisma, actorId, parsed.data));
}

export async function updateCamera(code: string, patch: { code?: string; lng?: number; lat?: number; headingDeg?: number; fovDeg?: number; rangeM?: number; status?: 'ONLINE' | 'OFFLINE' }): Promise<CameraActionResult>
{
    await requireCurrentUser('ADMIN');
    const parsedCode = cameraCodeSchema.safeParse(code);
    const parsedPatch = patchSchema.safeParse(patch);
    if (!parsedCode.success || !parsedPatch.success)
    {
        return { ok: false, error: 'That edit could not be read.' };
    }
    const result = await run(actorId => saveCamera(prisma, actorId, parsedCode.data, parsedPatch.data));
    if (result.ok && result.code !== parsedCode.data)
    {
        // The research mask file is keyed by camera code; its result is ignored, the edit already saved.
        await syncResearchMasks(prisma, liveSettings().root);
    }
    return result;
}

export async function deleteCamera(code: string): Promise<CameraActionResult>
{
    await requireCurrentUser('ADMIN');
    const parsed = cameraCodeSchema.safeParse(code);
    if (!parsed.success)
    {
        return { ok: false, error: 'That camera no longer exists.' };
    }
    const result = await run(async actorId => { await removeCamera(prisma, actorId, parsed.data); return { code: parsed.data }; });
    if (result.ok)
    {
        await syncResearchMasks(prisma, liveSettings().root);
    }
    return result;
}

export async function faceOcean(code: string): Promise<FaceOceanResult>
{
    await requireCurrentUser('ADMIN');
    const parsed = cameraCodeSchema.safeParse(code);
    if (!parsed.success)
    {
        return { ok: false, error: 'That camera no longer exists.' };
    }
    return run(actorId => turnToSea(prisma, actorId, parsed.data));
}

export async function mergeZoneInto(sourceCode: string): Promise<MergeActionResult>
{
    await requireCurrentUser('ADMIN');
    const parsed = zoneCodeSchema.safeParse(sourceCode);
    if (!parsed.success)
    {
        return { ok: false, error: 'That zone no longer exists.' };
    }
    const result = await run(actorId => mergeZone(prisma, actorId, parsed.data));
    if (result.ok && result.moved.length > 0)
    {
        // Merged cameras get new codes.
        await syncResearchMasks(prisma, liveSettings().root);
    }
    return result;
}

export async function setCameraSource(code: string, deviceId: string | null): Promise<CameraActionResult>
{
    await requireCurrentUser('ADMIN');
    const parsed = z.object({ code: cameraCodeSchema, deviceId: z.string().min(1).max(40).nullable() }).safeParse({ code, deviceId });
    if (!parsed.success)
    {
        return { ok: false, error: 'That source could not be read.' };
    }
    return run(actorId => saveSource(prisma, actorId, parsed.data.code, parsed.data.deviceId));
}
