'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibre from 'maplibre-gl';
import { ImageOff } from 'lucide-react';
import { forwardRef, useMemo, useState } from 'react';
import Map, { Layer, Marker, Source, type MapRef } from 'react-map-gl/maplibre';
import type { FeatureCollection } from 'geojson';
import { cn } from '@/lib/cn';
import { boundsOf, viewCone } from '@/lib/geo';
import type { MapSnapshot } from '@/lib/types';
import { fitPadding, initialBounds } from './bounds';
import { buildMapStyle } from './mapStyle';
import { type Playback, visibleAlerts } from './playback';
import type { LayerKey } from './MapControls';

export { initialBounds } from './bounds';

// Pass the library in so Turbopack does not dynamic-import it, and point MapLibre
// at the worker chunk. Its default worker URL is resolved from the library module,
// which 404s once the bundler moves that module.
maplibre.setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).href);

interface MapViewProps
{
    snapshot: MapSnapshot;
    layers: Record<LayerKey, boolean>;
    selectedCameraId: string | null;
    onSelectCamera: (cameraId: string) => void;
    playback: Playback | null;
}

const levelDot = { HIGH: 'bg-level-high', MEDIUM: 'bg-level-medium', LOW: 'bg-level-low' } as const;

const levelColor = ['match', ['get', 'level'], 'HIGH', '#E2581F', 'MEDIUM', '#FFB547', '#4C8DD6'] as unknown as string;

// Pins seen by both cameras of a pair are green; single-camera pins stay amber.
const tierFill = ['match', ['get', 'tier'], 'TWO_CAMERA', 'rgba(74,222,128,0.25)', 'SINGLE_CAMERA', 'rgba(255,181,71,0.25)', 'rgba(255,181,71,0.2)'] as unknown as string;
const tierStroke = ['match', ['get', 'tier'], 'TWO_CAMERA', '#4ADE80', '#FFB547'] as unknown as string;
// Pins a metre or two apart overlap at beach zoom; grow them only as the map zooms in.
const alertRadius = ['interpolate', ['linear'], ['zoom'], 14, 4, 18, 10, 20, 16] as unknown as number;

export const MapView = forwardRef<MapRef, MapViewProps>(function MapView({ snapshot, layers, selectedCameraId, onSelectCamera, playback }, ref)
{
    const [imageryOffline, setImageryOffline] = useState(false);
    const style = useMemo(buildMapStyle, []);

    const zonesGeoJson = useMemo<FeatureCollection>(() => ({
        type: 'FeatureCollection',
        features: snapshot.zones.map(zone => ({
            type: 'Feature',
            properties: { code: zone.code, level: zone.activityLevel },
            geometry: { type: 'Polygon', coordinates: [zone.ring] },
        })),
    }), [snapshot.zones]);

    const conesGeoJson = useMemo<FeatureCollection>(() => ({
        type: 'FeatureCollection',
        features: snapshot.cameras.map(camera => ({
            type: 'Feature',
            properties: { selected: camera.id === selectedCameraId },
            geometry: { type: 'Polygon', coordinates: [viewCone(camera.position, camera.headingDeg, camera.fovDeg, camera.rangeM)] },
        })),
    }), [snapshot.cameras, selectedCameraId]);

    // Rebuild (and so MapLibre setData) only when the visible set changes, not on every clock tick.
    const visibleIds = visibleAlerts(snapshot.alerts, playback).map(alert => alert.id).join(',');
    const alertsGeoJson = useMemo<FeatureCollection>(() =>
    {
        const ids = new Set(visibleIds.split(','));
        return {
            type: 'FeatureCollection',
            features: snapshot.alerts.filter(alert => alert.position !== null && ids.has(alert.id)).map(alert => ({
                type: 'Feature',
                properties: { status: alert.status, tier: alert.evidenceTier ?? 'NONE' },
                geometry: { type: 'Point', coordinates: alert.position! },
            })),
        };
    }, [snapshot.alerts, visibleIds]);

    const [[west, south], [east, north]] = initialBounds(snapshot);
    const padding = typeof window === 'undefined' ? 80 : fitPadding(window.innerWidth, window.innerHeight);

    return (
        // isolate keeps marker z-indexes from climbing above the overlay panels.
        <div className="absolute inset-0 isolate">
            <Map
                ref={ref}
                mapLib={maplibre}
                mapStyle={style}
                initialViewState={{ bounds: [west, south, east, north], fitBoundsOptions: { padding } }}
                maxZoom={20}
                dragRotate
                attributionControl={{ compact: true }}
                onError={event =>
                {
                    // Only a failing satellite source means imagery is offline.
                    if ((event as { sourceId?: string }).sourceId === 'imagery')
                    {
                        setImageryOffline(true);
                    }
                }}
                style={{ position: 'absolute', inset: 0 }}
            >
                {layers.cameras && (
                    <Source id="cones" type="geojson" data={conesGeoJson}>
                        <Layer id="cone-fill" type="fill" paint={{
                            'fill-color': ['case', ['get', 'selected'], '#FFB547', '#D7E3EA'] as unknown as string,
                            'fill-opacity': ['case', ['get', 'selected'], 0.2, 0.07] as unknown as number,
                        }} />
                        <Layer id="cone-line" type="line" paint={{
                            'line-color': ['case', ['get', 'selected'], '#FFB547', '#D7E3EA'] as unknown as string,
                            'line-opacity': ['case', ['get', 'selected'], 0.9, 0.28] as unknown as number,
                            'line-width': ['case', ['get', 'selected'], 1.5, 1] as unknown as number,
                            'line-dasharray': [2, 2],
                        }} />
                    </Source>
                )}
                {layers.zones && (
                    <Source id="zones" type="geojson" data={zonesGeoJson}>
                        <Layer id="zone-fill" type="fill" paint={{ 'fill-color': levelColor, 'fill-opacity': 0.22 }} />
                        <Layer id="zone-line" type="line" paint={{ 'line-color': levelColor, 'line-width': 2 }} />
                    </Source>
                )}
                {layers.alerts && (
                    <Source id="alerts" type="geojson" data={alertsGeoJson}>
                        <Layer id="alert-ring" type="circle" paint={{
                            'circle-radius': alertRadius, 'circle-color': tierFill,
                            'circle-stroke-color': tierStroke, 'circle-stroke-width': 2,
                        }} />
                    </Source>
                )}

                {layers.zones && snapshot.zones.filter(zone => zone.ring.length > 0).map(zone =>
                {
                    const [[w, s], [e, n]] = boundsOf(zone.ring);
                    // Set beside the centre so digging pins near the middle of a zone are not covered.
                    return (
                        <Marker key={`label-${zone.id}`} longitude={(w + e) / 2} latitude={(s + n) / 2} anchor="right" offset={[-14, 0]} style={{ pointerEvents: 'none' }}>
                            <span className="flex items-center gap-1.5 rounded-md bg-night-950/80 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.14em] text-ink ring-1 ring-white/10 backdrop-blur-sm">
                                <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', levelDot[zone.activityLevel])} />
                                <span className="max-md:sr-only">ZONE </span>{zone.code}
                            </span>
                        </Marker>
                    );
                })}

                {layers.cameras && snapshot.cameras.map(camera =>
                {
                    const selected = camera.id === selectedCameraId;
                    const online = camera.status === 'ONLINE';
                    return (
                        <Marker key={camera.id} longitude={camera.position[0]} latitude={camera.position[1]} style={{ zIndex: selected ? 2 : 1 }}>
                            <button
                                type="button"
                                onClick={() => onSelectCamera(camera.id)}
                                aria-label={`Camera ${camera.code}, ${online ? 'online' : 'offline'}`}
                                aria-pressed={selected}
                                className={cn(
                                    'grid h-7 w-7 cursor-pointer place-items-center rounded-full border-2 text-[10px] font-bold shadow-md shadow-black/50 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber',
                                    selected
                                        ? 'border-white bg-amber text-night-950 ring-4 ring-amber/35'
                                        : online ? 'border-white bg-night-700 text-ink' : 'border-white/60 bg-[#5b6b75] text-white/70 line-through')}
                            >
                                {camera.code}
                            </button>
                        </Marker>
                    );
                })}
            </Map>

            {imageryOffline && (
                <p role="status" className="pointer-events-none absolute top-[72px] left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-night-900/90 px-3 py-1.5 text-xs whitespace-nowrap text-ink-muted ring-1 ring-white/10">
                    <ImageOff aria-hidden className="h-3.5 w-3.5" />
                    Imagery offline; showing zones and cameras only
                </p>
            )}
        </div>
    );
});
