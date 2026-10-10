'use client';

import * as maplibre from 'maplibre-gl';
import { useMemo } from 'react';
import Map, { Layer, Source } from 'react-map-gl/maplibre';
import type { FeatureCollection } from 'geojson';
import type { LngLat } from '@/lib/types';
import { buildMapStyle } from '@/features/map/mapStyle';

// Fixed satellite close-up of one site. MapView (always mounted first) has already set the worker URL.
export function SiteCloseUp({ position, color, faded = false }: { position: LngLat; color: string; faded?: boolean })
{
    const style = useMemo(buildMapStyle, []);
    const pin = useMemo<FeatureCollection>(() => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: position } }] }), [position]);

    return (
        <Map
            mapLib={maplibre}
            mapStyle={style}
            longitude={position[0]}
            latitude={position[1]}
            zoom={19}
            interactive={false}
            attributionControl={false}
            style={{ position: 'absolute', inset: 0 }}
        >
            <Source id="site" type="geojson" data={pin}>
                <Layer id="site-halo" type="circle" paint={{ 'circle-radius': 26, 'circle-color': color, 'circle-opacity': faded ? 0.06 : 0.12, 'circle-stroke-color': color, 'circle-stroke-width': 1, 'circle-stroke-opacity': 0.45 }} />
                <Layer id="site-pin" type="circle" paint={{ 'circle-radius': 8, 'circle-color': color, 'circle-opacity': faded ? 0.15 : 0.3, 'circle-stroke-color': color, 'circle-stroke-width': 2.5, 'circle-stroke-opacity': faded ? 0.4 : 1 }} />
            </Source>
        </Map>
    );
}
