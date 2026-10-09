'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/auth/password';
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions, type SessionUser } from '@/lib/auth/session';
import { authSecret } from '@/lib/auth/guard';

export type LoginState = { error: string | null };

interface AuthDeps
{
    findUser: (email: string) => Promise<(SessionUser & { passwordHash: string }) | null>;
    verify: (passwordHash: string, plain: string) => Promise<boolean>;
}

const defaultDeps: AuthDeps = {
    findUser: email => prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, name: true, role: true, passwordHash: true },
    }),
    verify: verifyPassword,
};

export async function authenticate(email: string, password: string, deps: AuthDeps = defaultDeps): Promise<SessionUser | null>
{
    const row = await deps.findUser(email.trim().toLowerCase());
    if (!row || !(await deps.verify(row.passwordHash, password)))
    {
        return null;
    }
    return { id: row.id, email: row.email, name: row.name, role: row.role };
}

const formSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1).max(200),
});

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState>
{
    const parsed = formSchema.safeParse({ email: form.get('email'), password: form.get('password') });
    if (!parsed.success)
    {
        return { error: 'Enter your email and password.' };
    }

    const user = await authenticate(parsed.data.email, parsed.data.password);
    if (!user)
    {
        return { error: 'Email or password is incorrect.' };
    }

    const store = await cookies();
    store.set(SESSION_COOKIE, await createSessionToken(user, authSecret()), sessionCookieOptions());
    redirect('/');
}
