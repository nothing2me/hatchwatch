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

export function alertKey(alert: { id: string; videoId: string | null; simRunId: string | null }): string
{
    // A camera-level danger has no clip: its own key never matches a playing feed.
    return alert.simRunId ?? alert.videoId ?? `alert:${alert.id}`;
}

export function isActive(alert: AlertView, playback: Playback | null): boolean
{
    return playback !== null
        && alertKey(alert) === playback.key
        && playback.t >= alert.startT - SLACK_S
        && playback.t <= alert.endT + SLACK_S;
}

// Without playback every positioned alert is shown; while a feed plays only its active pins are.
export function visibleAlerts(alerts: AlertView[], playback: Playback | null): AlertView[]
{
    const positioned = alerts.filter(alert => alert.position !== null);
    return playback ? positioned.filter(alert => isActive(alert, playback)) : positioned;
}
