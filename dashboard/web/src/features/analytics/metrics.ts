import { isNestSite } from '@/lib/danger';
import { classifyOutcome, outcomeCounts } from '@/lib/sites/outcomes';
import type { AlertView, MapSnapshot, Nesting, Protection } from '@/lib/types';
import { PROTECTION } from '@/features/sites/labels';

// 'map' = sites on the live map now (the Active tab); 'all' = everything the snapshot carries.
export type Scope = 'map' | 'all';

export interface Bar
{
    key: string;
    label: string;
    detail?: string;
    count: number;
    color: string;
}

export interface AnalyticsMetrics
{
    sites: number;          // headline count; for 'all' it matches Active + Inactive tabs
    charted: number;        // sites the breakdowns and percentages are computed over
    unprotected: number;
    unprotectedPct: number;
    patrolVisited: number;
    patrolVisitedPct: number;
    bothCameras: number;
    bothCamerasPct: number;
    archived: number;
    protection: Bar[];
    nesting: Bar[];
    byZone: Bar[];
    outcomes: { saved: number; notSaved: number; pending: number };
}

export const NESTING_BARS: Record<Nesting, { label: string; color: string }> = {
    unresolved: { label: 'Unresolved', color: '#FFB547' },
    confirmed: { label: 'Nest confirmed', color: '#4C8DD6' },
    noNest: { label: 'No nest found', color: '#8A9BA6' },
};

const PROTECTION_ORDER: Protection[] = ['unprotected', 'protected', 'notNeeded'];
const NESTING_ORDER: Nesting[] = ['unresolved', 'confirmed', 'noNest'];
const PROTECTION_SHORT: Record<Protection, string> = { unprotected: 'Unprotected', protected: 'Protected', notNeeded: 'Not needed' };
export const ZONE_BAR_COLOR = '#6E93AE';

export function percentOf(part: number, whole: number): number
{
    return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

// Faded from the live map without anyone logging an outcome or a no-nest finding.
export function isArchived(alert: AlertView): boolean
{
    return !alert.site.active && alert.site.outcome === 'open' && alert.site.nesting !== 'noNest';
}

// Whole-log outcomes come from the server at `generatedAt`. The 30-min Not-saved rule depends on the clock, so
// sites listed in the snapshot whose danger deadline passed since then move from pending to not saved here.
function liveOutcomes(snapshot: Pick<MapSnapshot, 'outcomes'> & { generatedAt?: string }, sites: AlertView[], now: number): MapSnapshot['outcomes']
{
    const since = snapshot.generatedAt ? Date.parse(snapshot.generatedAt) : now;
    const lapsed = sites.filter(alert => classifyOutcome(alert.site, since) === 'pending' && classifyOutcome(alert.site, now) === 'notSaved').length;
    const moved = Math.min(lapsed, snapshot.outcomes.pending);
    return { saved: snapshot.outcomes.saved, notSaved: snapshot.outcomes.notSaved + moved, pending: snapshot.outcomes.pending - moved };
}

/** Level-1 danger alerts: open now and every one in the log (server counts). */
export function dangerStats(snapshot: Partial<Pick<MapSnapshot, 'dangerCount' | 'dangerTotal'>>): { active: number; total: number }
{
    return { active: snapshot.dangerCount ?? 0, total: snapshot.dangerTotal ?? 0 };
}

// Nest sites only: danger alerts are events about a site (counted by their own tile), never sites themselves.
// `now` is the client clock (useNow), so a danger deadline passing re-classifies a site without a server write.
export function analyticsMetrics(snapshot: Pick<MapSnapshot, 'alerts' | 'zones' | 'outcomes' | 'inactiveCount'> & Partial<Pick<MapSnapshot, 'dangerCount' | 'dangerTotal' | 'generatedAt'>>, scope: Scope, now: number = Date.now()): AnalyticsMetrics
{
    const sites = snapshot.alerts.filter(isNestSite);
    const active = sites.filter(alert => alert.site.active);
    const rows = scope === 'map' ? active : sites;
    // inactiveCount also covers resolved danger alerts (they sit in the Inactive tab).
    const inactiveSites = Math.max(0, snapshot.inactiveCount - ((snapshot.dangerTotal ?? 0) - (snapshot.dangerCount ?? 0)));
    const count = (pick: (alert: AlertView) => boolean) => rows.filter(pick).length;

    const unprotected = count(alert => alert.site.protection === 'unprotected');
    const patrolVisited = count(alert => alert.site.patrolVisited);
    const bothCameras = count(alert => alert.evidenceTier === 'TWO_CAMERA');
    const charted = rows.length;

    return {
        sites: scope === 'map' ? charted : Math.max(charted, active.length + inactiveSites),
        charted,
        unprotected,
        unprotectedPct: percentOf(unprotected, charted),
        patrolVisited,
        patrolVisitedPct: percentOf(patrolVisited, charted),
        bothCameras,
        bothCamerasPct: percentOf(bothCameras, charted),
        archived: count(isArchived),
        protection: PROTECTION_ORDER.map(key => ({ key, label: PROTECTION_SHORT[key], count: count(alert => alert.site.protection === key), color: PROTECTION[key].color })),
        nesting: NESTING_ORDER.map(key => ({ key, ...NESTING_BARS[key], count: count(alert => alert.site.nesting === key) })),
        byZone: snapshot.zones.map(zone => ({ key: zone.code, label: `Zone ${zone.code}`, detail: zone.name, count: count(alert => alert.zoneCode === zone.code), color: ZONE_BAR_COLOR })),
        outcomes: scope === 'all' ? liveOutcomes(snapshot, sites, now) : outcomeCounts(active.map(alert => alert.site), now),
    };
}
