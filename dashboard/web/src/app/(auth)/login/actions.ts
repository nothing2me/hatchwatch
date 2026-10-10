'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { authenticate } from '@/lib/auth/authenticate';
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session';
import { authSecret } from '@/lib/auth/guard';
import { safeNextPath } from '@/lib/auth/nextPath';
import { isHttpsRequest } from '@/lib/auth/requestSecurity';

export type LoginState = { error: string | null };

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
    store.set(SESSION_COOKIE, await createSessionToken(user, authSecret()), sessionCookieOptions({ secure: isHttpsRequest(await headers()) }));
    redirect(safeNextPath(form.get('next')));
}
