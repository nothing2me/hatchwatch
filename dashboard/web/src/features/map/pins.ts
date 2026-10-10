import type { Feature, Point, Polygon } from 'geojson';
import { circleRing, distanceBetween } from '@/lib/geo';
import { isNestSite } from '@/lib/danger';
import type { AlertView, LngLat } from '@/lib/types';
import { PROTECTION } from '@/features/sites/labels';
import { type Playback, visibleAlerts } from './playback';
import { trailColor } from './trails';

export interface PinProperties
{
    id: string;
    color: string;
    strokeWidth: number;
    opacity: number;
    selected: boolean;
    /** An open danger alert points at this site: drawn with a red outer halo. */
    danger: boolean;
}

const TIER_COLOR = { TWO_CAMERA: '#4ADE80', SINGLE_CAMERA: '#FFB547' } as const;
export const FADED_OPACITY = 0.4;

export function isFaded(alert: AlertView, now: number, fadeMinutes: number): boolean
{
    const since = Date.parse(alert.site.detectedAt ?? alert.createdAt);
    return alert.site.active && !alert.site.personActed && now - since > fadeMinutes * 60_000;
}

const isOpenDanger = (alert: AlertView) => alert.kind === 'DANGER' && alert.site.active;

// Active nest sites only. A site with a trail is ringed in its trail colour so the two read as one turtle;
// otherwise, with no feed playing, pins show protection and fade once old and untouched, and while a feed
// plays they keep the evidence colours of Plan A. Ring weight always shows the evidence tier.
export function pinFeatures(alerts: AlertView[], playback: Playback | null, now: number, fadeMinutes: number, selectedId: string | null): Feature<Point, PinProperties>[]
{
    const inDanger = new Set(alerts.filter(isOpenDanger).map(alert => alert.siteId));
    return visibleAlerts(alerts.filter(isNestSite), playback).filter(alert => alert.site.active).map(alert => ({
        type: 'Feature',
        properties: {
            id: alert.id,
            color: alert.colorIndex !== null
                ? trailColor(alert.colorIndex)
                : playback ? TIER_COLOR[alert.evidenceTier ?? 'SINGLE_CAMERA'] : PROTECTION[alert.site.protection].color,
            strokeWidth: alert.evidenceTier === 'TWO_CAMERA' ? 2.5 : 1.25,
            opacity: !playback && isFaded(alert, now, fadeMinutes) ? FADED_OPACITY : 1,
            selected: alert.id === selectedId,
            danger: inDanger.has(alert.id),
        },
        geometry: { type: 'Point', coordinates: alert.position! },
    }));
}

export interface DangerPin { id: string; siteId: string | null; position: LngLat }

// Open danger alerts at the person's approach point. They are alarms, so they are never faded and
// never wait for a feed's clock to reach them.
export function dangerPins(alerts: AlertView[]): DangerPin[]
{
    return alerts.filter(alert => isOpenDanger(alert) && alert.position !== null)
        .map(alert => ({ id: alert.id, siteId: alert.siteId, position: alert.position! }));
}

/** Real radius of the secured-area circle around a protected nest site. */
export const SECURED_RADIUS_M = 20;
/** Fill and outline colour of a secured area. */
export const SECURED_GREEN = '#34D399';

export interface SecuredAreaProperties { id: string; by: string; at: string }

// Active nest sites someone secured (protection set up or its danger resolved): a 20 m circle on the ground.
export function securedAreaFeatures(alerts: AlertView[]): Feature<Polygon, SecuredAreaProperties>[]
{
    return alerts.filter(alert => isNestSite(alert) && alert.site.active && alert.site.secured && alert.position !== null).map(alert => ({
        type: 'Feature',
        properties: { id: alert.id, by: alert.site.secured!.by, at: alert.site.secured!.at },
        geometry: { type: 'Polygon', coordinates: [circleRing(alert.position!, SECURED_RADIUS_M)] },
    }));
}

// "Secured" tags under the circles. Sites a few metres apart would stack their tags, so a circle that overlaps one
// already tagged goes without (its green circle still shows).
export function securedLabels(areas: Feature<Polygon, SecuredAreaProperties>[]): { id: string; position: LngLat }[]
{
    const labelled: LngLat[] = [];
    const labels: { id: string; position: LngLat }[] = [];
    for (const area of areas)
    {
        const ring = area.geometry.coordinates[0] as LngLat[];
        const centre: LngLat = [ring.reduce((sum, point) => sum + point[0], 0) / ring.length, ring.reduce((sum, point) => sum + point[1], 0) / ring.length];
        if (labelled.some(other => distanceBetween(other, centre) < 2 * SECURED_RADIUS_M + 1))
        {
            continue;
        }
        labelled.push(centre);
        labels.push({ id: area.properties.id, position: ring.reduce((low, point) => (point[1] < low[1] ? point : low), ring[0]) });
    }
    return labels;
}
