'use client';

import { VideoOff } from 'lucide-react';
import { GlassPanel } from '@/components/ui/glass-panel';
import { isNestSite } from '@/lib/danger';
import type { SessionUser } from '@/lib/auth/session';
import type { CameraView, MapSnapshot } from '@/lib/types';
import { cn } from '@/lib/cn';
import { useLiveSnapshot } from '@/features/live/useLiveSnapshot';
import { TopBar } from '@/features/shell/TopBar';
import { CameraVideo } from './CameraVideo';

function CameraCard({ camera }: { camera: CameraView })
{
    return (
        <GlassPanel className="min-w-0 overflow-hidden p-3">
            <div className="flex items-center justify-between gap-3 px-1 pb-1">
                <div>
                    <h3 className="text-sm font-semibold text-ink">Camera {camera.code}</h3>
                    <p className="text-xs text-ink-muted">Zone {camera.zoneCode}</p>
                </div>
                <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium', camera.status === 'ONLINE' ? 'bg-ok/10 text-ok' : 'bg-white/8 text-ink-muted')}>
                    {camera.status === 'ONLINE' ? 'Online' : 'Offline'}
                </span>
            </div>
            {camera.status === 'ONLINE' && camera.video
                ? <CameraVideo key={camera.video.id} video={camera.video} />
                : <div className="mt-2 grid aspect-video place-content-center gap-2 rounded-lg bg-night-950 text-center text-sm text-ink-muted"><VideoOff aria-hidden className="mx-auto h-6 w-6" />{camera.status === 'ONLINE' ? 'No footage yet' : 'Camera offline'}</div>}
        </GlassPanel>
    );
}

export function AllCamerasScreen({ user, initialSnapshot }: { user: SessionUser; initialSnapshot: MapSnapshot })
{
    const snapshot = useLiveSnapshot(initialSnapshot);
    const activeSites = snapshot.alerts.filter(alert => isNestSite(alert) && alert.site.active).length;
    const firstDangerId = snapshot.alerts.find(alert => alert.kind === 'DANGER' && alert.site.active)?.id ?? null;

    return (
        <main className="min-h-full bg-night-950">
            <div className="sticky top-0 z-20 bg-night-950/90 p-3 backdrop-blur-md">
                <TopBar user={user} current="cameras" camerasOnline={snapshot.camerasOnline} camerasTotal={snapshot.camerasTotal} activeSites={activeSites} dangerCount={snapshot.dangerCount} firstDangerId={firstDangerId} />
            </div>
            <div className="mx-auto max-w-[1500px] px-4 pt-4 pb-16 sm:px-6">
                <div className="mb-7">
                    <h1 className="text-3xl font-semibold tracking-tight text-ink">Cameras</h1>
                    <p className="mt-1.5 text-sm text-ink-muted">All camera views · {snapshot.camerasOnline} of {snapshot.camerasTotal} online</p>
                </div>
                <div className="space-y-9">
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
                                <div className="grid gap-4 md:grid-cols-2">
                                    {cameras.map(camera => <CameraCard key={camera.id} camera={camera} />)}
                                </div>
                            </section>
                        );
                    })}
                </div>
            </div>
        </main>
    );
}
