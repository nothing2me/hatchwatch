'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireCurrentUser } from '@/lib/auth/guard';
import { CameraEditError } from '@/lib/cameras/manage';
import { prisma } from '@/lib/db';
import { removeDevice } from '@/lib/phones/devices';
import { frameStore } from '@/lib/phones/frameStore';

export async function removePhone(deviceId: string): Promise<{ ok: true } | { ok: false; error: string }>
{
    const actor = await requireCurrentUser('ADMIN');
    const parsed = z.string().min(1).max(40).safeParse(deviceId);
    if (!parsed.success)
    {
        return { ok: false, error: 'That phone no longer exists.' };
    }
    try
    {
        await removeDevice(prisma, actor.id, parsed.data);
    }
    catch (error)
    {
        if (error instanceof CameraEditError)
        {
            return { ok: false, error: error.message };
        }
        throw error;
    }
    // GET frame has no database check, so the in-memory frame must go now.
    frameStore.forget(parsed.data);
    revalidatePath('/live');
    return { ok: true };
}
