'use client';

import { useEffect, useRef, useState, useTransition, type RefObject } from 'react';
import { Check, Copy, TriangleAlert, X } from 'lucide-react';
import { addBoardCamera, type IssuedTokenResult } from '@/app/(app)/cameras/actions';
import { cn } from '@/lib/cn';
import { useModal } from './ConnectPhone';

type Issued = Extract<IssuedTokenResult, { ok: true }>;

const CA_COMMAND = 'docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt';
const field = 'h-10 w-full min-w-0 rounded-lg border border-white/12 bg-night-950/70 px-3 font-mono text-[13px] text-ink select-all focus-visible:outline-2 focus-visible:outline-amber';
const button = 'inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber disabled:opacity-50';
const primary = cn(button, 'bg-amber font-semibold text-night-950 hover:bg-amber/90');
const secondary = cn(button, 'border border-white/12 text-ink hover:bg-white/8');

// The token, the id and the secrets.h lines. It lives only in the dialog's state; closing the dialog drops it.
export function IssuedTokenPanel({ issued }: { issued: Issued })
{
    const linesRef = useRef<HTMLPreElement>(null);
    const [copied, setCopied] = useState(false);

    async function copy()
    {
        try
        {
            await navigator.clipboard.writeText(issued.secrets);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
        catch
        {
            // No clipboard: select the lines so they can be copied by hand.
            const range = document.createRange();
            if (linesRef.current)
            {
                range.selectNodeContents(linesRef.current);
                window.getSelection()?.removeAllRanges();
                window.getSelection()?.addRange(range);
            }
        }
    }

    return (
        <div className="mt-4 space-y-4">
            <p className="flex gap-2.5 rounded-lg border border-amber/30 bg-amber/10 p-3 text-sm text-ink">
                <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
                <span>This token is shown only once. Copy it into secrets.h now; if it is lost, use Rotate token.</span>
            </p>
            <div className="grid gap-3">
                <label className="grid gap-1 text-xs text-ink-muted">
                    Device id
                    <input readOnly value={issued.deviceId} spellCheck={false} autoComplete="off" className={field} />
                </label>
                <label className="grid gap-1 text-xs text-ink-muted">
                    Device token
                    <input readOnly value={issued.token} spellCheck={false} autoComplete="off" className={field} />
                </label>
            </div>
            <div>
                <p className="text-sm text-ink">Replace the DASHBOARD_URL, DEVICE_ID and DEVICE_TOKEN lines already in firmware/esp32s3-cam/secrets.h with these lines. Do not add a second copy.</p>
                <div className="mt-2 overflow-hidden rounded-lg border border-white/12 bg-night-950/70">
                    <pre ref={linesRef} aria-label="secrets.h lines" className="max-h-48 overflow-auto p-3 font-mono text-[12px] leading-relaxed text-ink">{issued.secrets}</pre>
                    <div className="flex justify-end border-t border-white/8 p-1">
                        <button type="button" onClick={copy} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-ink transition-colors hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-amber">
                            {copied ? <Check aria-hidden className="h-3.5 w-3.5 text-ok" /> : <Copy aria-hidden className="h-3.5 w-3.5" />}
                            {copied ? 'Copied' : 'Copy secrets.h lines'}
                        </button>
                    </div>
                </div>
            </div>
            {issued.dashboardUrl === null && (
                <p className="rounded-lg border border-danger/35 bg-danger/[0.07] p-3 text-sm text-[#F2865A]">LAN_HOST is not set in dashboard/.env, so DASHBOARD_URL is empty. Set it and paste the address by hand.</p>
            )}
            <div className="text-sm text-ink-muted">
                <p>Then paste Caddy&apos;s root certificate into the existing DASHBOARD_CA block in secrets.h and upload the firmware. To print the certificate, run this in dashboard/:</p>
                <code className="mt-1.5 block overflow-x-auto rounded-md bg-night-950/70 px-2.5 py-1.5 font-mono text-[12px] whitespace-nowrap text-ink">{CA_COMMAND}</code>
            </div>
        </div>
    );
}

function Shell({ titleId, title, subtitle, dialogRef, closeRef, onClose, children }: { titleId: string; title: string; subtitle: string; dialogRef: RefObject<HTMLDivElement | null>; closeRef: RefObject<HTMLButtonElement | null>; onClose: () => void; children: React.ReactNode })
{
    return (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/75 p-3 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-lg min-w-0 rounded-2xl border border-white/10 bg-night-900 p-5 shadow-2xl shadow-black/60">
                <div className="flex items-start gap-3">
                    <div className="min-w-0">
                        <h2 id={titleId} className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
                        <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>
                    </div>
                    <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-muted transition-colors hover:bg-white/10 hover:text-ink focus-visible:outline-2 focus-visible:outline-amber">
                        <X aria-hidden className="h-5 w-5" />
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
}

// Two phases in one dialog: the name form, then the token. The parent unmounts it on close, so the token goes with it.
export function AddBoardDialog({ onClose, onAdded, returnTo }: { onClose(): void; onAdded(): void; returnTo?: RefObject<HTMLElement | null> })
{
    const dialogRef = useRef<HTMLDivElement>(null);
    const nameRef = useRef<HTMLInputElement>(null);
    const doneRef = useRef<HTMLButtonElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const [name, setName] = useState('');
    const [problem, setProblem] = useState<string | null>(null);
    const [issued, setIssued] = useState<Issued | null>(null);
    const [pending, startTransition] = useTransition();
    useModal(dialogRef, nameRef, onClose, returnTo);

    useEffect(() =>
    {
        if (issued)
        {
            doneRef.current?.focus();
        }
    }, [issued]);

    function submit(event: React.FormEvent<HTMLFormElement>)
    {
        event.preventDefault();
        setProblem(null);
        startTransition(async () =>
        {
            const result = await addBoardCamera(name);
            if (result.ok)
            {
                setIssued(result);
                onAdded();
            }
            else
            {
                setProblem(result.error);
            }
        });
    }

    return (
        <Shell titleId="add-board-title" title="Add board camera" subtitle={issued ? `${issued.name} is ready. It can send once secrets.h has these lines.` : 'An ESP32 camera board sends its pictures with its own token.'} dialogRef={dialogRef} closeRef={closeRef} onClose={onClose}>
            {issued
                ? (
                    <>
                        <IssuedTokenPanel issued={issued} />
                        <div className="mt-5 flex justify-end">
                            <button ref={doneRef} type="button" onClick={onClose} className={cn(primary, 'max-sm:w-full')}>Done</button>
                        </div>
                    </>
                )
                : (
                    <form onSubmit={submit} className="mt-4">
                        <label className="grid gap-1 text-xs text-ink-muted">
                            Board name
                            <input ref={nameRef} required autoFocus maxLength={60} value={name} onChange={event => setName(event.target.value)} autoComplete="off" placeholder="North dune board" className="h-10 w-full rounded-lg border border-white/12 bg-night-950/70 px-3 text-sm text-ink placeholder:text-ink-muted/60 focus-visible:outline-2 focus-visible:outline-amber" />
                        </label>
                        {problem && <p role="alert" className="mt-2 text-xs text-[#F2865A]">{problem}</p>}
                        <div className="mt-5 flex flex-wrap justify-end gap-2">
                            <button type="button" onClick={onClose} className={cn(secondary, 'max-sm:flex-1')}>Cancel</button>
                            <button type="submit" disabled={pending} className={cn(primary, 'max-sm:flex-1')}>Add</button>
                        </div>
                    </form>
                )}
        </Shell>
    );
}

export function IssuedTokenDialog({ issued, title, onClose, returnTo }: { issued: Issued; title: string; onClose(): void; returnTo?: RefObject<HTMLElement | null> })
{
    const dialogRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const doneRef = useRef<HTMLButtonElement>(null);
    useModal(dialogRef, doneRef, onClose, returnTo);
    return (
        <Shell titleId={`issued-${issued.deviceId}`} title={title} subtitle="The old token no longer works." dialogRef={dialogRef} closeRef={closeRef} onClose={onClose}>
            <IssuedTokenPanel issued={issued} />
            <div className="mt-5 flex justify-end">
                <button ref={doneRef} type="button" onClick={onClose} className={cn(primary, 'max-sm:w-full')}>Done</button>
            </div>
        </Shell>
    );
}
