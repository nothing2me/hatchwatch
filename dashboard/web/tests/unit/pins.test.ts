import { describe, expect, it } from 'vitest';
import { dangerPins, pinFeatures } from '@/features/map/pins';
import { siteAlert } from './siteFixtures';

const now = Date.parse('2026-10-09T01:00:00.000Z');
const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();

describe('pinFeatures', () =>
{
    it('skips inactive sites and sites without a position', () =>
    {
        const features = pinFeatures([siteAlert('a'), siteAlert('b', { active: false }), siteAlert('c', {}, { position: null })], null, now, 5, null);
        expect(features.map(feature => feature.properties.id)).toEqual(['a']);
    });

    it('colours by protection with a thinner ring for single-camera pins', () =>
    {
        const [red, green, grey, thin] = pinFeatures([
            siteAlert('a'),
            siteAlert('b', { protection: 'protected' }),
            siteAlert('c', { protection: 'notNeeded' }),
            siteAlert('d', {}, { evidenceTier: 'SINGLE_CAMERA' }),
        ], null, now, 5, null).map(feature => feature.properties);
        expect(red).toMatchObject({ color: '#E2581F', strokeWidth: 2.5 });
        expect(green.color).toBe('#4ADE80');
        expect(grey.color).toBe('#8A9BA6');
        expect(thin).toMatchObject({ color: '#E2581F', strokeWidth: 1.25 });
    });

    it('fades untouched sites older than the fade window', () =>
    {
        const [old, fresh, touched, fallback] = pinFeatures([
            siteAlert('a', { detectedAt: minutesAgo(6) }),
            siteAlert('b', { detectedAt: minutesAgo(2) }),
            siteAlert('c', { detectedAt: minutesAgo(30), personActed: true }),
            siteAlert('d', {}, { createdAt: minutesAgo(9) }),
        ], null, now, 5, null).map(feature => feature.properties);
        expect(old.opacity).toBe(0.4);
        expect(fresh.opacity).toBe(1);
        expect(touched.opacity).toBe(1);
        expect(fallback.opacity).toBe(0.4);
    });

    it('keeps evidence colours and full opacity while a feed is playing', () =>
    {
        const playing = { key: 'live-000001-abc', t: 5 };
        const [both, one] = pinFeatures([
            siteAlert('a', { detectedAt: minutesAgo(60) }),
            siteAlert('b', {}, { evidenceTier: 'SINGLE_CAMERA' }),
        ], playing, now, 5, null).map(feature => feature.properties);
        expect(both).toMatchObject({ color: '#4ADE80', opacity: 1 });
        expect(one).toMatchObject({ color: '#FFB547', strokeWidth: 1.25 });
    });

    it('marks the selected site', () =>
    {
        const [a, b] = pinFeatures([siteAlert('a'), siteAlert('b')], null, now, 5, 'b').map(feature => feature.properties);
        expect(a.selected).toBe(false);
        expect(b.selected).toBe(true);
    });

    it('rings a site in its trail colour when it has one, in both modes', () =>
    {
        const [still] = pinFeatures([siteAlert('a', {}, { colorIndex: 1 })], null, now, 5, null).map(feature => feature.properties);
        const [playing] = pinFeatures([siteAlert('a', {}, { colorIndex: 1 })], { key: 'live-000001-abc', t: 5 }, now, 5, null).map(feature => feature.properties);
        expect(still.color).toBe('#F06292');
        expect(playing.color).toBe('#F06292');
        expect(still.strokeWidth).toBe(2.5);
    });

    it('leaves danger alerts out of the site pins and haloes a site while its danger is open', () =>
    {
        const features = pinFeatures([
            siteAlert('s1', { danger: 'active' }),
            siteAlert('s2', { danger: 'resolved' }),
            siteAlert('d1', { danger: 'active' }, { kind: 'DANGER', level: 1, siteId: 's1' }),
        ], null, now, 5, null).map(feature => feature.properties);
        expect(features.map(pin => pin.id)).toEqual(['s1', 's2']);
        expect(features[0].danger).toBe(true);
        expect(features[1].danger).toBe(false);
    });
});

describe('dangerPins', () =>
{
    it('lists open dangers with a position, never faded and not gated by the feed clock', () =>
    {
        const pins = dangerPins([
            siteAlert('d1', { danger: 'active', detectedAt: minutesAgo(90) }, { kind: 'DANGER', level: 1, siteId: 's1', position: [3, 4] }),
            siteAlert('d2', { danger: 'resolved', active: false }, { kind: 'DANGER', level: 1, siteId: 's1' }),
            siteAlert('d3', { danger: 'active' }, { kind: 'DANGER', level: 1, siteId: 's2', position: null }),
            siteAlert('s1'),
        ]);
        expect(pins).toEqual([{ id: 'd1', siteId: 's1', position: [3, 4] }]);
    });
});

