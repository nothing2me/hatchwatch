import { describe, expect, it } from 'vitest';
import { feedFor, feedKey } from '@/features/cameras/feed';
import type { CameraView } from '@/lib/types';

const camera = (over: Partial<CameraView> = {}): CameraView => ({
    id: 'c1', code: 'B1', zoneCode: 'B', position: [0, 0], headingDeg: 0, fovDeg: 44, rangeM: 300, status: 'ONLINE', calibrated: false,
    video: { id: 'v1', source: 'SIMULATION', durationS: 40, hasMotion: true, simRunId: 'R' }, liveDeviceId: null, ...over,
});

describe('feedFor', () =>
{
    it('prefers an online assigned device', () =>
    {
        const feed = feedFor(camera({ liveDeviceId: 'd1' }), { B1: { deviceId: 'd1', name: 'Pixel', online: true } });
        expect(feed).toEqual({ kind: 'live', deviceId: 'd1', deviceName: 'Pixel' });
        expect(feedKey(feed)).toBe('live:d1');
    });
    it('falls back to the loop and names the offline device', () =>
    {
        const feed = feedFor(camera({ liveDeviceId: 'd1' }), { B1: { deviceId: 'd1', name: 'Pixel', online: false } });
        expect(feed).toMatchObject({ kind: 'sim', deviceOffline: 'Pixel' });
        expect(feedKey(feed)).toBe('sim:v1');
    });
    it('plain simulation, offline camera, no footage', () =>
    {
        expect(feedFor(camera(), {})).toMatchObject({ kind: 'sim', deviceOffline: null });
        expect(feedFor(camera({ status: 'OFFLINE' }), {})).toEqual({ kind: 'none', reason: 'offline' });
        expect(feedFor(camera({ video: null }), {})).toEqual({ kind: 'none', reason: 'no-footage' });
        expect(feedKey(feedFor(camera({ video: null }), {}))).toBe('none');
    });
    it('an offline camera stays offline even with a device', () =>
    {
        expect(feedFor(camera({ status: 'OFFLINE', liveDeviceId: 'd1' }), { B1: { deviceId: 'd1', name: 'P', online: true } })).toEqual({ kind: 'none', reason: 'offline' });
    });
    it('a live device works on a camera with no footage yet', () =>
    {
        expect(feedFor(camera({ video: null }), { B1: { deviceId: 'd1', name: 'P', online: true } })).toMatchObject({ kind: 'live' });
        expect(feedFor(camera({ video: null }), { B1: { deviceId: 'd1', name: 'P', online: false } })).toEqual({ kind: 'none', reason: 'no-footage', deviceOffline: 'P' });
    });
});
