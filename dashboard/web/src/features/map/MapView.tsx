'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibre from 'maplibre-gl';
import { ImageOff, X } from 'lucide-react';
import { forwardRef, useMemo, useState } from 'react';
import Map, { Layer, Marker, Source, type MapRef } from 'react-map-gl/maplibre';
import type { FeatureCollection } from 'geojson';
import { cn } from '@/lib/cn';
import { boundsOf, viewCone } from '@/lib/geo';
import type { LngLat, MapSnapshot } from '@/lib/types';
import { fitPadding, initialBounds } from './bounds';
import { buildMapStyle } from './mapStyle';
import type { Playback } from './playback';
import { pinFeatures } from './pins';
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
    now?: number;
    selectedAlertId?: string | null;
    onSelectAlert?: (alertId: string) => void;
    // Admin edit mode: map clicks place a camera pair; added zones show a remove control.
    editing?: boolean;
    onMapClick?: (at: LngLat) => void;
    onDeleteZone?: (code: string) => void;
}

const levelDot = { HIGH: 'bg-level-high', MEDIUM: 'bg-level-medium', LOW: 'bg-level-low' } as const;

const levelColor = ['match', ['get', 'level'], 'HIGH', '#E2581F', 'MEDIUM', '#FFB547', '#4C8DD6'] as unknown as string;

// Pin colour, ring weight and opacity are precomputed per feature (see pins.ts).
const pinPaint = {
    'circle-color': ['get', 'color'],
    'circle-opacity': ['*', 0.25, ['get', 'opacity']],
    'circle-stroke-color': ['get', 'color'],
    'circle-stroke-width': ['get', 'strokeWidth'],
    'circle-stroke-opacity': ['get', 'opacity'],
} as unknown as Record<string, string>;
// Pins a metre or two apart overlap at beach zoom; grow them only as the map zooms in.
const alertRadius = ['interpolate', ['linear'], ['zoom'], 14, 4, 18, 10, 20, 16] as unknown as number;
const selectedRadius = ['interpolate', ['linear'], ['zoom'], 14, 9, 18, 16, 20, 23] as unknown as number;

export const MapView = forwardRef<MapRef, MapViewProps>(function MapView({ snapshot, layers, selectedCameraId, onSelectCamera, playback, now = Date.now(), selectedAlertId = null, onSelectAlert, editing = false, onMapClick, onDeleteZone }, ref)
{
    const [imageryOffline, setImageryOffline] = useState(false);
    const [pinHover, setPinHover] = useState(false);
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

    // Rebuild (and so MapLibre setData) only when a pin's look changes, not on every clock tick.
    const pinKey = JSON.stringify(pinFeatures(snapshot.alerts, playback, now, snapshot.fadeMinutes, selectedAlertId));
    const alertsGeoJson = useMemo<FeatureCollection>(() => ({ type: 'FeatureCollection', features: JSON.parse(pinKey) }), [pinKey]);

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
                interactiveLayerIds={!editing && layers.alerts && onSelectAlert ? ['alert-ring'] : []}
                cursor={editing ? 'crosshair' : pinHover ? 'pointer' : undefined}
                onMouseEnter={() => setPinHover(true)}
                onMouseLeave={() => setPinHover(false)}
                onClick={event =>
                {
                    if (editing)
                    {
                        // Clicks on markers (cameras, zone labels) bubble to the map; they are not placements.
                        const target = event.originalEvent?.target;
                        if (!(target instanceof Element && target.closest('.maplibregl-marker')))
                        {
                            onMapClick?.([event.lngLat.lng, event.lngLat.lat]);
                        }
                        return;
                    }
                    const id = event.features?.[0]?.properties?.id;
                    if (typeof id === 'string')
                    {
                        onSelectAlert?.(id);
                    }
                }}
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
                        <Layer id="alert-selected" type="circle" filter={['==', ['get', 'selected'], true]} paint={{
                            'circle-radius': selectedRadius, 'circle-color': 'rgba(0,0,0,0)',
                            'circle-stroke-color': '#FFB547', 'circle-stroke-width': 1.5, 'circle-stroke-opacity': 0.9,
                        }} />
                        <Layer id="alert-ring" type="circle" paint={{ 'circle-radius': alertRadius, ...pinPaint }} />
                    </Source>
                )}

                {layers.zones && snapshot.zones.filter(zone => zone.ring.length > 0).map(zone =>
                {
                    const [[w, s], [e, n]] = boundsOf(zone.ring);
                    const removable = editing && zone.custom && onDeleteZone;
                    // Set beside the centre so digging pins near the middle of a zone are not covered.
                    // Added zones are small with cameras on their land edge, so their label sits off the sea edge instead.
                    const [lng, lat] = zone.custom && zone.ring.length >= 4
                        ? [(zone.ring[2][0] + zone.ring[3][0]) / 2, (zone.ring[2][1] + zone.ring[3][1]) / 2]
                        : [(w + e) / 2, (s + n) / 2];
                    return (
                        <Marker key={`label-${zone.id}`} longitude={lng} latitude={lat} anchor={zone.custom ? 'left' : 'right'} offset={zone.custom ? [10, 0] : [-14, 0]} style={{ pointerEvents: 'none', zIndex: removable ? 3 : undefined }}>
                            <span className={cn('flex items-center gap-1.5 rounded-md bg-night-950/80 py-0.5 pl-1.5 text-[10px] font-semibold tracking-[0.14em] text-ink ring-1 backdrop-blur-sm', removable ? 'pr-0.5 ring-amber/40' : 'pr-1.5 ring-white/10')}>
                                <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', levelDot[zone.activityLevel])} />
                                <span className="max-md:sr-only">ZONE </span>{zone.code}
                                {removable && (
                                    <button
                                        type="button"
                                        onClick={event => { event.stopPropagation(); onDeleteZone(zone.code); }}
                                        aria-label={`Remove zone ${zone.code}`}
                                        title={`Remove zone ${zone.code}`}
                                        className="pointer-events-auto grid h-4 w-4 cursor-pointer place-items-center rounded text-ink-muted transition-colors hover:bg-[#E2581F] hover:text-white focus-visible:outline-2 focus-visible:outline-amber"
                                    >
                                        <X aria-hidden className="h-3 w-3" />
                                    </button>
                                )}
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
