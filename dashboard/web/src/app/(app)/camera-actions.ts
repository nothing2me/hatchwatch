'use server';

import { z } from 'zod';
import { requireCurrentUser } from '@/lib/auth/guard';
import { addCameraPair as addPair, CameraEditError, deleteZone as removeZone } from '@/lib/cameras/manage';
import { prisma } from '@/lib/db';
import type { LngLat } from '@/lib/types';

export type CameraActionResult = { ok: true; code: string } | { ok: false; error: string };

const clickSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const codeSchema = z.string().regex(/^[A-Z]$/);

async function run(work: () => Promise<string>): Promise<CameraActionResult>
{
    try
    {
        return { ok: true, code: await work() };
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

export async function addCameraPair(click: LngLat): Promise<CameraActionResult>
{
    const actor = await requireCurrentUser('ADMIN');
    const parsed = clickSchema.safeParse(click);
    if (!parsed.success)
    {
        return { ok: false, error: 'Click a point on the map.' };
    }
    return run(async () => (await addPair(prisma, actor.id, parsed.data)).code);
}

export async function deleteZone(code: string): Promise<CameraActionResult>
{
    const actor = await requireCurrentUser('ADMIN');
    const parsed = codeSchema.safeParse(code);
    if (!parsed.success)
    {
        return { ok: false, error: 'That zone no longer exists.' };
    }
    return run(async () =>
    {
        await removeZone(prisma, actor.id, parsed.data);
        return parsed.data;
    });
}
