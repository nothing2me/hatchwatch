'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import { Cpu, QrCode, ScanSearch, Smartphone, VideoOff } from 'lucide-react';
import { GlassPanel } from '@/components/ui/glass-panel';
import { isNestSite } from '@/lib/danger';
import type { SessionUser } from '@/lib/auth/session';
import type { CameraView, LiveDeviceView, MapSnapshot } from '@/lib/types';
import { cn } from '@/lib/cn';
import { useLiveSnapshot } from '@/features/live/useLiveSnapshot';
import { AddBoardDialog } from '@/features/phones/BoardToken';
import { ConnectPhone } from '@/features/phones/ConnectPhone';
import { DeviceTile } from '@/features/phones/DeviceTile';
import { DevicesPanel } from '@/features/phones/DevicesPanel';
import { RecordingsPanel } from '@/features/phones/RecordingsPanel';
import { useDetectionsToggle } from '@/features/phones/useDetectionsToggle';
import { useLiveDevices } from '@/features/phones/useLiveDevices';
import { TopBar } from '@/features/shell/TopBar';
import { CameraVideo } from './CameraVideo';

const action = 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/12 px-2.5 text-xs text-ink transition-colors hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-amber';

const noSubscribe = () => () => {};

function OfflineBadge({ text, name }: { text: string; name: string })
{
    return (
        <span data-testid="device-offline" className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-night-950/85 px-2 py-1 text-[11px] text-ink ring-1 ring-white/12">
            <VideoOff aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
            <span className="shrink-0 font-medium">{text}</span>
            <span className="truncate text-ink-muted">· {name}</span>
        </span>
    );
}

// One map camera: its linked device live, the recorded clip with an offline note when that device is not sending, or the clip alone.
function CameraCard({ camera, device, loaded, detectionsOn }: { camera: CameraView; device: LiveDeviceView | null; loaded: boolean; detectionsOn: boolean })
{
    const linked = camera.liveDevice;
    // Before the first devices response a linked camera shows its clip without calling the device offline.
    const offline = linked && loaded && !device ? (linked.kind === 'BOARD' ? 'Board offline' : 'Phone offline') : null;
    const clip = camera.status === 'ONLINE' && camera.video ? camera.video : null;
    const online = camera.status === 'ONLINE' || device !== null;
    return (
        <GlassPanel role="article" aria-label={`Camera ${camera.code}`} className="min-w-0 overflow-hidden p-3">
            <div className="flex items-center justify-between gap-3 px-1 pb-1">
                <div>
                    <h3 className="text-sm font-semibold text-ink">Camera {camera.code}</h3>
                    <p className="text-xs text-ink-muted">Zone {camera.zoneCode}</p>
                </div>
                <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium', online ? 'bg-ok/10 text-ok' : 'bg-white/8 text-ink-muted')}>
                    {online ? 'Online' : 'Offline'}
                </span>
            </div>
            {device
                ? <div className="mt-2"><DeviceTile device={device} detectionsOn={detectionsOn} mask={null} live /></div>
                : clip
                ? (
                    <div className="relative">
                        <CameraVideo key={clip.id} video={clip} />
                        {offline && linked && <span className="absolute bottom-2 left-2 max-w-[calc(100%-8rem)]"><OfflineBadge text={offline} name={linked.name} /></span>}
                    </div>
                )
                : (
                    <div className="mt-2 grid aspect-video place-content-center justify-items-center gap-2 rounded-lg bg-night-950 px-3 text-center text-sm text-ink-muted">
                        <VideoOff aria-hidden className="mx-auto h-6 w-6" />
                        {offline && linked
                            ? <OfflineBadge text={offline} name={linked.name} />
                            : camera.status === 'ONLINE' ? 'No footage yet' : 'Camera offline'}
                    </div>
                )}
        </GlassPanel>
    );
}

export function AllCamerasScreen({ user, initialSnapshot, connect }: { user: SessionUser; initialSnapshot: MapSnapshot; connect: { url: string | null; qrSvg: string | null } | null })
{
    const snapshot = useLiveSnapshot(initialSnapshot);
    const [detectionsOn, setDetectionsOn] = useDetectionsToggle();
    const { devices, loaded, error, refresh } = useLiveDevices(detectionsOn ? 1000 : 3000);
    const [connecting, setConnecting] = useState(false);
    const [adding, setAdding] = useState(false);
    const addRef = useRef<HTMLButtonElement>(null);
    const host = useSyncExternalStore(noSubscribe, () => window.location.hostname, () => null);
    const isAdmin = user.role === 'ADMIN';
    const activeSites = snapshot.alerts.filter(alert => isNestSite(alert) && alert.site.active).length;
    const firstDangerId = snapshot.alerts.find(alert => alert.kind === 'DANGER' && alert.site.active)?.id ?? null;
    const online = devices.filter(device => device.online);
    const liveFor = (camera: CameraView) => online.find(device => device.id === camera.liveDevice?.id) ?? null;
    // Online devices not already shown on a map camera (unlinked, or linked to a camera the snapshot has not caught up with).
    const shownOnMap = new Set(snapshot.cameras.map(camera => liveFor(camera)?.id).filter(Boolean));
    const unlinked = online.filter(device => !shownOnMap.has(device.id));

    return (
        <main className="relative min-h-full overflow-x-hidden bg-night-950">
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(215,227,234,0.06)_1px,transparent_1px)] [mask-image:linear-gradient(to_bottom,black,transparent_70%)] bg-[size:22px_22px]" />
            <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[60rem] max-w-[200vw] -translate-x-1/2 rounded-full bg-amber/[0.06] blur-3xl" />

            <div className="sticky top-0 z-20 p-3">
                <TopBar user={user} current="cameras" camerasOnline={snapshot.camerasOnline} camerasTotal={snapshot.camerasTotal} activeSites={activeSites} dangerCount={snapshot.dangerCount} firstDangerId={firstDangerId} />
            </div>

            <div className="relative mx-auto max-w-[1500px] px-4 pt-6 pb-16 sm:px-6 sm:pt-10">
                <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Cameras</h1>
                        <p className="mt-1.5 flex items-center gap-2 text-sm text-ink-muted">
                            <span aria-hidden className="relative flex h-1.5 w-1.5 shrink-0">
                                {online.length > 0 && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok/60 motion-reduce:hidden" />}
                                <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', online.length > 0 ? 'bg-ok' : 'bg-ink-muted')} />
                            </span>
                            <span>{snapshot.camerasOnline} of {snapshot.camerasTotal} map cameras online · {online.length} {online.length === 1 ? 'device' : 'devices'} sending</span>
                        </p>
                    </div>
                    <div className="flex shrink-0 gap-2 max-sm:w-full max-sm:flex-col">
                        <button type="button" aria-pressed={detectionsOn} onClick={() => setDetectionsOn(!detectionsOn)} className={cn(action, 'h-10 justify-center px-4 text-sm', detectionsOn && 'border-amber/50 text-amber ring-1 ring-amber/40')}>
                            <ScanSearch aria-hidden className="h-4 w-4" />
                            Detections
                        </button>
                        {isAdmin && (
                            <>
                            <button ref={addRef} type="button" onClick={() => setAdding(true)} className={cn(action, 'h-10 justify-center px-4 text-sm')}>
                                <Cpu aria-hidden className="h-4 w-4" />
                                Add board camera
                            </button>
                            <button type="button" onClick={() => setConnecting(true)} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-amber px-4 text-sm font-semibold text-night-950 transition-colors hover:bg-amber/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber">
                                <QrCode aria-hidden className="h-4 w-4" />
                                Connect phone
                            </button>
                            </>
                        )}
                    </div>
                </header>

                {error && <p role="alert" className="mt-6 rounded-lg border border-danger/35 bg-danger/[0.07] px-3 py-2 text-sm text-[#F2865A]">{error}</p>}

                <div className="mt-8 space-y-9">
                    {snapshot.zones.map(zone =>
                    {
                        const cameras = snapshot.cameras.filter(camera => camera.zoneCode === zone.code);
                        if (cameras.length === 0) return null;
                        return (
                            <section key={zone.id} aria-labelledby={`zone-${zone.code}`}>
                                <div className="mb-3 flex items-baseline gap-3">
                                    <h2 id={`zone-${zone.code}`} className="text-lg font-semibold text-ink">Zone {zone.code}</h2>
                                    <span className="text-xs text-ink-muted">{zone.name}</span>
                                </div>
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                                    {cameras.map(camera => <CameraCard key={camera.id} camera={camera} device={liveFor(camera)} loaded={loaded} detectionsOn={detectionsOn} />)}
                                </div>
                            </section>
                        );
                    })}
                </div>

                <section aria-labelledby="devices-heading" className="mt-12">
                    <div className="mb-3 flex items-baseline gap-3">
                        <h2 id="devices-heading" className="text-lg font-semibold text-ink">Devices</h2>
                        <span className="text-xs text-ink-muted">Phones and boards not linked to a map camera</span>
                    </div>
                    {unlinked.length > 0
                        ? (
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                                {unlinked.map(device => <DeviceTile key={device.id} device={device} detectionsOn={detectionsOn} mask={null} />)}
                            </div>
                        )
                        : (
                            <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/12 bg-night-900/40 px-6 py-10 text-center">
                                <span className="grid h-12 w-12 place-items-center rounded-full bg-white/5 ring-1 ring-white/10">
                                    <Smartphone aria-hidden className="h-5 w-5 text-ink-muted" />
                                </span>
                                <p className="mt-4 font-medium text-ink">No unlinked phones or boards are sending.</p>
                                <p className="mt-1.5 max-w-md text-sm text-ink-muted">
                                    {isAdmin
                                        ? <>Open <strong className="font-semibold text-ink">Connect phone</strong>, scan the QR code with a phone on the same Wi-Fi, sign in as a volunteer or admin, and press Start.</>
                                        : <>Ask an admin for the Connect phone QR code, or open <span className="font-mono break-all text-ink">https://{host ?? 'this-laptop'}:3443/cam</span> on a phone on the same Wi-Fi.</>}
                                </p>
                            </div>
                        )}
                    {isAdmin && <DevicesPanel devices={devices} onRemoved={refresh} />}
                </section>

                {isAdmin && <RecordingsPanel />}
            </div>

            {adding && <AddBoardDialog onClose={() => setAdding(false)} onAdded={refresh} returnTo={addRef} />}
            {connecting && connect && <ConnectPhone url={connect.url} qrSvg={connect.qrSvg} onClose={() => setConnecting(false)} />}
        </main>
    );
}
