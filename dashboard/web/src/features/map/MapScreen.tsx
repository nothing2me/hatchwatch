'use client';

import { useCallback, useRef, useState } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import type { SessionUser } from '@/lib/auth/session';
import type { AlertView, MapSnapshot } from '@/lib/types';
import { TopBar } from '@/features/shell/TopBar';
import { AlertsFeed } from '@/features/alerts/AlertsFeed';
import { CameraPanel } from '@/features/cameras/CameraPanel';
import { Legend } from './Legend';
import { MapControls, type LayerKey } from './MapControls';
import { fitPadding } from './bounds';
import { initialBounds, MapView } from './MapView';

export function MapScreen({ snapshot, user }: { snapshot: MapSnapshot; user: SessionUser })
{
    const mapRef = useRef<MapRef>(null);
    const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
    const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ zones: true, cameras: true, alerts: true });

    const selectedCamera = snapshot.cameras.find(camera => camera.id === selectedCameraId) ?? null;

    const fitBeach = useCallback(() =>
    {
        const [[west, south], [east, north]] = initialBounds(snapshot);
        mapRef.current?.fitBounds([west, south, east, north], { padding: fitPadding(window.innerWidth, window.innerHeight), duration: 800 });
    }, [snapshot]);

    const flyToAlert = useCallback((alert: AlertView) =>
    {
        if (alert.position)
        {
            mapRef.current?.flyTo({ center: alert.position, zoom: 18, duration: 900 });
        }
        const camera = snapshot.cameras.find(candidate => candidate.code === alert.cameraCode);
        if (camera)
        {
            setSelectedCameraId(camera.id);
        }
    }, [snapshot.cameras]);

    return (
        <main className="relative h-full overflow-hidden bg-night-950">
            <MapView ref={mapRef} snapshot={snapshot} layers={layers} selectedCameraId={selectedCameraId} onSelectCamera={setSelectedCameraId} />

            {/* Overlay grid; pointer-events pass through except on panels */}
            <div className="pointer-events-none absolute inset-0 flex flex-col gap-3 p-3">
                <TopBar user={user} camerasOnline={snapshot.camerasOnline} camerasTotal={snapshot.camerasTotal} activeAlertCount={snapshot.activeAlertCount} />

                <div className="flex min-h-0 flex-1 gap-3">
                    <div className="flex min-h-0 flex-col items-start max-md:absolute max-md:inset-x-3 max-md:bottom-9 max-md:max-h-[45%] md:w-72">
                        <AlertsFeed alerts={snapshot.alerts} onSelect={flyToAlert} />
                    </div>

                    <div className="ml-auto flex items-start gap-3">
                        {selectedCamera && (
                            <div className="max-md:absolute max-md:inset-x-3 max-md:bottom-9 max-md:z-10">
                                <CameraPanel camera={selectedCamera} onClose={() => setSelectedCameraId(null)} />
                            </div>
                        )}
                        <MapControls
                            onZoomIn={() => mapRef.current?.zoomIn({ duration: 300 })}
                            onZoomOut={() => mapRef.current?.zoomOut({ duration: 300 })}
                            onFit={fitBeach}
                            layers={layers}
                            onToggleLayer={key => setLayers(current => ({ ...current, [key]: !current[key] }))}
                        />
                    </div>
                </div>

                <div className="pointer-events-auto absolute right-3 bottom-9 max-md:hidden">
                    <Legend />
                </div>
            </div>
        </main>
    );
}
