import type { Feature, LineString, Point } from 'geojson';
import { isNestSite } from '@/lib/danger';
import type { AlertView, LngLat, TrackView } from '@/lib/types';
import type { Playback } from './playback';

/** Trail colours in pin order (no amber: amber means "selected" and "needs patrol" elsewhere). */
export const TRAIL_PALETTE = ['#4FC3F7', '#F06292', '#AED581', '#BA68C8', '#4DB6AC', '#FFF176'] as const;
/** Trails no pin claimed. */
export const UNMATCHED_TRAIL = '#8A9BA6';
/** Opacity of whole trails shown when no feed is playing. */
export const RESTING_OPACITY = 0.6;

export function trailColor(colorIndex: number | null): string
{
    return colorIndex === null ? UNMATCHED_TRAIL : TRAIL_PALETTE[((colorIndex % TRAIL_PALETTE.length) + TRAIL_PALETTE.length) % TRAIL_PALETTE.length];
}

/** The part of a trail the clip has reached: every point at or before clock time `t`. */
export function clipTrail(points: TrackView['points'], t: number): TrackView['points']
{
    return points.filter(point => point.t <= t);
}

export interface TrailProperties { id: string; color: string; opacity: number }

// While a feed plays, that clip's trails grow with its clock and carry a head dot at their newest point.
// With no feed, matched active-site trails and current unmatched motion tracks remain visible.
export function trailFeatures(tracks: TrackView[], alerts: AlertView[], playback: Playback | null): { lines: Feature<LineString, TrailProperties>[]; heads: Feature<Point, TrailProperties>[] }
{
    const lines: Feature<LineString, TrailProperties>[] = [];
    const heads: Feature<Point, TrailProperties>[] = [];
    const line = (id: string, color: string, opacity: number, coordinates: LngLat[]) => lines.push({ type: 'Feature', properties: { id, color, opacity }, geometry: { type: 'LineString', coordinates } });

    if (!playback)
    {
        const active = new Set(alerts.filter(alert => isNestSite(alert) && alert.site.active).map(alert => alert.id));
        for (const track of tracks)
        {
            if (track.points.length >= 2 && (track.alertId === null || active.has(track.alertId)))
            {
                line(track.id, trailColor(track.colorIndex), track.alertId === null ? RESTING_OPACITY * 0.65 : RESTING_OPACITY, track.points.map(point => point.position));
            }
        }
        return { lines, heads };
    }

    for (const track of tracks)
    {
        if (track.key !== playback.key)
        {
            continue;
        }
        const reached = clipTrail(track.points, playback.t);
        if (reached.length === 0)
        {
            continue;
        }
        const color = trailColor(track.colorIndex);
        if (reached.length >= 2)
        {
            line(track.id, color, 1, reached.map(point => point.position));
        }
        heads.push({ type: 'Feature', properties: { id: track.id, color, opacity: 1 }, geometry: { type: 'Point', coordinates: reached[reached.length - 1].position } });
    }
    return { lines, heads };
}
