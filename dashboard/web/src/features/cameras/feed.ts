import type { CameraView, FeedVideo } from '@/lib/types';
import type { LiveStatus } from '@/features/live/useLiveStatus';

// What a camera tile shows: an online assigned device wins; otherwise the simulation loop, if any.
export type Feed =
    | { kind: 'live'; deviceId: string; deviceName: string }
    | { kind: 'sim'; video: FeedVideo; deviceOffline: string | null }   // deviceOffline: the assigned device's name while it is offline
    | { kind: 'none'; reason: 'offline' | 'no-footage'; deviceOffline?: string };

export function feedFor(camera: CameraView, live: LiveStatus): Feed
{
    if (camera.status !== 'ONLINE')
    {
        return { kind: 'none', reason: 'offline' };
    }
    const device = live[camera.code];
    if (device && device.online)
    {
        return { kind: 'live', deviceId: device.deviceId, deviceName: device.name };
    }
    if (camera.video)
    {
        return { kind: 'sim', video: camera.video, deviceOffline: device ? device.name : null };
    }
    return { kind: 'none', reason: 'no-footage', ...(device ? { deviceOffline: device.name } : {}) };
}

export function feedKey(feed: Feed): string
{
    return feed.kind === 'live' ? `live:${feed.deviceId}` : feed.kind === 'sim' ? `sim:${feed.video.id}` : 'none';
}
