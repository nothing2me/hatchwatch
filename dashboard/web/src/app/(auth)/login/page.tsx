'use client';

import { use, useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { GlassPanel } from '@/components/ui/glass-panel';
import { loginAction, type LoginState } from './actions';

const initialState: LoginState = { error: null };

export default function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> })
{
    const [state, formAction, pending] = useActionState(loginAction, initialState);
    // Pages that send people here (the phone camera page) ask to come back afterwards; the action re-checks it.
    const next = use(searchParams).next;

    return (
        <main className="relative grid min-h-full place-items-center overflow-hidden bg-night-950 p-4">
            {/* Faint shoreline gradient as the backdrop */}
            <div aria-hidden className="absolute inset-0 bg-[linear-gradient(118deg,#0a1118_0%,#111c25_45%,#16303f_52%,#0a1118_100%)]" />
            <GlassPanel className="relative w-full max-w-sm p-6">
                <p className="text-xs font-semibold tracking-[0.2em] text-ink-muted">HATCHWATCH</p>
                <h1 className="mt-1 text-xl font-semibold">Sign in</h1>
                <p className="mt-1 text-sm text-ink-muted">Port Aransas beach monitoring</p>

                <form action={formAction} className="mt-6 space-y-4">
                    {typeof next === 'string' && <input type="hidden" name="next" value={next} />}
                    <label className="block text-sm">
                        <span className="text-ink-muted">Email</span>
                        <input name="email" type="email" autoComplete="email" required
                            className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-night-900 px-3 outline-none focus:border-amber" />
                    </label>
                    <label className="block text-sm">
                        <span className="text-ink-muted">Password</span>
                        <input name="password" type="password" autoComplete="current-password" required
                            className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-night-900 px-3 outline-none focus:border-amber" />
                    </label>
                    {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
                    <Button type="submit" variant="primary" className="w-full" disabled={pending}>
                        {pending ? 'Signing inâ€¦' : 'Sign in'}
                    </Button>
                </form>
            </GlassPanel>
        </main>
    );
}
