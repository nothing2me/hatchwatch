'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireCurrentUser } from '@/lib/auth/guard';
import { CameraEditError } from '@/lib/cameras/manage';
import { prisma } from '@/lib/db';
import { boardSecretsBlock } from '@/lib/phones/boardSecrets';
import { createBoard, rotateBoardToken, type IssuedToken } from '@/lib/phones/boards';
import { dashboardOrigin } from '@/lib/phones/connect';
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

export type IssuedTokenResult =
    | { ok: true; deviceId: string; name: string; token: string; secrets: string; dashboardUrl: string | null }
    | { ok: false; error: string };

function issued(board: IssuedToken): IssuedTokenResult
{
    const dashboardUrl = dashboardOrigin(process.env.LAN_HOST);
    return { ok: true, deviceId: board.id, name: board.name, token: board.token, dashboardUrl, secrets: boardSecretsBlock({ dashboardUrl, deviceId: board.id, token: board.token }) };
}

// The only place a token leaves the server: this one response.
export async function addBoardCamera(name: string): Promise<IssuedTokenResult>
{
    const actor = await requireCurrentUser('ADMIN');
    const parsed = z.string().max(200).safeParse(name);
    if (!parsed.success)
    {
        return { ok: false, error: 'Give the board a name of 1 to 60 characters.' };
    }
    try
    {
        const board = await createBoard(prisma, actor.id, parsed.data);
        revalidatePath('/live');
        return issued(board);
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

export async function rotateDeviceToken(deviceId: string): Promise<IssuedTokenResult>
{
    const actor = await requireCurrentUser('ADMIN');
    const parsed = z.string().min(1).max(40).safeParse(deviceId);
    if (!parsed.success)
    {
        return { ok: false, error: 'That board was removed.' };
    }
    try
    {
        return issued(await rotateBoardToken(prisma, actor.id, parsed.data));
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
