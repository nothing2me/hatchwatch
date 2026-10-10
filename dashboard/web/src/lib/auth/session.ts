import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import type { Role } from '@/lib/types';

export interface SessionUser
{
    id: string;
    email: string;
    name: string;
    role: Role;
}

export const SESSION_COOKIE = 'nt_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;

const payloadSchema = z.object({
    sub: z.string().min(1),
    email: z.string().min(1),
    name: z.string(),
    role: z.enum(['ADMIN', 'VIEWER']),
});

function key(secret: string): Uint8Array
{
    return new TextEncoder().encode(secret);
}

export async function createSessionToken(user: SessionUser, secret: string, now: Date = new Date()): Promise<string>
{
    const issuedAt = Math.floor(now.getTime() / 1000);
    return new SignJWT({ email: user.email, name: user.name, role: user.role })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(user.id)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + SESSION_TTL_SECONDS)
        .sign(key(secret));
}

// Any failure (bad signature, expired, malformed, unknown role) means "no session".
export async function readSessionToken(token: string | undefined, secret: string): Promise<SessionUser | null>
{
    if (!token)
    {
        return null;
    }

    try
    {
        const { payload } = await jwtVerify(token, key(secret), { algorithms: ['HS256'], requiredClaims: ['exp', 'iat'] });
        const parsed = payloadSchema.safeParse(payload);
        if (!parsed.success)
        {
            return null;
        }
        return { id: parsed.data.sub, email: parsed.data.email, name: parsed.data.name, role: parsed.data.role };
    }
    catch
    {
        return null;
    }
}

export function sessionCookieOptions(options: { secure?: boolean } = {})
{
    return {
        httpOnly: true as const,
        sameSite: 'lax' as const,
        secure: options.secure === true || (process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== '1'),
        path: '/' as const,
        maxAge: SESSION_TTL_SECONDS,
    };
}
