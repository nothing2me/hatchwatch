'use client';

import { useCallback, useEffect, useId, useState, useTransition } from 'react';
import { setCameraSource } from '@/app/(app)/camera-actions';
import type { LiveDeviceView } from '@/lib/types';
import { cn } from '@/lib/cn';

// Admin picker: the simulation loop or one linked phone. Without a `devices` prop it loads the phones itself.
export function SourceSelect({ cameraCode, value, devices: given, label = 'Source', hideLabel = false, className }: { cameraCode: string; value: string | null; devices?: LiveDeviceView[]; label?: string; hideLabel?: boolean; className?: string })
{
    const id = useId();
    const [loaded, setLoaded] = useState<LiveDeviceView[]>([]);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();
    const fetching = given === undefined;

    const load = useCallback(async () =>
    {
        try
        {
            const response = await fetch('/api/live/devices', { cache: 'no-store' });
            if (!response.ok)
            {
                throw new Error(String(response.status));
            }
            const body = await response.json() as { devices?: unknown };
            if (!Array.isArray(body.devices))
            {
                throw new Error('bad body');
            }
            setLoaded(body.devices as LiveDeviceView[]);
            setLoadError(null);
        }
        catch
        {
            setLoadError('Could not load phones.');
        }
    }, []);

    useEffect(() =>
    {
        if (fetching)
        {
            void load();
        }
    }, [fetching, load]);

    const devices = given ?? loaded;
    // A failed load still keeps the current link selectable.
    const current = value && !devices.some(device => device.id === value) ? [{ id: value, name: 'Linked phone', ownerName: '', cameraCode, online: false, recording: false, lastSeenAt: '' }] : [];

    function change(next: string)
    {
        setError(null);
        startTransition(async () =>
        {
            const result = await setCameraSource(cameraCode, next || null);
            if (!result.ok)
            {
                setError(result.error);
            }
        });
    }

    return (
        <div className={cn('min-w-0', className)}>
            <label htmlFor={id} className={hideLabel ? 'sr-only' : 'mb-1 block text-[10px] tracking-[0.12em] text-ink-muted uppercase'}>{label}</label>
            <select
                id={id}
                value={value ?? ''}
                disabled={pending}
                onFocus={fetching ? () => void load() : undefined}
                onChange={event => change(event.target.value)}
                className="h-9 w-full rounded-lg border border-white/12 bg-night-950/70 px-2 text-[13px] text-ink focus-visible:outline-2 focus-visible:outline-amber disabled:opacity-50"
            >
                <option value="">Simulation loop</option>
                {[...current, ...devices].map(device =>
                {
                    const elsewhere = device.cameraCode !== null && device.cameraCode !== cameraCode;
                    const label = device.ownerName ? `${device.name} · ${device.ownerName} · ${device.online ? 'online' : 'offline'}` : device.name;
                    return <option key={device.id} value={device.id} disabled={elsewhere}>{label}{elsewhere ? ` (feeds ${device.cameraCode})` : ''}</option>;
                })}
            </select>
            {loadError && <p className="mt-1 text-xs text-ink-muted">{loadError}</p>}
            {error && <p role="alert" className="mt-1 text-xs text-[#F2865A]">{error}</p>}
        </div>
    );
}
