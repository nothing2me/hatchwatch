'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Smartphone, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GlassPanel } from '@/components/ui/glass-panel';

const STEPS = [
    'Join the same Wi-Fi as this computer',
    'Scan, then tap Advanced → Proceed on the certificate warning',
    'Sign in and tap Start streaming',
    'Back here, pick the device as a camera’s Source',
];

// QR code and link for the phone camera page. Opened from the top bar by admins.
export function ConnectDeviceDialog({ onClose }: { onClose: () => void })
{
    const [url, setUrl] = useState<string | null | undefined>(undefined);
    const [qr, setQr] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const panel = useRef<HTMLDivElement>(null);

    useEffect(() =>
    {
        panel.current?.focus();
        const onKey = (event: KeyboardEvent) =>
        {
            if (event.key === 'Escape')
            {
                onClose();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    useEffect(() =>
    {
        fetch('/api/live/cam-url', { cache: 'no-store' })
            .then(response => (response.ok ? response.json() as Promise<{ url: string | null }> : { url: null }))
            .then(body => setUrl(body.url))
            .catch(() => setUrl(null));
    }, []);

    useEffect(() =>
    {
        if (url)
        {
            QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: '#0A1118', light: '#D7E3EA' } }).then(setQr).catch(() => setQr(null));
        }
    }, [url]);

    async function copy()
    {
        if (url)
        {
            await navigator.clipboard?.writeText(url).catch(() => undefined);
            setCopied(true);
        }
    }

    return (
        <div className="pointer-events-auto fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
            <GlassPanel
                ref={panel}
                role="dialog"
                aria-modal="true"
                aria-labelledby="connect-device-title"
                tabIndex={-1}
                className="relative w-full max-w-sm p-5 outline-none"
                onClick={event => event.stopPropagation()}
            >
                <button type="button" onClick={onClose} aria-label="Close" className="absolute top-3 right-3 grid h-7 w-7 place-items-center rounded-md text-ink-muted hover:bg-white/10 hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"><X className="h-4 w-4" /></button>
                <h2 id="connect-device-title" className="flex items-center gap-2 text-base font-semibold"><Smartphone aria-hidden className="h-4 w-4 text-amber" />Connect a phone camera</h2>

                {url === undefined && <p className="mt-4 text-sm text-ink-muted">Loading…</p>}
                {url === null && (
                    <p className="mt-4 text-sm text-ink-muted">
                        Set <code className="font-mono text-ink">LAN_HOST</code> in <code className="font-mono text-ink">dashboard/.env</code> to this computer&rsquo;s Wi-Fi IP address and rebuild (<code className="font-mono text-ink">docker compose up -d --build</code>), or open the dashboard by its Wi-Fi address.
                    </p>
                )}
                {url && (
                    <>
                        <div className="mt-4 grid place-items-center">
                            {qr ? <img src={qr} alt="QR code for the camera page" width={220} height={220} className="rounded-lg" /> : <div className="h-[220px] w-[220px] rounded-lg bg-white/5" />}
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                            <code className="min-w-0 flex-1 truncate rounded-md bg-night-950 px-2 py-1.5 font-mono text-xs select-all">{url}</code>
                            <Button size="sm" onClick={copy} aria-label="Copy link"><Copy aria-hidden className="h-3.5 w-3.5" />{copied ? 'Copied' : 'Copy'}</Button>
                        </div>
                        <ol className="mt-4 space-y-1.5 text-sm text-ink-muted">
                            {STEPS.map((step, index) => (
                                <li key={step} className="flex gap-2"><span className="font-mono text-amber">{index + 1}</span>{step}</li>
                            ))}
                        </ol>
                    </>
                )}
            </GlassPanel>
        </div>
    );
}

// The top-bar button that opens the dialog. A client island so server-rendered pages can show it too.
export function ConnectDeviceButton()
{
    const [open, setOpen] = useState(false);
    const close = useCallback(() => setOpen(false), []);
    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                title="Connect a phone or laptop as a live camera"
                className="inline-flex h-7 items-center gap-1.5 rounded-full bg-white/5 px-2.5 text-xs text-ink-muted transition-colors hover:bg-white/10 hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"
            >
                <Smartphone aria-hidden className="h-3.5 w-3.5" />
                <span className="max-lg:sr-only">Connect device</span>
            </button>
            {open && <ConnectDeviceDialog onClose={close} />}
        </>
    );
}
