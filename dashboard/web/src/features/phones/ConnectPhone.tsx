'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { Check, Copy, X } from 'lucide-react';

// Escape closes, Tab stays inside, and focus goes back to `returnTo` (or wherever it was) on close.
export function useModal(dialogRef: RefObject<HTMLElement | null>, initialFocus: RefObject<HTMLElement | null>, onClose: () => void, returnTo?: RefObject<HTMLElement | null>): void
{
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() =>
    {
        const previous = document.activeElement as HTMLElement | null;
        const back = returnTo?.current ?? previous;
        initialFocus.current?.focus();
        function onKey(event: KeyboardEvent)
        {
            if (event.key === 'Escape')
            {
                event.stopPropagation();
                onCloseRef.current();
            }
            else if (event.key === 'Tab' && dialogRef.current)
            {
                const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])'));
                if (items.length === 0)
                {
                    return;
                }
                const first = items[0];
                const last = items[items.length - 1];
                if (event.shiftKey && document.activeElement === first)
                {
                    event.preventDefault();
                    last.focus();
                }
                else if (!event.shiftKey && document.activeElement === last)
                {
                    event.preventDefault();
                    first.focus();
                }
            }
        }
        document.addEventListener('keydown', onKey, true);
        return () =>
        {
            document.removeEventListener('keydown', onKey, true);
            back?.focus?.();
        };
    }, [dialogRef, initialFocus, returnTo]);
}

const STEPS = ['Join the laptop\'s Wi-Fi.', 'Scan this code.', 'Accept the one-time certificate warning.', 'Sign in.', 'Press Start.'];

// Admin dialog with the QR code phones scan to open /cam. The SVG is generated on the server by the qrcode library from LAN_HOST, never from user input.
export function ConnectPhone({ url, qrSvg, onClose }: { url: string | null; qrSvg: string | null; onClose: () => void })
{
    const dialogRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const addressRef = useRef<HTMLElement>(null);
    const [copied, setCopied] = useState(false);
    useModal(dialogRef, closeRef, onClose);

    async function copy()
    {
        if (!url)
        {
            return;
        }
        try
        {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
        catch
        {
            // No clipboard on plain HTTP: select the address so it can be copied by hand.
            const range = document.createRange();
            if (addressRef.current)
            {
                range.selectNodeContents(addressRef.current);
                window.getSelection()?.removeAllRanges();
                window.getSelection()?.addRange(range);
            }
        }
    }

    return (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/75 p-3 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="connect-phone-title" className="w-full max-w-md rounded-2xl border border-white/10 bg-night-900 p-5 shadow-2xl shadow-black/60">
                <div className="flex items-start gap-3">
                    <div className="min-w-0">
                        <h2 id="connect-phone-title" className="text-lg font-semibold tracking-tight text-ink">Connect phone</h2>
                        <p className="mt-0.5 text-sm text-ink-muted">A phone on the same Wi-Fi becomes a live camera.</p>
                    </div>
                    <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-muted transition-colors hover:bg-white/10 hover:text-ink focus-visible:outline-2 focus-visible:outline-amber">
                        <X aria-hidden className="h-5 w-5" />
                    </button>
                </div>

                {url
                    ? (
                        <>
                            {qrSvg && (
                                <div
                                    aria-label="QR code for the phone address"
                                    role="img"
                                    className="mx-auto mt-5 w-56 max-w-full rounded-xl bg-white p-2 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
                                    dangerouslySetInnerHTML={{ __html: qrSvg }}
                                />
                            )}
                            <div className="mt-4 flex items-center gap-2 rounded-lg border border-white/12 bg-night-950/70 py-1 pr-1 pl-3">
                                <code ref={addressRef} className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink select-all">{url}</code>
                                <button type="button" onClick={copy} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs text-ink transition-colors hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-amber">
                                    {copied ? <Check aria-hidden className="h-3.5 w-3.5 text-ok" /> : <Copy aria-hidden className="h-3.5 w-3.5" />}
                                    {copied ? 'Copied' : 'Copy'}
                                </button>
                            </div>
                            <ol className="mt-5 space-y-2 text-sm text-ink">
                                {STEPS.map((step, index) => (
                                    <li key={step} className="flex gap-3">
                                        <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-amber/15 font-mono text-[11px] text-amber">{index + 1}</span>
                                        <span><span className="sr-only">{index + 1}. </span>{step}</span>
                                    </li>
                                ))}
                            </ol>
                        </>
                    )
                    : (
                        <p className="mt-5 rounded-lg border border-amber/30 bg-amber/10 p-3 text-sm text-ink">
                            Set LAN_HOST in dashboard/.env to this laptop&apos;s Wi-Fi address (macOS: <code className="font-mono">ipconfig getifaddr en0</code>) and restart the dashboard.
                        </p>
                    )}
            </div>
        </div>
    );
}
