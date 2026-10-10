'use client';

import Link from 'next/link';
import { useRef, useState, useSyncExternalStore, useTransition } from 'react';
import { Activity, LoaderCircle, Maximize2, QrCode, Smartphone, Trash2, VideoOff, X } from 'lucide-react';
import { removePhone } from '@/app/(app)/live/actions';
import { TopBar, type TopBarCounts } from '@/features/shell/TopBar';
import type { SessionUser } from '@/lib/auth/session';
import type { LiveDeviceView } from '@/lib/types';
import { cn } from '@/lib/cn';
import type { LiveFrameState } from './framePoller';
import { ConnectPhone, useModal } from './ConnectPhone';
import { RecordingsPanel } from './RecordingsPanel';
import { useLiveDevices } from './useLiveDevices';
import { useLiveFrame } from './useLiveFrame';

const action = 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/12 px-2.5 text-xs text-ink transition-colors hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-amber';

const noSubscribe = () => () => {};

export function RecBadge()
{
    return (
        <span className="inline-flex h-5 items-center gap-1 rounded bg-alarm px-1.5 text-[10px] font-bold tracking-[0.12em] text-white shadow-[0_0_12px_rgba(255,77,94,0.45)]">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-white motion-safe:animate-pulse" />
            REC
        </span>
    );
}

// The picture box: the frame, a spinner before the first one, or why there is none.
export function LivePicture({ url, state, name, className }: { url: string | null; state: LiveFrameState | 'idle'; name: string; className?: string })
{
    const gone = state === 'offline' || state === 'signed-out';
    return (
        <div className={cn('relative overflow-hidden bg-black', className)}>
            {url && <img src={url} alt={`Live picture from ${name}`} className={cn('h-full w-full object-contain', gone && 'opacity-30')} />}
            {!url && !gone && (
                <span className="absolute inset-0 grid place-items-center text-ink-muted">
                    <LoaderCircle aria-hidden className="h-6 w-6 motion-safe:animate-spin" />
                    <span className="sr-only">Loading picture</span>
                </span>
            )}
            {gone && (
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-ink-muted">
                    <VideoOff aria-hidden className="h-5 w-5" />
                    {state === 'offline' ? 'Phone offline' : 'Signed out. Reload to sign in again.'}
                </span>
            )}
        </div>
    );
}

function Expanded({ device, url, state, onClose, returnTo }: { device: LiveDeviceView; url: string | null; state: LiveFrameState | 'idle'; onClose: () => void; returnTo: React.RefObject<HTMLButtonElement | null> })
{
    const dialogRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    useModal(dialogRef, closeRef, onClose, returnTo);
    const titleId = `expanded-${device.id}`;
    return (
        <div className="fixed inset-0 z-50 bg-black/90 p-3 backdrop-blur-sm sm:p-5" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex h-full flex-col gap-3">
                <div className="flex items-center gap-3">
                    <h2 id={titleId} className="truncate text-sm font-semibold text-ink">{device.name}</h2>
                    {device.recording && <RecBadge />}
                    <span className="truncate text-xs text-ink-muted max-sm:hidden">by {device.ownerName}</span>
                    <button ref={closeRef} type="button" onClick={onClose} className={cn(action, 'ml-auto shrink-0')}>
                        <X aria-hidden className="h-3.5 w-3.5" />
                        Close
                    </button>
                </div>
                <LivePicture url={url} state={state} name={device.name} className="min-h-0 flex-1 rounded-xl" />
            </div>
        </div>
    );
}

function Tile({ device }: { device: LiveDeviceView })
{
    const { url, state } = useLiveFrame(device.id);
    const [open, setOpen] = useState(false);
    const expandRef = useRef<HTMLButtonElement>(null);
    return (
        <article aria-label={device.name} className="overflow-hidden rounded-2xl border border-white/8 bg-night-900/70">
            <div className="relative">
                <LivePicture url={url} state={state} name={device.name} className="aspect-video" />
                {device.recording && <span className="absolute top-2.5 left-2.5"><RecBadge /></span>}
            </div>
            <div className="flex flex-wrap items-end gap-x-3 gap-y-3 p-4">
                <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{device.name}</p>
                    <p className="mt-0.5 truncate text-xs text-ink-muted">by {device.ownerName}</p>
                    <p className={cn('mt-1.5 text-xs', device.cameraCode ? 'font-mono text-amber' : 'text-ink-muted')}>{device.cameraCode ? `Camera ${device.cameraCode}` : 'Not linked to a map camera'}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                    <Link href={`/live/motion?device=${encodeURIComponent(device.id)}`} className={action}>
                        <Activity aria-hidden className="h-3.5 w-3.5" />
                        Motion view
                    </Link>
                    <button ref={expandRef} type="button" onClick={() => setOpen(true)} className={action}>
                        <Maximize2 aria-hidden className="h-3.5 w-3.5" />
                        Expand
                    </button>
                </div>
            </div>
            {open && <Expanded device={device} url={url} state={state} onClose={() => setOpen(false)} returnTo={expandRef} />}
        </article>
    );
}

function lastSeen(iso: string, now: number): string
{
    const seconds = Math.round((now - Date.parse(iso)) / 1000);
    if (seconds < 45) return 'last seen just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `last seen ${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 36 ? `last seen ${hours} h ago` : `last seen ${Math.round(hours / 24)} d ago`;
}

function PhoneRow({ device, onRemoved }: { device: LiveDeviceView; onRemoved: () => void })
{
    const [confirming, setConfirming] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function remove()
    {
        setProblem(null);
        startTransition(async () =>
        {
            const result = await removePhone(device.id);
            if (result.ok)
            {
                setConfirming(false);
                onRemoved();
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
                <p className="truncate font-medium text-ink">{device.name}</p>
                <p className="mt-0.5 truncate text-xs text-ink-muted">by {device.ownerName} · {device.online ? <span className="text-ok">online</span> : lastSeen(device.lastSeenAt, Date.now())}</p>
            </div>
            <p className={cn('text-xs', device.cameraCode ? 'font-mono text-amber' : 'text-ink-muted')}>{device.cameraCode ? `Camera ${device.cameraCode}` : 'Not linked'}</p>
            {confirming
                ? (
                    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                        <span className="text-xs text-ink">Remove {device.name}? Its camera returns to the simulation loop.</span>
                        <button type="button" disabled={pending} onClick={remove} className={cn(action, 'border-danger/40 text-[#F2865A] hover:bg-danger/15 disabled:opacity-50')}>Remove</button>
                        <button type="button" disabled={pending} onClick={() => setConfirming(false)} className={action}>Cancel</button>
                    </div>
                )
                : (
                    <button type="button" onClick={() => setConfirming(true)} aria-label={`Remove ${device.name}`} className={action}>
                        <Trash2 aria-hidden className="h-3.5 w-3.5" />
                        Remove
                    </button>
                )}
            {problem && <p role="alert" className="w-full text-xs text-[#F2865A]">{problem}</p>}
        </li>
    );
}

export function LiveScreen({ user, bar, connect }: { user: SessionUser; bar: TopBarCounts; connect: { url: string | null; qrSvg: string | null } | null })
{
    const { devices, error, refresh } = useLiveDevices(3000);
    const [connecting, setConnecting] = useState(false);
    const host = useSyncExternalStore(noSubscribe, () => window.location.hostname, () => null);
    const isAdmin = user.role === 'ADMIN';
    const online = devices.filter(device => device.online);

    return (
        <main className="relative min-h-full overflow-x-hidden bg-night-950">
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(215,227,234,0.06)_1px,transparent_1px)] [mask-image:linear-gradient(to_bottom,black,transparent_70%)] bg-[size:22px_22px]" />
            <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[60rem] max-w-[200vw] -translate-x-1/2 rounded-full bg-amber/[0.06] blur-3xl" />

            <div className="sticky top-0 z-20 p-3">
                <TopBar user={user} current="live" {...bar} />
            </div>

            <div className="relative mx-auto max-w-6xl px-4 pt-6 pb-16 sm:px-6 sm:pt-10">
                <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.18em] text-ink-muted uppercase">
                            <span aria-hidden className="relative flex h-1.5 w-1.5">
                                {online.length > 0 && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok/60 motion-reduce:hidden" />}
                                <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', online.length > 0 ? 'bg-ok' : 'bg-ink-muted')} />
                            </span>
                            {online.length} {online.length === 1 ? 'phone' : 'phones'} sending
                        </p>
                        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Live cameras</h1>
                        <p className="mt-1.5 text-sm text-ink-muted">Phones sending over the local Wi-Fi. Pictures refresh about five times a second.</p>
                    </div>
                    {isAdmin && (
                        <button type="button" onClick={() => setConnecting(true)} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-amber px-4 text-sm font-semibold text-night-950 transition-colors hover:bg-amber/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber max-sm:w-full">
                            <QrCode aria-hidden className="h-4 w-4" />
                            Connect phone
                        </button>
                    )}
                </header>

                {error && <p role="alert" className="mt-6 rounded-lg border border-danger/35 bg-danger/[0.07] px-3 py-2 text-sm text-[#F2865A]">{error}</p>}

                {online.length > 0
                    ? (
                        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {online.map(device => <Tile key={device.id} device={device} />)}
                        </div>
                    )
                    : (
                        <div className="mt-8 flex flex-col items-center rounded-2xl border border-dashed border-white/12 bg-night-900/40 px-6 py-14 text-center">
                            <span className="grid h-12 w-12 place-items-center rounded-full bg-white/5 ring-1 ring-white/10">
                                <Smartphone aria-hidden className="h-5 w-5 text-ink-muted" />
                            </span>
                            <p className="mt-4 font-medium text-ink">No phones are sending right now.</p>
                            <p className="mt-1.5 max-w-md text-sm text-ink-muted">
                                {isAdmin
                                    ? <>Open <strong className="font-semibold text-ink">Connect phone</strong>, scan the QR code with a phone on the same Wi-Fi, sign in as a volunteer or admin, and press Start.</>
                                    : <>Ask an admin for the Connect phone QR code, or open <span className="font-mono break-all text-ink">https://{host ?? 'this-laptop'}:3443/cam</span> on a phone on the same Wi-Fi.</>}
                            </p>
                        </div>
                    )}

                {isAdmin && (
                    <section aria-labelledby="phones-heading" className="mt-10 rounded-2xl border border-white/8 bg-night-900/70 p-4 sm:p-5">
                        <h2 id="phones-heading" className="text-sm font-semibold text-ink">Phones</h2>
                        <p className="mt-1 text-xs text-ink-muted">Every phone that has signed up to send. Link one to a map camera from Setup or the camera panel.</p>
                        {devices.length > 0
                            ? <ul className="mt-3 divide-y divide-white/8 rounded-xl border border-white/8">{devices.map(device => <PhoneRow key={device.id} device={device} onRemoved={refresh} />)}</ul>
                            : <p className="mt-3 text-sm text-ink-muted">No phones yet.</p>}
                    </section>
                )}

                {isAdmin && <RecordingsPanel />}
            </div>

            {connecting && connect && <ConnectPhone url={connect.url} qrSvg={connect.qrSvg} onClose={() => setConnecting(false)} />}
        </main>
    );
}
