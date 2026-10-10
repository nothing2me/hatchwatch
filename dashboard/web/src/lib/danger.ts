import { ALERT_MESSAGES, type LngLat } from '@/lib/types';

export const DANGER_MESSAGE = ALERT_MESSAGES.DANGER;
export const DANGER_RADIUS_M = 3;
/** A site is watched from this many seconds before its digging interval starts. */
export const DANGER_LEAD_S = 2;
/** At most one danger per site per this many seconds, whichever person tracks were seen. */
export const DANGER_SITE_WINDOW_S = 60;
/** Person paths are densified to this step so a fast pass between samples is not missed. */
const STEP_M = 0.25;

export interface DangerSite { alertId: string; position: LngLat; startT: number }
export interface DangerPerson { id: string; points: { t: number; position: LngLat }[] }
export interface Danger { alertId: string; personId: string; at: number; position: LngLat; startT: number; endT: number; closestT: number }

const EARTH_M = 6_371_008.8;
const RAD = Math.PI / 180;

// Local east/north metres around an origin; exact enough over a beach.
function toLocal(origin: LngLat, [lng, lat]: LngLat): [number, number]
{
    return [(lng - origin[0]) * RAD * EARTH_M * Math.cos(origin[1] * RAD), (lat - origin[1]) * RAD * EARTH_M];
}

function toLngLat(origin: LngLat, [east, north]: [number, number]): LngLat
{
    return [origin[0] + east / (RAD * EARTH_M * Math.cos(origin[1] * RAD)), origin[1] + north / (RAD * EARTH_M)];
}

// Samples of one person path in site-local metres, densified between recorded points.
function samples(origin: LngLat, points: DangerPerson['points']): { t: number; xy: [number, number] }[]
{
    const ordered = [...points].sort((a, b) => a.t - b.t).map(point => ({ t: point.t, xy: toLocal(origin, point.position) }));
    const out: { t: number; xy: [number, number] }[] = [];
    ordered.forEach((point, index) =>
    {
        const next = ordered[index + 1];
        out.push(point);
        if (!next)
        {
            return;
        }
        const steps = Math.ceil(Math.hypot(next.xy[0] - point.xy[0], next.xy[1] - point.xy[1]) / STEP_M);
        for (let step = 1; step < steps; step += 1)
        {
            const f = step / steps;
            out.push({ t: point.t + f * (next.t - point.t), xy: [point.xy[0] + f * (next.xy[0] - point.xy[0]), point.xy[1] + f * (next.xy[1] - point.xy[1])] });
        }
    });
    return out;
}

/**
 * Person tracks that come within DANGER_RADIUS_M of a site at or after `startT − 2 s`.
 * One danger per (person, site): the first approach; `startT`/`endT` bound that approach and `position`/`closestT` are its closest sample.
 */
export function findDangers(sites: DangerSite[], people: DangerPerson[]): Danger[]
{
    const dangers: Danger[] = [];
    for (const site of sites)
    {
        for (const person of people)
        {
            const path = samples(site.position, person.points);
            const first = path.findIndex(sample => sample.t >= site.startT - DANGER_LEAD_S && Math.hypot(...sample.xy) <= DANGER_RADIUS_M);
            if (first < 0)
            {
                continue;
            }
            let last = first;
            while (last + 1 < path.length && Math.hypot(...path[last + 1].xy) <= DANGER_RADIUS_M)
            {
                last += 1;
            }
            // Closest approach inside the window: the alert sits where the person came nearest the site.
            let closest = first;
            for (let index = first; index <= last; index += 1)
            {
                if (Math.hypot(...path[index].xy) < Math.hypot(...path[closest].xy))
                {
                    closest = index;
                }
            }
            const round = (value: number) => Math.round(value * 1000) / 1000;
            dangers.push({
                alertId: site.alertId,
                personId: person.id,
                at: round(path[first].t),
                position: toLngLat(site.position, path[closest].xy),
                startT: round(path[first].t),
                endT: round(path[last].t),
                closestT: round(path[closest].t),
            });
        }
    }
    return dangers;
}

/**
 * The people detector can split one walker into several tracks, so each site raises at most one danger
 * per DANGER_SITE_WINDOW_S regardless of person id; a later approach after the window raises a new one.
 */
export function limitDangersPerSite(dangers: Danger[], windowS = DANGER_SITE_WINDOW_S): Danger[]
{
    const lastKept = new Map<string, number>();
    const kept: Danger[] = [];
    for (const danger of [...dangers].sort((a, b) => a.at - b.at || a.personId.localeCompare(b.personId)))
    {
        const previous = lastKept.get(danger.alertId);
        if (previous !== undefined && danger.at - previous < windowS)
        {
            continue;
        }
        lastKept.set(danger.alertId, danger.at);
        kept.push(danger);
    }
    return kept;
}

/** Danger alerts are events about a nest site, not sites: site counts, analytics and outcomes leave them out. */
export const isNestSite = (alert: { kind: string }): boolean => alert.kind !== 'DANGER';

export const CAMERA_DANGER_LABEL = 'Camera alert · person detected (not measured distance)';

/** Camera-level danger from live detection: no clip and no nest site. Never a measured distance to a nest. */
export const isCameraDanger = (alert: { kind: string; siteId: string | null; videoId: string | null }): boolean =>
    alert.kind === 'DANGER' && alert.siteId === null && alert.videoId === null;
