import type { AlertView } from '@/lib/types';

export interface Playback
{
    key: string;
    t: number;
}

const SLACK_S = 0.5;

export function playbackKey(video: { id: string; simRunId: string | null }): string
{
    return video.simRunId ?? video.id;
}

export function alertKey(alert: { videoId: string; simRunId: string | null }): string
{
    return alert.simRunId ?? alert.videoId;
}

export function isActive(alert: AlertView, playback: Playback | null): boolean
{
    return playback !== null
        && alertKey(alert) === playback.key
        && playback.t >= alert.startT - SLACK_S
        && playback.t <= alert.endT + SLACK_S;
}

// Nest-site pins are operational records and stay on the map while footage plays.
export function visibleAlerts(alerts: AlertView[], playback: Playback | null): AlertView[]
{
    void playback;
    return alerts.filter(alert => alert.position !== null);
}
