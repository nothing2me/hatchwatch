'use client';

import { useRef, useState, useTransition } from 'react';
import { KeyRound, Trash2 } from 'lucide-react';
import { removePhone, rotateDeviceToken, type IssuedTokenResult } from '@/app/(app)/cameras/actions';
import type { LiveDeviceView } from '@/lib/types';
import { cn } from '@/lib/cn';
import { IssuedTokenDialog } from './BoardToken';

const action = 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/12 px-2.5 text-xs text-ink transition-colors hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-amber';

function lastSeen(iso: string, now: number): string
{
    const seconds = Math.round((now - Date.parse(iso)) / 1000);
    if (seconds < 45) return 'last seen just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `last seen ${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 36 ? `last seen ${hours} h ago` : `last seen ${Math.round(hours / 24)} d ago`;
}

function DeviceRow({ device, onRemoved }: { device: LiveDeviceView; onRemoved: () => void })
{
    const [confirming, setConfirming] = useState<'remove' | 'rotate' | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [issued, setIssued] = useState<Extract<IssuedTokenResult, { ok: true }> | null>(null);
    const [pending, startTransition] = useTransition();
    const rotateRef = useRef<HTMLButtonElement>(null);
    const board = device.kind === 'BOARD';

    function remove()
    {
        setProblem(null);
        startTransition(async () =>
        {
            const result = await removePhone(device.id);
            if (result.ok)
            {
                setConfirming(null);
                onRemoved();
            }
            else
            {
                setProblem(result.error);
            }
        });
    }

    function rotate()
    {
        setProblem(null);
        startTransition(async () =>
        {
            const result = await rotateDeviceToken(device.id);
            if (result.ok)
            {
                setConfirming(null);
                setIssued(result);
            }
            else
            {
                setProblem(result.error);
            }
        });
    }

    return (
        <li aria-label={device.name} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium text-ink">{device.name}</span>
                    <span className={cn('inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[10px] font-semibold tracking-[0.04em]', board ? 'bg-amber/15 text-amber' : 'bg-white/8 text-ink-muted')}>{board ? 'Camera board' : 'Phone'}</span>
                </p>
                <p className="mt-0.5 truncate text-xs text-ink-muted">by {device.ownerName} · {device.online ? <span className="text-ok">online</span> : lastSeen(device.lastSeenAt, Date.now())}</p>
            </div>
            <p className={cn('text-xs', device.cameraCode ? 'font-mono text-amber' : 'text-ink-muted')}>{device.cameraCode ? `Camera ${device.cameraCode}` : 'Not linked'}</p>
            {confirming === 'remove' && (
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                    <span className="text-xs text-ink">
                        {board
                            ? `Remove ${device.name}? Its camera returns to the simulation loop and the board's token stops working. Add it again to get a new token.`
                            : `Remove ${device.name}? Its camera returns to the simulation loop. The person can start again with a new phone name; to block a person, disable their account on the Users page.`}
                    </span>
                    <button type="button" disabled={pending} onClick={remove} className={cn(action, 'border-danger/40 text-[#F2865A] hover:bg-danger/15 disabled:opacity-50')}>Remove</button>
                    <button type="button" disabled={pending} onClick={() => setConfirming(null)} className={action}>Cancel</button>
                </div>
            )}
            {confirming === 'rotate' && (
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                    <span className="text-xs text-ink">Rotate the token for {device.name}? The board stops sending until secrets.h has the new token and the firmware is uploaded again.</span>
                    <button type="button" disabled={pending} onClick={rotate} className={cn(action, 'border-amber/40 text-amber hover:bg-amber/15 disabled:opacity-50')}>Rotate</button>
                    <button type="button" disabled={pending} onClick={() => setConfirming(null)} className={action}>Cancel</button>
                </div>
            )}
            {confirming === null && (
                <div className="flex shrink-0 gap-1.5">
                    {board && (
                        <button ref={rotateRef} type="button" onClick={() => setConfirming('rotate')} aria-label={`Rotate token for ${device.name}`} className={action}>
                            <KeyRound aria-hidden className="h-3.5 w-3.5" />
                            Rotate token
                        </button>
                    )}
                    <button type="button" onClick={() => setConfirming('remove')} aria-label={`Remove ${device.name}`} className={action}>
                        <Trash2 aria-hidden className="h-3.5 w-3.5" />
                        Remove
                    </button>
                </div>
            )}
            {problem && <p role="alert" className="w-full text-xs text-[#F2865A]">{problem}</p>}
            {issued && <IssuedTokenDialog issued={issued} title={`New token for ${device.name}`} onClose={() => setIssued(null)} returnTo={rotateRef} />}
        </li>
    );
}

// Admin list of every phone and camera board, online or not, with kind, link, last seen, Rotate token and Remove.
export function DevicesPanel({ devices, onRemoved }: { devices: LiveDeviceView[]; onRemoved: () => void })
{
    return (
        <div className="mt-6 rounded-2xl border border-white/8 bg-night-900/70 p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-ink">All devices</h3>
            <p className="mt-1 text-xs text-ink-muted">Every phone and camera board that can send. Link one to a map camera from Settings → Cameras or the camera panel.</p>
            {devices.length > 0
                ? <ul className="mt-3 divide-y divide-white/8 rounded-xl border border-white/8">{devices.map(device => <DeviceRow key={device.id} device={device} onRemoved={onRemoved} />)}</ul>
                : <p className="mt-3 text-sm text-ink-muted">No devices yet.</p>}
        </div>
    );
}
