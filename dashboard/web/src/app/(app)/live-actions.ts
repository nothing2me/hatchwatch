'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireCurrentUser } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { AssignError, assignSource } from '@/lib/live/devices';

export type AssignSourceResult = { ok: true } | { ok: false; error: string };

const cameraCodeSchema = z.string().min(1).max(8);
const deviceIdSchema = z.string().min(1).max(64).nullable();

// Admin only, role re-read from the database: which device (or the simulation loop, null) feeds a camera.
export async function assignCameraSource(cameraCode: string, deviceId: string | null): Promise<AssignSourceResult>
{
    const user = await requireCurrentUser('ADMIN');
    const code = cameraCodeSchema.safeParse(cameraCode);
    const device = deviceIdSchema.safeParse(deviceId);
    if (!code.success || !device.success)
    {
        return { ok: false, error: 'Pick a camera and a device.' };
    }
    try
    {
        await assignSource(prisma, { cameraCode: code.data, deviceId: device.data, userId: user.id });
    }
    catch (error)
    {
        if (error instanceof AssignError)
        {
            return { ok: false, error: error.message };
        }
        throw error;
    }
    revalidatePath('/');
    return { ok: true };
}
