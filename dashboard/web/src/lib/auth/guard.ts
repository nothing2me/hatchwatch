import 'server-only';
import { cookies } from 'next/headers';
import { forbidden, redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import type { Role } from '@/lib/types';
import { readSessionToken, SESSION_COOKIE, type SessionUser } from './session';

const rank: Record<Role, number> = { VIEWER: 1, VOLUNTEER: 2, ADMIN: 3 };

export function hasRole(user: SessionUser | null, role: Role): boolean
{
    return user !== null && rank[user.role] >= rank[role];
}

function authSecret(): string
{
    const secret = process.env.AUTH_SECRET;
    if (!secret || secret.length < 32)
    {
        throw new Error('AUTH_SECRET must be set to at least 32 characters');
    }
    if (secret.startsWith('change-me'))
    {
        throw new Error('AUTH_SECRET is still the .env.example placeholder; generate a real one');
    }
    return secret;
}

export async function getSession(): Promise<SessionUser | null>
{
    const store = await cookies();
    return readSessionToken(store.get(SESSION_COOKIE)?.value, authSecret());
}

export async function requireUser(): Promise<SessionUser>
{
    const user = await getSession();
    if (!user)
    {
        redirect('/login');
    }
    return user;
}

export async function requireRole(role: Role): Promise<SessionUser>
{
    const user = await requireUser();
    if (!hasRole(user, role))
    {
        forbidden();
    }
    return user;
}

// Session plus a fresh database read: deleted or disabled users lose access and role changes apply immediately.
export async function currentUserOrNull(): Promise<SessionUser | null>
{
    const session = await getSession();
    if (!session)
    {
        return null;
    }
    const row = await prisma.user.findUnique({ where: { id: session.id }, select: { id: true, email: true, name: true, role: true, disabledAt: true } });
    if (!row || row.disabledAt)
    {
        return null;
    }
    return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export async function requireCurrentUser(role: Role = 'VIEWER'): Promise<SessionUser>
{
    const user = await currentUserOrNull();
    if (!user)
    {
        redirect('/login');
    }
    if (!hasRole(user, role))
    {
        forbidden();
    }
    return user;
}

export { authSecret };
