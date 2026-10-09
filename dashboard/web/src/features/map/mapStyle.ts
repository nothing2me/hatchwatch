import type { StyleSpecification } from 'maplibre-gl';

export const IMAGERY_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const LABELS_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

// Background first so zones, cameras and panels stay readable if tiles fail to load.
export function buildMapStyle(): StyleSpecification
{
    return {
        version: 8,
        sources: {
            imagery: { type: 'raster', tiles: [IMAGERY_URL], tileSize: 256, maxzoom: 19, attribution: 'Esri, Maxar, Earthstar Geographics' },
            labels: { type: 'raster', tiles: [LABELS_URL], tileSize: 256, maxzoom: 19 },
        },
        layers: [
            { id: 'background', type: 'background', paint: { 'background-color': '#0A1118' } },
            { id: 'imagery', type: 'raster', source: 'imagery', paint: { 'raster-brightness-max': 0.72, 'raster-saturation': -0.15 } },
            { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.85 } },
        ],
    };
}
