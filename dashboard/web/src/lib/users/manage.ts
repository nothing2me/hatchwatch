import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@/generated/prisma/client';
import { hashPassword } from '@/lib/auth/password';
import { publishChange } from '@/lib/changes';
import type { Role } from '@/lib/types';

export class UserError extends Error
{
    constructor(public code: 'EMAIL_TAKEN' | 'SELF' | 'NOT_FOUND' | 'INVALID', message: string) { super(message); }
}

export interface ManagedUser
{
    id: string;
    name: string;
    email: string;
    role: Role;
    disabledAt: Date | null;
    createdAt: Date;
}

const select = { id: true, name: true, email: true, role: true, disabledAt: true, createdAt: true } as const;
const ROLES: Role[] = ['ADMIN', 'VOLUNTEER', 'VIEWER'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function listUsers(prisma: PrismaClient): Promise<ManagedUser[]>
{
    return prisma.user.findMany({ select, orderBy: [{ createdAt: 'asc' }, { email: 'asc' }] });
}

export async function createUser(
    prisma: PrismaClient,
    actorId: string,
    input: { name: string; email: string; role: Role },
): Promise<{ user: ManagedUser; temporaryPassword: string }>
{
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    if (!name || !EMAIL.test(email) || !ROLES.includes(input.role))
    {
        throw new UserError('INVALID', 'Enter a name, a valid email and a role.');
    }
    if (await prisma.user.findUnique({ where: { email }, select: { id: true } }))
    {
        throw new UserError('EMAIL_TAKEN', 'Someone with that email already exists.');
    }
    const temporaryPassword = randomBytes(9).toString('base64url');   // 12 url-safe characters
    const passwordHash = await hashPassword(temporaryPassword);
    const user = await prisma.$transaction(async tx =>
    {
        const created = await tx.user.create({ data: { name, email, role: input.role, passwordHash }, select });
        await tx.auditLog.create({ data: { userId: actorId, action: 'user.create', targetType: 'User', targetId: created.id, details: { email, role: input.role } } });
        return created;
    }).catch((error: unknown) =>
    {
        if ((error as { code?: string }).code === 'P2002')
        {
            throw new UserError('EMAIL_TAKEN', 'Someone with that email already exists.');
        }
        throw error;
    });
    publishChange('users');
    return { user, temporaryPassword };
}

export async function setRole(prisma: PrismaClient, actorId: string, userId: string, role: Role): Promise<ManagedUser>
{
    if (userId === actorId)
    {
        throw new UserError('SELF', 'You cannot change your own role.');
    }
    if (!ROLES.includes(role))
    {
        throw new UserError('INVALID', 'Unknown role.');
    }
    const user = await prisma.$transaction(async tx =>
    {
        const before = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
        if (!before)
        {
            throw new UserError('NOT_FOUND', 'That person no longer exists.');
        }
        const updated = await tx.user.update({ where: { id: userId }, data: { role }, select });
        await tx.auditLog.create({ data: { userId: actorId, action: 'user.role', targetType: 'User', targetId: userId, details: { from: before.role, to: role } } });
        return updated;
    });
    publishChange('users');
    return user;
}

export async function setDisabled(prisma: PrismaClient, actorId: string, userId: string, disabled: boolean): Promise<ManagedUser>
{
    if (userId === actorId)
    {
        throw new UserError('SELF', 'You cannot disable yourself.');
    }
    const user = await prisma.$transaction(async tx =>
    {
        if (!await tx.user.findUnique({ where: { id: userId }, select: { id: true } }))
        {
            throw new UserError('NOT_FOUND', 'That person no longer exists.');
        }
        const updated = await tx.user.update({ where: { id: userId }, data: { disabledAt: disabled ? new Date() : null }, select });
        await tx.auditLog.create({ data: { userId: actorId, action: disabled ? 'user.disable' : 'user.enable', targetType: 'User', targetId: userId } });
        return updated;
    });
    publishChange('users');
    return user;
}

// A fresh temporary password for someone who lost theirs; shown once, like a new account.
export async function resetPassword(prisma: PrismaClient, actorId: string, userId: string): Promise<{ temporaryPassword: string }>
{
    if (userId === actorId)
    {
        throw new UserError('SELF', 'You cannot reset your own password here.');
    }
    const temporaryPassword = randomBytes(9).toString('base64url');
    const passwordHash = await hashPassword(temporaryPassword);
    await prisma.$transaction(async tx =>
    {
        if (!await tx.user.findUnique({ where: { id: userId }, select: { id: true } }))
        {
            throw new UserError('NOT_FOUND', 'That person no longer exists.');
        }
        await tx.user.update({ where: { id: userId }, data: { passwordHash } });
        await tx.auditLog.create({ data: { userId: actorId, action: 'user.password', targetType: 'User', targetId: userId } });
    });
    publishChange('users');
    return { temporaryPassword };
}
