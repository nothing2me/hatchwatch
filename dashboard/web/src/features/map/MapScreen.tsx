'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import type { SessionUser } from '@/lib/auth/session';
import type { AlertView, LngLat, MapSnapshot } from '@/lib/types';
import { isNestSite } from '@/lib/danger';
import { addCameraPair, updateCamera } from '@/app/(app)/camera-actions';
import { TopBar } from '@/features/shell/TopBar';
import { AlertsFeed } from '@/features/alerts/AlertsFeed';
import { CameraPanel } from '@/features/cameras/CameraPanel';
import type { SeekRequest } from '@/features/cameras/CameraVideo';
import { useLiveSnapshot } from '@/features/live/useLiveSnapshot';
import { useNow } from '@/features/live/useNow';
import { SiteDrawer } from '@/features/sites/SiteDrawer';
import { EditCamerasBanner, type EditNotice } from './EditCamerasBanner';
import { Legend } from './Legend';
import { MapControls, type LayerKey } from './MapControls';
import { fitPadding } from './bounds';
import { initialBounds, MapView } from './MapView';
import { alertKey, type Playback, playbackKey } from './playback';

// `snapshot` is the server-rendered starting point; the live stream replaces it as things change.
export function MapScreen({ snapshot: initialSnapshot, user }: { snapshot: MapSnapshot; user: SessionUser })
{
    const snapshot = useLiveSnapshot(initialSnapshot);
    const now = useNow(30_000);
    // Open nest sites only. The Active tab also lists open dangers; those are counted by the top bar's red danger chip.
    const activeSites = snapshot.alerts.filter(alert => isNestSite(alert) && alert.site.active).length;
    const openDangers = snapshot.alerts.filter(alert => alert.kind === 'DANGER' && alert.site.active);
    const mapRef = useRef<MapRef>(null);
    const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
    // The open drawer keeps the last version of its site it saw, so a site that drops out of the
    // snapshot (an old site whose outcome was just recorded) does not slam the drawer shut.
    const liveSelected = snapshot.alerts.find(alert => alert.id === selectedAlertId) ?? null;
    const [heldAlert, setHeldAlert] = useState<AlertView | null>(null);
    if (liveSelected && liveSelected !== heldAlert)
    {
        setHeldAlert(liveSelected);
    }
    const selectedAlert = liveSelected ?? (heldAlert?.id === selectedAlertId ? heldAlert : null);
    const closeSite = useCallback(() => setSelectedAlertId(null), []);
    const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ zones: true, cameras: true, alerts: true, motion: true, trails: true });

    const selectedCamera = snapshot.cameras.find(camera => camera.id === selectedCameraId) ?? null;
    const [playback, setPlayback] = useState<Playback | null>(null);
    const [seek, setSeek] = useState<SeekRequest | null>(null);
    const selectedVideo = selectedCamera?.status === 'ONLINE' ? selectedCamera.video : null;

    // The playing feed drives the map clock; pins outside its window stay hidden.
    const handleTime = useCallback((t: number) =>
    {
        if (selectedVideo)
        {
            const key = playbackKey(selectedVideo);
            setPlayback(current => current?.key === key && current.t === t ? current : { key, t });
        }
    }, [selectedVideo]);

    // Opening a feed gates pins at once (nothing shows until its clock ticks); only no feed shows all pins.
    const selectCamera = useCallback((cameraId: string | null) =>
    {
        if (cameraId === selectedCameraId)
        {
            return;
        }
        const camera = snapshot.cameras.find(candidate => candidate.id === cameraId);
        const video = camera?.status === 'ONLINE' ? camera.video : null;
        if (video?.motionMap)
        {
            const lngs = video.motionMap.corners.map(point => point[0]);
            const lats = video.motionMap.corners.map(point => point[1]);
            mapRef.current?.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 180, maxZoom: 20, duration: 700 });
        }
        setSelectedCameraId(cameraId);
        setSeek(null);
        setPlayback(video ? { key: playbackKey(video), t: -Infinity } : null);
    }, [selectedCameraId, snapshot.cameras]);

    // Admin camera editing: a map click adds a seaward pair to the nearest zone; dragging a camera moves it.
    const isAdmin = user.role === 'ADMIN';
    const [editing, setEditing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<EditNotice>(null);

    const finishEditing = useCallback(() =>
    {
        setEditing(false);
        setNotice(null);
    }, []);

    useEffect(() =>
    {
        if (!editing)
        {
            return;
        }
        const onKey = (event: KeyboardEvent) =>
        {
            if (event.key === 'Escape')
            {
                finishEditing();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [editing, finishEditing]);

    useEffect(() =>
    {
        if (!notice)
        {
            return;
        }
        const timer = setTimeout(() => setNotice(null), 5000);
        return () => clearTimeout(timer);
    }, [notice]);

    const runEdit = useCallback(async <T extends object>(work: () => Promise<({ ok: true } & T) | { ok: false; error: string }>, done: (result: T) => string) =>
    {
        setBusy(true);
        setNotice(null);
        try
        {
            const result = await work();
            setNotice(result.ok ? { kind: 'ok', text: done(result) } : { kind: 'error', text: result.error });
            return result.ok;
        }
        catch
        {
            setNotice({ kind: 'error', text: 'That did not save. Check your connection and try again.' });
            return false;
        }
        finally
        {
            setBusy(false);
        }
    }, []);

    // A double click fires two clicks before `busy` re-renders; the ref stops the second placement.
    const placing = useRef(false);
    const placePair = useCallback((at: LngLat) =>
    {
        if (!editing || busy || placing.current)
        {
            return;
        }
        placing.current = true;
        void runEdit(() => addCameraPair(at), ({ codes, zoneCode }: { codes: [string, string]; zoneCode: string }) => `${codes.join(' · ')} added to Zone ${zoneCode}`).finally(() => { placing.current = false; });
    }, [editing, busy, runEdit]);

    // Resolves false when the move was refused, so the map puts the marker back.
    const moveCamera = useCallback(async (code: string, to: LngLat): Promise<boolean> =>
    {
        if (!editing)
        {
            return false;
        }
        return runEdit(() => updateCamera(code, { lng: to[0], lat: to[1] }), ({ code: moved }: { code: string }) => `${moved} moved`);
    }, [editing, runEdit]);

    const fitBeach = useCallback(() =>
    {
        const [[west, south], [east, north]] = initialBounds(snapshot);
        mapRef.current?.fitBounds([west, south, east, north], { padding: fitPadding(window.innerWidth, window.innerHeight), duration: 800 });
    }, [snapshot]);

    const flyToAlert = useCallback((alert: AlertView) =>
    {
        if (alert.position)
        {
            mapRef.current?.flyTo({ center: alert.position, zoom: alert.simulated ? 19.5 : 18, duration: 900 });
        }
        const camera = snapshot.cameras.find(candidate => candidate.code === alert.cameraCode);
        if (!camera)
        {
            return;
        }
        setSelectedCameraId(camera.id);
        const video = camera.status === 'ONLINE' ? camera.video : null;
        if (video && playbackKey(video) === alertKey(alert))
        {
            // Jump the feed to the alert so its pin shows now instead of when the loop reaches it.
            setSeek(current => ({ t: alert.startT, nonce: (current?.nonce ?? 0) + 1 }));
            setPlayback({ key: alertKey(alert), t: alert.startT });
        }
        else
        {
            setSeek(null);
            setPlayback(video ? { key: playbackKey(video), t: -Infinity } : null);
        }
    }, [snapshot.cameras]);

    // Cards and pins both open the site drawer and keep Plan A's fly-and-seek.
    const openSite = useCallback((alert: AlertView) =>
    {
        setSelectedAlertId(alert.id);
        flyToAlert(alert);
    }, [flyToAlert]);

    const openSiteById = useCallback((alertId: string) =>
    {
        const alert = snapshot.alerts.find(candidate => candidate.id === alertId);
        if (alert)
        {
            openSite(alert);
        }
    }, [snapshot.alerts, openSite]);

    // Other pages link the danger chip to /?alert=<id>; open it once the map is up, then tidy the address.
    const linked = useRef(false);
    useEffect(() =>
    {
        if (linked.current)
        {
            return;
        }
        linked.current = true;
        const id = new URLSearchParams(window.location.search).get('alert');
        if (id)
        {
            openSiteById(id);
            window.history.replaceState(null, '', window.location.pathname);
        }
    }, [openSiteById]);

    const linkedSite = selectedAlert?.siteId ? snapshot.alerts.find(alert => alert.id === selectedAlert.siteId) ?? null : null;
    const siteDangers = selectedAlert ? openDangers.filter(alert => alert.siteId === selectedAlert.id) : [];

    return (
        <main className="relative h-full overflow-hidden bg-night-950">
            <MapView ref={mapRef} snapshot={snapshot} layers={layers} selectedCameraId={selectedCameraId} onSelectCamera={selectCamera} playback={playback} now={now} selectedAlertId={selectedAlert?.id ?? null} onSelectAlert={openSiteById}
                editing={editing} onMapClick={placePair} onMoveCamera={moveCamera} />

            {editing && (
                <EditCamerasBanner busy={busy} notice={notice} onDone={finishEditing} />
            )}

            {/* Overlay grid; pointer-events pass through except on panels */}
            <div className="pointer-events-none absolute inset-0 flex flex-col gap-3 p-3">
                <TopBar user={user} current="map" camerasOnline={snapshot.camerasOnline} camerasTotal={snapshot.camerasTotal} activeSites={activeSites}
                    dangerCount={snapshot.dangerCount} firstDangerId={openDangers[0]?.id ?? null} onDanger={openSiteById} />

                <div className="flex min-h-0 flex-1 gap-3">
                    <div className="flex min-h-0 flex-col items-start max-md:absolute max-md:inset-x-3 max-md:bottom-9 max-md:max-h-[45%] md:w-72">
                        <AlertsFeed alerts={snapshot.alerts} inactiveCount={snapshot.inactiveCount} onSelect={openSite} playback={playback} selectedId={selectedAlert?.id ?? null} canResolve={user.role !== 'VIEWER'} />
                    </div>

                    <div className="ml-auto flex min-h-0 items-start gap-3 md:mb-6">
                        {selectedCamera && (
                            <div className="max-md:absolute max-md:inset-x-3 max-md:bottom-9 max-md:z-10">
                                <CameraPanel key={selectedCamera.id} camera={selectedCamera} onClose={() => selectCamera(null)} onTime={handleTime} seekTo={seek} />
                            </div>
                        )}
                        <MapControls
                            onZoomIn={() => mapRef.current?.zoomIn({ duration: 300 })}
                            onZoomOut={() => mapRef.current?.zoomOut({ duration: 300 })}
                            onFit={fitBeach}
                            layers={layers}
                            onToggleLayer={key => setLayers(current => ({ ...current, [key]: !current[key] }))}
                            editing={editing}
                            onToggleEdit={isAdmin ? () => (editing ? finishEditing() : setEditing(true)) : undefined}
                        />
                        {selectedAlert && <SiteDrawer key={selectedAlert.id} alert={selectedAlert} user={user} onClose={closeSite} fadeMinutes={snapshot.fadeMinutes} linkedSite={linkedSite} dangers={siteDangers} onOpenAlert={openSiteById} />}
                    </div>
                </div>

                {/* The legend sits where the camera panel and drawer end; it steps aside for both. */}
                {!selectedAlert && !selectedCamera && (
                    <div className="pointer-events-auto absolute right-3 bottom-9 max-md:hidden">
                        <Legend fadeMinutes={snapshot.fadeMinutes} />
                    </div>
                )}
            </div>
        </main>
    );
}
