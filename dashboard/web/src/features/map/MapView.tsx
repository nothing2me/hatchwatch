'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibre from 'maplibre-gl';
import { GripVertical, ImageOff, X } from 'lucide-react';
import { forwardRef, useMemo, useState } from 'react';
import Map, { Layer, Marker, Source, type MapRef } from 'react-map-gl/maplibre';
import type { FeatureCollection } from 'geojson';
import { cn } from '@/lib/cn';
import { boundsOf, viewCone } from '@/lib/geo';
import type { LngLat, MapSnapshot } from '@/lib/types';
import { fitPadding, initialBounds } from './bounds';
import { buildMapStyle } from './mapStyle';
import { isMarkerClick } from './markerClick';
import type { Playback } from './playback';
import { dangerPins, pinFeatures, SECURED_GREEN, securedAreaFeatures, securedLabels } from './pins';
import { trailFeatures } from './trails';
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
    // Admin edit mode: a click joins a zone within 150 m or starts a new zone there; camera markers can be dragged.
    editing?: boolean;
    onMapClick?: (at: LngLat) => void;
    // Resolves false when the server refused the move; the marker then returns to its saved spot.
    onMoveCamera?: (code: string, to: LngLat) => Promise<boolean>;
    // Map-made zones only: drag the zone label to move the outline with its cameras; × deletes an unused zone.
    onMoveZone?: (code: string, from: LngLat, to: LngLat) => Promise<boolean>;
    onDeleteZone?: (code: string) => Promise<boolean>;
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
// Red outer halo on a site whose danger is still open.
const haloRadius = ['interpolate', ['linear'], ['zoom'], 14, 8, 18, 15, 20, 22] as unknown as number;
const trailWidth = ['interpolate', ['linear'], ['zoom'], 14, 1.5, 18, 2.75, 20, 4] as unknown as number;
const casingWidth = ['interpolate', ['linear'], ['zoom'], 14, 3, 18, 5, 20, 7] as unknown as number;
const ALARM = '#FF4D5E';
// "Secured" labels appear once a 3 m circle is big enough on screen to carry one.
const SECURED_LABEL_ZOOM = 18.5;

export const MapView = forwardRef<MapRef, MapViewProps>(function MapView({ snapshot, layers, selectedCameraId, onSelectCamera, playback, now = Date.now(), selectedAlertId = null, onSelectAlert, editing = false, onMapClick, onMoveCamera, onMoveZone, onDeleteZone }, ref)
{
    const [imageryOffline, setImageryOffline] = useState(false);
    const [pinHover, setPinHover] = useState(false);
    const style = useMemo(buildMapStyle, []);
    // A dragged camera stays where it was dropped until the server's next snapshot moves it there (or back).
    const [dropped, setDropped] = useState<{ cameras: MapSnapshot['cameras']; at: Record<string, LngLat> }>({ cameras: snapshot.cameras, at: {} });
    if (dropped.cameras !== snapshot.cameras)
    {
        setDropped({ cameras: snapshot.cameras, at: {} });
    }
    // A dragged zone (outline and cameras) is drawn at its new place until the next snapshot, or put back if refused.
    const [zoneShift, setZoneShift] = useState<{ zones: MapSnapshot['zones']; code: string | null; by: LngLat }>({ zones: snapshot.zones, code: null, by: [0, 0] });
    if (zoneShift.zones !== snapshot.zones)
    {
        setZoneShift({ zones: snapshot.zones, code: null, by: [0, 0] });
    }
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
    if (!editing && confirmDelete)
    {
        setConfirmDelete(null);
    }
    const shift = (code: string, [lng, lat]: LngLat): LngLat => (zoneShift.code === code ? [lng + zoneShift.by[0], lat + zoneShift.by[1]] : [lng, lat]);
    const positionOf = (camera: MapSnapshot['cameras'][number]): LngLat => dropped.at[camera.id] ?? shift(camera.zoneCode, camera.position);

    const zonesGeoJson = useMemo<FeatureCollection>(() => ({
        type: 'FeatureCollection',
        features: snapshot.zones.map(zone => ({
            type: 'Feature',
            properties: { code: zone.code, level: zone.activityLevel },
            geometry: { type: 'Polygon', coordinates: [zone.code === zoneShift.code ? zone.ring.map(([lng, lat]) => [lng + zoneShift.by[0], lat + zoneShift.by[1]]) : zone.ring] },
        })),
    }), [snapshot.zones, zoneShift]);

    const conesGeoJson = useMemo<FeatureCollection>(() => ({
        type: 'FeatureCollection',
        features: snapshot.cameras.map(camera => ({
            type: 'Feature',
            properties: { selected: camera.id === selectedCameraId },
            geometry: { type: 'Polygon', coordinates: [viewCone(dropped.at[camera.id] ?? (zoneShift.code === camera.zoneCode ? [camera.position[0] + zoneShift.by[0], camera.position[1] + zoneShift.by[1]] : camera.position), camera.headingDeg, camera.fovDeg, camera.rangeM)] },
        })),
    }), [snapshot.cameras, selectedCameraId, dropped, zoneShift]);

    // Rebuild (and so MapLibre setData) only when a pin's look changes, not on every clock tick.
    const pinKey = JSON.stringify(pinFeatures(snapshot.alerts, playback, now, snapshot.fadeMinutes, selectedAlertId));
    const alertsGeoJson = useMemo<FeatureCollection>(() => ({ type: 'FeatureCollection', features: JSON.parse(pinKey) }), [pinKey]);
    const dangers = dangerPins(snapshot.alerts);
    const securedKey = JSON.stringify(securedAreaFeatures(snapshot.alerts));
    const securedAreas = useMemo<FeatureCollection>(() => ({ type: 'FeatureCollection', features: JSON.parse(securedKey) }), [securedKey]);
    const [securedLabelsOn, setSecuredLabelsOn] = useState(false);

    // Trails change only when the clock passes a recorded point; key on what is drawn, not on every tick.
    const trailKey = JSON.stringify(trailFeatures(snapshot.tracks ?? [], snapshot.alerts, playback));
    const trails = useMemo(() => JSON.parse(trailKey) as ReturnType<typeof trailFeatures>, [trailKey]);
    const trailLines = useMemo<FeatureCollection>(() => ({ type: 'FeatureCollection', features: trails.lines }), [trails]);
    const trailHeads = useMemo<FeatureCollection>(() => ({ type: 'FeatureCollection', features: trails.heads }), [trails]);
    const trailVisibility = layers.trails ? 'visible' : 'none';

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
                doubleClickZoom={!editing}
                attributionControl={{ compact: true }}
                interactiveLayerIds={!editing && layers.alerts && onSelectAlert ? ['alert-ring'] : []}
                cursor={editing ? 'crosshair' : pinHover ? 'pointer' : undefined}
                onZoom={event => setSecuredLabelsOn(event.viewState.zoom >= SECURED_LABEL_ZOOM)}
                onMouseEnter={() => setPinHover(true)}
                onMouseLeave={() => setPinHover(false)}
                onClick={event =>
                {
                    if (editing)
                    {
                        // Clicks on markers (cameras, zone labels) bubble to the map; they are not placements. React handles a
                        // marker's own click first (markers are portals) and may already have swapped the clicked element out.
                        if (!isMarkerClick(event.originalEvent?.target))
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
                {/* Always mounted and hidden by layout: a layer re-added on toggle would land above the trails and pins. */}
                <Source id="zones" type="geojson" data={zonesGeoJson}>
                    <Layer id="zone-fill" type="fill" layout={{ visibility: layers.zones ? 'visible' : 'none' }} paint={{ 'fill-color': levelColor, 'fill-opacity': 0.22 }} />
                    <Layer id="zone-line" type="line" layout={{ visibility: layers.zones ? 'visible' : 'none' }} paint={{ 'line-color': levelColor, 'line-width': 2 }} />
                </Source>
                {/* Secured areas: above zone fills, below trails, pins and danger rings. Shown with the sites layer. */}
                <Source id="secured" type="geojson" data={securedAreas}>
                    <Layer id="secured-fill" type="fill" layout={{ visibility: layers.alerts ? 'visible' : 'none' }} paint={{ 'fill-color': SECURED_GREEN, 'fill-opacity': 0.18 }} />
                    <Layer id="secured-line" type="line" layout={{ visibility: layers.alerts ? 'visible' : 'none' }} paint={{ 'line-color': SECURED_GREEN, 'line-width': 1.5, 'line-opacity': 0.9 }} />
                </Source>
                {/* Trails sit under the pins; hidden by layout so toggling keeps them below. */}
                <Source id="trails" type="geojson" data={trailLines}>
                    <Layer id="trail-casing" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round', visibility: trailVisibility }} paint={{ 'line-color': '#04080C', 'line-width': casingWidth, 'line-opacity': ['*', 0.55, ['get', 'opacity']] as unknown as number }} />
                    <Layer id="trail-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round', visibility: trailVisibility }} paint={{ 'line-color': ['get', 'color'] as unknown as string, 'line-width': trailWidth, 'line-opacity': ['get', 'opacity'] as unknown as number }} />
                </Source>
                <Source id="trail-heads" type="geojson" data={trailHeads}>
                    <Layer id="trail-head-glow" type="circle" layout={{ visibility: trailVisibility }} paint={{ 'circle-radius': 9, 'circle-color': ['get', 'color'] as unknown as string, 'circle-opacity': 0.22, 'circle-blur': 0.6 }} />
                    <Layer id="trail-head" type="circle" layout={{ visibility: trailVisibility }} paint={{ 'circle-radius': 4, 'circle-color': ['get', 'color'] as unknown as string, 'circle-stroke-color': '#04080C', 'circle-stroke-width': 1.25 }} />
                </Source>
                {layers.alerts && (
                    <Source id="alerts" type="geojson" data={alertsGeoJson}>
                        <Layer id="alert-danger-halo" type="circle" filter={['==', ['get', 'danger'], true]} paint={{
                            'circle-radius': haloRadius, 'circle-color': ALARM, 'circle-opacity': 0.14, 'circle-blur': 0.15,
                            'circle-stroke-color': ALARM, 'circle-stroke-width': 2, 'circle-stroke-opacity': 0.95,
                        }} />
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
                    const centre: LngLat = [(w + e) / 2, (s + n) / 2];
                    const [lng, lat] = shift(zone.code, centre);
                    const editable = editing && zone.editable === true && Boolean(onMoveZone);
                    const tag = (
                        <>
                            <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', levelDot[zone.activityLevel])} />
                            <span className="max-md:sr-only">ZONE </span>{zone.code}
                        </>
                    );
                    if (!editable)
                    {
                        // Set beside the centre so digging pins near the middle of a zone are not covered; map-made zones
                        // put it seaward, clear of the cameras on their land edge.
                        return (
                            <Marker key={`label-${zone.id}`} longitude={lng} latitude={lat} anchor={zone.editable ? 'left' : 'right'} offset={zone.editable ? [10, 0] : [-14, 0]} style={{ pointerEvents: 'none' }}>
                                <span className="flex items-center gap-1.5 rounded-md bg-night-950/80 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.14em] text-ink ring-1 ring-white/10 backdrop-blur-sm">{tag}</span>
                            </Marker>
                        );
                    }
                    const asking = confirmDelete === zone.code;
                    return (
                        // Seaward of the centre: a map-made zone's cameras stand on its land edge, so the tag must not cover them.
                        // Its own key: react-map-gl keeps style keys a marker once had, so reusing the read-only tag's marker
                        // would keep its pointer-events: none.
                        <Marker
                            key={`label-edit-${zone.id}`}
                            longitude={lng}
                            latitude={lat}
                            anchor="left"
                            offset={[10, 0]}
                            style={{ zIndex: 3, pointerEvents: 'auto' }}
                            draggable={!asking}
                            onDrag={event => setZoneShift(current => ({ ...current, code: zone.code, by: [event.lngLat.lng - centre[0], event.lngLat.lat - centre[1]] }))}
                            onDragEnd={event =>
                            {
                                const to: LngLat = [event.lngLat.lng, event.lngLat.lat];
                                setZoneShift(current => ({ ...current, code: zone.code, by: [to[0] - centre[0], to[1] - centre[1]] }));
                                void onMoveZone?.(zone.code, centre, to).then(saved =>
                                {
                                    if (!saved)
                                    {
                                        setZoneShift(current => ({ ...current, code: null, by: [0, 0] }));
                                    }
                                });
                            }}
                        >
                            <span
                                title={`Drag to move Zone ${zone.code} with its cameras`}
                                className="flex cursor-move items-center gap-1.5 rounded-md bg-night-950/90 py-0.5 pr-0.5 pl-1 text-[10px] font-semibold tracking-[0.14em] text-ink shadow-lg shadow-black/50 ring-2 ring-amber/60 backdrop-blur-sm"
                            >
                                <GripVertical aria-hidden className="h-3 w-3 text-amber/80" />
                                {tag}
                                {asking
                                    ? (
                                        <span role="group" aria-label={`Delete Zone ${zone.code}`} className="ml-1 flex items-center gap-1 border-l border-white/10 pl-1.5 font-sans text-[11px] font-medium tracking-normal">
                                            Delete Zone {zone.code} and its cameras?
                                            <button type="button" onClick={() => setConfirmDelete(null)} className="rounded px-1.5 py-0.5 text-ink-muted hover:bg-white/10 hover:text-ink focus-visible:outline-2 focus-visible:outline-amber">Keep</button>
                                            <button type="button" onClick={() => { setConfirmDelete(null); void onDeleteZone?.(zone.code); }} className="rounded bg-[#E2581F] px-1.5 py-0.5 font-semibold text-white hover:bg-[#ef6a33] focus-visible:outline-2 focus-visible:outline-white">Delete</button>
                                        </span>
                                    )
                                    : onDeleteZone && (
                                        <button type="button" onClick={() => setConfirmDelete(zone.code)} aria-label={`Delete Zone ${zone.code}`} className="ml-0.5 grid h-4 w-4 place-items-center rounded text-ink-muted hover:bg-[#E2581F]/25 hover:text-white focus-visible:outline-2 focus-visible:outline-amber">
                                            <X aria-hidden className="h-3 w-3" />
                                        </button>
                                    )}
                            </span>
                        </Marker>
                    );
                })}

                {layers.alerts && securedLabelsOn && securedLabels(securedAreas.features as ReturnType<typeof securedAreaFeatures>).map(label => (
                    // Under the circle's south edge, so it never covers the pin.
                    <Marker key={`secured-${label.id}`} longitude={label.position[0]} latitude={label.position[1]} anchor="top" offset={[0, 3]} style={{ pointerEvents: 'none' }}>
                        <span className="rounded-full bg-night-950/80 px-1.5 py-px font-mono text-[9px] font-semibold tracking-[0.16em] text-[#6EE7B7] uppercase ring-1 ring-[#34D399]/45 backdrop-blur-sm">Secured</span>
                    </Marker>
                ))}

                {layers.cameras && snapshot.cameras.map(camera =>
                {
                    const selected = camera.id === selectedCameraId;
                    const online = camera.status === 'ONLINE';
                    const [lng, lat] = positionOf(camera);
                    const draggable = editing && Boolean(onMoveCamera);
                    return (
                        <Marker
                            key={camera.id}
                            longitude={lng}
                            latitude={lat}
                            style={{ zIndex: selected ? 2 : 1 }}
                            draggable={draggable}
                            onDragEnd={event =>
                            {
                                const to: LngLat = [event.lngLat.lng, event.lngLat.lat];
                                setDropped(current => ({ ...current, at: { ...current.at, [camera.id]: to } }));
                                void onMoveCamera?.(camera.code, to).then(saved =>
                                {
                                    if (!saved)
                                    {
                                        setDropped(current =>
                                        {
                                            const { [camera.id]: _refused, ...rest } = current.at;
                                            return { ...current, at: rest };
                                        });
                                    }
                                });
                            }}
                        >
                            <button
                                type="button"
                                onClick={() => onSelectCamera(camera.id)}
                                aria-label={`Camera ${camera.code}, ${online ? 'online' : 'offline'}`}
                                title={draggable ? `Drag to move ${camera.code}` : undefined}
                                aria-pressed={selected}
                                className={cn(
                                    'grid h-7 w-7 place-items-center rounded-full border-2 text-[10px] font-bold shadow-md shadow-black/50 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber',
                                    draggable ? 'cursor-move ring-2 ring-amber/60' : 'cursor-pointer',
                                    selected
                                        ? 'border-white bg-amber text-night-950 ring-4 ring-amber/35'
                                        : online ? 'border-white bg-night-700 text-ink' : 'border-white/60 bg-[#5b6b75] text-white/70 line-through')}
                            >
                                {camera.code}
                            </button>
                        </Marker>
                    );
                })}
                {/* Level-1 dangers: pulsing red rings at the person's approach point, above everything else. */}
                {layers.alerts && dangers.map(pin => (
                    <Marker key={pin.id} longitude={pin.position[0]} latitude={pin.position[1]} style={{ zIndex: 4 }}>
                        <button
                            type="button"
                            onClick={event => { event.stopPropagation(); onSelectAlert?.(pin.id); }}
                            aria-label="Danger: person near a nest site"
                            title="Danger · person near a nest site"
                            className={cn('relative grid h-7 w-7 cursor-pointer place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
                                pin.id === selectedAlertId && 'ring-2 ring-amber ring-offset-2 ring-offset-transparent')}
                        >
                            <span aria-hidden className="danger-pin__wave absolute inset-0 rounded-full border-2 border-alarm" />
                            <span aria-hidden className="danger-pin__wave danger-pin__wave--late absolute inset-0 rounded-full border-2 border-alarm" />
                            <span aria-hidden className="relative grid h-4 w-4 place-items-center rounded-full bg-alarm shadow-[0_0_12px_rgba(255,77,94,0.9)] ring-2 ring-white">
                                <span className="h-1 w-1 rounded-full bg-white" />
                            </span>
                        </button>
                    </Marker>
                ))}
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
