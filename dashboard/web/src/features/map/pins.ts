import type { Feature, Point } from 'geojson';
import type { AlertView } from '@/lib/types';
import { PROTECTION } from '@/features/sites/labels';
import { type Playback, visibleAlerts } from './playback';

export interface PinProperties
{
    id: string;
    color: string;
    strokeWidth: number;
    opacity: number;
    selected: boolean;
}

const TIER_COLOR = { TWO_CAMERA: '#4ADE80', SINGLE_CAMERA: '#FFB547' } as const;
export const FADED_OPACITY = 0.4;

export function isFaded(alert: AlertView, now: number, fadeMinutes: number): boolean
{
    const since = Date.parse(alert.site.detectedAt ?? alert.createdAt);
    return alert.site.active && !alert.site.personActed && now - since > fadeMinutes * 60_000;
}

// Active sites only. With no feed playing, pins show protection and fade once old and untouched;
// while a feed plays they keep the evidence colours of Plan A. Ring weight always shows the tier.
export function pinFeatures(alerts: AlertView[], playback: Playback | null, now: number, fadeMinutes: number, selectedId: string | null): Feature<Point, PinProperties>[]
{
    return visibleAlerts(alerts, playback).filter(alert => alert.site.active).map(alert => ({
        type: 'Feature',
        properties: {
            id: alert.id,
            color: playback ? TIER_COLOR[alert.evidenceTier ?? 'SINGLE_CAMERA'] : PROTECTION[alert.site.protection].color,
            strokeWidth: alert.evidenceTier === 'TWO_CAMERA' ? 2.5 : 1.25,
            opacity: !playback && isFaded(alert, now, fadeMinutes) ? FADED_OPACITY : 1,
            selected: alert.id === selectedId,
        },
        geometry: { type: 'Point', coordinates: alert.position! },
    }));
}
