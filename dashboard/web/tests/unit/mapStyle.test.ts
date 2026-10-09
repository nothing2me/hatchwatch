import { describe, expect, it } from 'vitest';
import { buildMapStyle, IMAGERY_URL, LABELS_URL } from '@/features/map/mapStyle';

describe('buildMapStyle', () =>
{
    const style = buildMapStyle();

    it('keeps a dark background below the rasters so the map still reads offline', () =>
    {
        expect(style.layers[0]).toMatchObject({ id: 'background', type: 'background' });
        expect(style.layers.map(layer => layer.id)).toEqual(['background', 'imagery', 'labels']);
    });

    it('uses Esri imagery and labels with attribution', () =>
    {
        expect(style.sources.imagery).toMatchObject({ type: 'raster', tiles: [IMAGERY_URL] });
        expect(style.sources.labels).toMatchObject({ type: 'raster', tiles: [LABELS_URL] });
        expect(JSON.stringify(style.sources.imagery)).toContain('Esri');
    });
});
