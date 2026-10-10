// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isMarkerClick } from '@/features/map/markerClick';

describe('isMarkerClick', () =>
{
    it('counts clicks inside a marker and on elements already removed, not on the map itself', () =>
    {
        const map = document.createElement('div');
        const marker = document.createElement('div');
        marker.className = 'maplibregl-marker';
        const button = document.createElement('button');
        marker.append(button);
        map.append(marker);
        document.body.append(map);
        expect(isMarkerClick(button)).toBe(true);
        expect(isMarkerClick(map)).toBe(false);
        expect(isMarkerClick(null)).toBe(false);
        button.remove();
        expect(isMarkerClick(button)).toBe(true);
        map.remove();
    });
});
