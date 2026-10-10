import { safeNext } from '@/lib/auth/safeNext';
import { LoginForm } from './LoginForm';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> })
{
    const { next } = await searchParams;
    return <LoginForm next={safeNext(typeof next === 'string' ? next : null)} />;
}
