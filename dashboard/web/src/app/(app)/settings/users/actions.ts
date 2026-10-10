'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireCurrentUser } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { createUser, resetPassword, setDisabled, setRole, UserError } from '@/lib/users/manage';

export type UserActionResult = { ok: true; temporaryPassword?: string } | { ok: false; error: string };

const roleSchema = z.enum(['ADMIN', 'VOLUNTEER', 'VIEWER']);
const idSchema = z.string().min(1).max(100);

async function run(work: (actorId: string) => Promise<{ temporaryPassword?: string } | void>): Promise<UserActionResult>
{
    const actor = await requireCurrentUser('ADMIN');
    try
    {
        const result = await work(actor.id);
        revalidatePath('/settings/users');
        return { ok: true, temporaryPassword: result?.temporaryPassword };
    }
    catch (error)
    {
        if (error instanceof UserError)
        {
            return { ok: false, error: error.message };
        }
        throw error;
    }
}

export async function addUserAction(input: { name: string; email: string; role: string }): Promise<UserActionResult>
{
    const actor = await requireCurrentUser('ADMIN');
    const parsed = z.object({ name: z.string().max(120), email: z.string().max(200), role: roleSchema }).safeParse(input);
    if (!parsed.success)
    {
        return { ok: false, error: 'Enter a name, a valid email and a role.' };
    }
    return run(async () =>
    {
        const { temporaryPassword } = await createUser(prisma, actor.id, parsed.data);
        return { temporaryPassword };
    });
}

export async function setRoleAction(userId: string, role: string): Promise<UserActionResult>
{
    await requireCurrentUser('ADMIN');
    const parsed = z.object({ userId: idSchema, role: roleSchema }).safeParse({ userId, role });
    if (!parsed.success)
    {
        return { ok: false, error: 'Unknown role.' };
    }
    return run(async actorId => { await setRole(prisma, actorId, parsed.data.userId, parsed.data.role); });
}

export async function setDisabledAction(userId: string, disabled: boolean): Promise<UserActionResult>
{
    await requireCurrentUser('ADMIN');
    const parsed = idSchema.safeParse(userId);
    if (!parsed.success)
    {
        return { ok: false, error: 'Unknown person.' };
    }
    return run(async actorId => { await setDisabled(prisma, actorId, parsed.data, disabled === true); });
}

export async function resetPasswordAction(userId: string): Promise<UserActionResult>
{
    await requireCurrentUser('ADMIN');
    const parsed = idSchema.safeParse(userId);
    if (!parsed.success)
    {
        return { ok: false, error: 'Unknown person.' };
    }
    return run(async actorId => resetPassword(prisma, actorId, parsed.data));
}
