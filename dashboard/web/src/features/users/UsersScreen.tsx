'use client';

import { useState, useTransition } from 'react';
import { Check, Copy, KeyRound, UserPlus } from 'lucide-react';
import { addUserAction, resetPasswordAction, setDisabledAction, setRoleAction, type UserActionResult } from '@/app/(app)/setup/users/actions';
import { TopBar } from '@/features/shell/TopBar';
import type { SessionUser } from '@/lib/auth/session';
import type { Role } from '@/lib/types';
import { cn } from '@/lib/cn';

export interface UserRow
{
    id: string;
    name: string;
    email: string;
    role: Role;
    disabledAt: string | null;
    createdAt: string;
}

interface UsersScreenProps
{
    user: SessionUser;
    users: UserRow[];
    bar: { camerasOnline: number; camerasTotal: number; activeSites: number; dangerCount?: number; firstDangerId?: string | null };
}

const ROLES: { value: Role; label: string }[] = [
    { value: 'ADMIN', label: 'Admin' },
    { value: 'VOLUNTEER', label: 'Volunteer' },
    { value: 'VIEWER', label: 'Viewer' },
];

const field = 'h-10 w-full rounded-lg border border-white/12 bg-night-950/70 px-3 text-sm text-ink placeholder:text-ink-muted/60 focus-visible:outline-2 focus-visible:outline-amber';
const button = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/12 px-3 text-sm text-ink transition-colors hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-amber disabled:opacity-50';

interface Secret { who: string; email: string; password: string }

export function UsersScreen({ user, users, bar }: UsersScreenProps)
{
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [secret, setSecret] = useState<Secret | null>(null);
    const [copied, setCopied] = useState(false);
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<Role>('VOLUNTEER');

    function run(work: () => Promise<UserActionResult>, onOk?: (result: Extract<UserActionResult, { ok: true }>) => void)
    {
        setError(null);
        startTransition(async () =>
        {
            const result = await work();
            if (result.ok)
            {
                onOk?.(result);
            }
            else
            {
                setError(result.error);
            }
        });
    }

    function add(event: React.FormEvent)
    {
        event.preventDefault();
        run(() => addUserAction({ name, email, role }), result =>
        {
            setSecret({ who: name.trim(), email: email.trim().toLowerCase(), password: result.temporaryPassword ?? '' });
            setCopied(false);
            setName('');
            setEmail('');
            setRole('VOLUNTEER');
        });
    }

    async function copy()
    {
        try
        {
            await navigator.clipboard.writeText(secret?.password ?? '');
            setCopied(true);
        }
        catch
        {
            setCopied(false);
        }
    }

    return (
        <main className="min-h-full bg-night-950">
            <div className="sticky top-0 z-20 p-3">
                <TopBar user={user} current="users" camerasOnline={bar.camerasOnline} camerasTotal={bar.camerasTotal} activeSites={bar.activeSites} dangerCount={bar.dangerCount} firstDangerId={bar.firstDangerId} />
            </div>
            <div className="mx-auto max-w-4xl px-4 pt-6 pb-16 sm:px-6 sm:pt-10">
                <h1 className="text-3xl font-semibold tracking-tight text-ink">Users</h1>
                <p className="mt-1.5 text-sm text-ink-muted">Volunteers can log patrol visits; viewers can only look. Admins manage people.</p>

                <section aria-labelledby="add-heading" className="mt-6 rounded-xl border border-white/8 bg-white/[0.03] p-4">
                    <h2 id="add-heading" className="flex items-center gap-2 text-sm font-semibold text-ink"><UserPlus aria-hidden className="h-4 w-4 text-amber" />Add person</h2>
                    <form onSubmit={add} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_9rem_auto] sm:items-end">
                        <label className="text-xs text-ink-muted">Name
                            <input className={cn(field, 'mt-1')} value={name} onChange={e => setName(e.target.value)} required maxLength={120} autoComplete="off" />
                        </label>
                        <label className="text-xs text-ink-muted">Email
                            <input className={cn(field, 'mt-1')} type="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={200} autoComplete="off" />
                        </label>
                        <label className="text-xs text-ink-muted">Role
                            <select className={cn(field, 'mt-1')} value={role} onChange={e => setRole(e.target.value as Role)}>
                                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                            </select>
                        </label>
                        <button type="submit" disabled={pending} className={cn(button, 'h-10 bg-amber/90 font-medium text-night-950 hover:bg-amber')}>Add person</button>
                    </form>
                </section>

                {error && <p role="alert" className="mt-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200">{error}</p>}

                {secret && (
                    <section aria-label="Temporary password" className="mt-4 rounded-xl border border-amber/40 bg-amber/10 p-4">
                        <p className="text-sm text-ink">Temporary password for <strong>{secret.who || secret.email}</strong> ({secret.email})</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <code data-testid="temp-password" className="rounded-md bg-night-950 px-3 py-1.5 font-mono text-base tracking-wider text-amber select-all">{secret.password}</code>
                            <button type="button" onClick={copy} className={button}>{copied ? <Check aria-hidden className="h-4 w-4" /> : <Copy aria-hidden className="h-4 w-4" />}{copied ? 'Copied' : 'Copy'}</button>
                            <button type="button" onClick={() => setSecret(null)} className={button}>Done</button>
                        </div>
                        <p className="mt-2 text-xs text-ink-muted">Shown once — share it privately.</p>
                    </section>
                )}

                <div className="mt-6 overflow-hidden rounded-xl border border-white/8">
                    <table className="w-full text-left text-sm max-sm:block">
                        <thead className="bg-white/[0.04] text-xs text-ink-muted max-sm:sr-only">
                            <tr>
                                <th scope="col" className="px-4 py-2.5 font-medium">Name</th>
                                <th scope="col" className="px-4 py-2.5 font-medium">Email</th>
                                <th scope="col" className="px-4 py-2.5 font-medium">Role</th>
                                <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                                <th scope="col" className="px-4 py-2.5 font-medium"><span className="sr-only">Actions</span></th>
                            </tr>
                        </thead>
                        <tbody className="max-sm:block">
                            {users.map(row =>
                            {
                                const self = row.id === user.id;
                                const disabled = row.disabledAt !== null;
                                return (
                                    <tr key={row.id} data-disabled={disabled || undefined} className={cn('border-t border-white/8 max-sm:grid max-sm:gap-2 max-sm:p-4', disabled && 'opacity-55')}>
                                        <td className="px-4 py-3 font-medium text-ink max-sm:p-0">{row.name}{self && <span className="ml-2 text-xs font-normal text-ink-muted">(you)</span>}</td>
                                        <td className="px-4 py-3 break-all text-ink-muted max-sm:p-0">{row.email}</td>
                                        <td className="px-4 py-3 max-sm:p-0">
                                            <select
                                                aria-label={`Role for ${row.name}`}
                                                value={row.role}
                                                disabled={self || pending}
                                                onChange={e => run(() => setRoleAction(row.id, e.target.value))}
                                                className="h-9 rounded-lg border border-white/12 bg-night-950/70 px-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-amber disabled:opacity-60"
                                            >
                                                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                                            </select>
                                        </td>
                                        <td className="px-4 py-3 max-sm:p-0">
                                            <span className={cn('inline-flex h-6 items-center rounded-full px-2 text-xs', disabled ? 'bg-white/8 text-ink-muted' : 'bg-ok/15 text-ok')}>{disabled ? 'Disabled' : 'Active'}</span>
                                        </td>
                                        <td className="px-4 py-3 max-sm:p-0">
                                            <div className="flex flex-wrap justify-end gap-2 max-sm:justify-start">
                                                {!disabled && !self && (
                                                    <button type="button" disabled={pending} className={button} onClick={() => run(() => resetPasswordAction(row.id), result =>
                                                    {
                                                        setSecret({ who: row.name, email: row.email, password: result.temporaryPassword ?? '' });
                                                        setCopied(false);
                                                    })}><KeyRound aria-hidden className="h-4 w-4" />New password</button>
                                                )}
                                                {!self && (
                                                    <button type="button" disabled={pending} className={button} onClick={() => run(() => setDisabledAction(row.id, !disabled))}>{disabled ? 'Enable' : 'Disable'}</button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </main>
    );
}
