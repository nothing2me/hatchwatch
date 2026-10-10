import 'server-only';
import type { PrismaClient } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { asCameraMask } from '@/lib/cameras/masks';
import { DEMO_PATROL_AUTHOR } from '@/lib/live/demoPatrol';
import { outcomeCounts } from '@/lib/sites/outcomes';
import { DANGER_PROTECT_MINUTES, PERSON_EVENTS, securedOf, summarizeSite } from '@/lib/sites/summary';
import { shiftedZoneFrame, simPointToLngLat, zoneFrame } from '@/lib/sim/frame';
import type { ActivityLevel, AlertKind, AlertStatus, CameraStatus, EvidenceTier, LiveDeviceKind, LngLat, MapSnapshot, MotionCandidateView, SiteEventType, TrackView, VideoSource } from '@/lib/types';

export interface ZoneRow
{
    id: string; code: string; name: string; activityLevel: ActivityLevel;
    outline: unknown;
    createdById?: string | null;
}

export interface CameraRow
{
    id: string; code: string; zone: { code: string };
    lng: number; lat: number; headingDeg: number; fovDeg: number; rangeM: number;
    status: CameraStatus; calibration: unknown; videos: { id: string; source: VideoSource; durationS: number | null; pureMotionPath: string | null; simRunId: string | null; motionMapPath?: string | null; motionFitRmseM?: number | null; motionCandidates?: unknown; maskPolygon?: unknown; liveChunk?: { groundBounds: unknown; placementOffsetM?: number | null } | null }[];
    liveDevice: { id: string; name: string; kind?: LiveDeviceKind } | null;
    maskPolygon?: unknown;
}

export interface AlertRow
{
    id: string; kind: AlertKind; message: string; status: AlertStatus;
    zone: { code: string }; camera: { code: string };
    lng: number | null; lat: number | null; radiusM: number; score: number | null; createdAt: Date;
    videoId: string | null; video: { simRunId: string | null } | null; startT: number; endT: number;
    evidenceTier: EvidenceTier | null; simulated: boolean;
    level?: number; siteId?: string | null;
    events: { type: string; at: Date; createdAt?: Date; author?: string }[];
}

export interface TrackRow
{
    id: string; alertId: string | null; colorIndex: number | null; videoId: string;
    video: { simRunId: string | null };
    /** [{ t, lng, lat }] */
    points: unknown;
}

export interface SnapshotRows
{
    zones: ZoneRow[];
    cameras: CameraRow[];
    alerts: AlertRow[];
    tracks?: TrackRow[];
    inactiveCount?: number;
    outcomes?: MapSnapshot['outcomes'];
    demoPatrol?: boolean;
    dangerCount?: number;
    dangerTotal?: number;
    now?: Date;
    /** `dangerResolved` entries of DANGER alerts, by nest site; derived from `alerts` when not given. */
    dangerResolutions?: DangerResolutionRow[];
}

export interface DangerResolutionRow { siteId: string; at: Date; createdAt?: Date; author: string }

/** Hours a site stays in the snapshot after a person's last entry, however old it is. */
export const RECENT_ENTRY_HOURS = 6;

// Inactive = closed nest sites plus resolved danger alerts (cached REVIEWED). These are the Inactive tab.
const INACTIVE_SITE_STATUSES: AlertStatus[] = ['DISMISSED', 'HATCHED', 'LOST', 'ARCHIVED'];
const INACTIVE_WHERE = { OR: [{ status: { in: INACTIVE_SITE_STATUSES } }, { kind: 'DANGER' as const, status: { not: 'NEW' as const } }] };
// Open = what the Active tab lists: open nest sites and unresolved danger alerts.
const OPEN_WHERE = { OR: [{ status: { in: ['NEW', 'FIELD_CONFIRMED'] as AlertStatus[] } }, { status: 'REVIEWED' as const, kind: { not: 'DANGER' as const } }] };

// Cached statuses mirror each site's log (statusFor), so totals need no event reads. Nest sites only (no DANGER rows).
// `dangerMissed` = open sites whose first danger passed 30 min without protection: time-dependent, so not a cached
// status; counted from events by the caller and moved from pending to not saved.
export function outcomesFromStatusCounts(rows: { status: AlertStatus; _count: number }[], dangerMissed = 0): MapSnapshot['outcomes']
{
    const counts = { saved: 0, notSaved: 0, pending: 0 };
    for (const { status, _count: count } of rows)
    {
        if (status === 'HATCHED') counts.saved += count;
        else if (status === 'LOST' || status === 'ARCHIVED') counts.notSaved += count;
        else if (status !== 'DISMISSED') counts.pending += count;
    }
    const moved = Math.min(dangerMissed, counts.pending);
    counts.pending -= moved;
    counts.notSaved += moved;
    return counts;
}

// Open nest sites with a danger that went 30 min without protection logged (same rule as classifyOutcome).
export async function countDangerMissed(client: PrismaClient, now: Date): Promise<number>
{
    const iso = now.toISOString();
    const minutes = DANGER_PROTECT_MINUTES;
    const [row] = await client.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM "Alert" a
        WHERE a.status IN ('NEW', 'REVIEWED', 'FIELD_CONFIRMED') AND a.kind <> 'DANGER'
          AND EXISTS (
            SELECT 1 FROM "SiteEvent" d
            WHERE d."alertId" = a.id AND d.type = 'danger'
              AND d.at + make_interval(mins => ${minutes}::int) <= CAST(${iso} AS timestamp)
              AND NOT EXISTS (
                SELECT 1 FROM "SiteEvent" p
                WHERE p."alertId" = a.id AND p.type = 'protectionInstalled' AND p.at <= d.at + make_interval(mins => ${minutes}::int)))`;
    return row?.n ?? 0;
}

function trackPoints(points: unknown): TrackView['points']
{
    return Array.isArray(points)
        ? points.filter(point => typeof point?.t === 'number' && typeof point?.lng === 'number' && typeof point?.lat === 'number')
            .map(point => ({ t: point.t as number, position: [point.lng, point.lat] as LngLat }))
        : [];
}

const toEvents = (events: { type: string; at: Date; createdAt?: Date; author?: string }[]) => events as { type: SiteEventType; at: Date; createdAt?: Date; author?: string }[];

// Resolutions logged on danger alerts, from the loaded rows (a danger alert outside the snapshot is missed).
function resolutionsIn(alerts: AlertRow[]): DangerResolutionRow[]
{
    return alerts.filter(alert => alert.kind === 'DANGER' && alert.siteId)
        .flatMap(alert => alert.events.filter(event => event.type === 'dangerResolved').map(event => ({ siteId: alert.siteId!, at: event.at, createdAt: event.createdAt, author: event.author ?? '' })));
}

// Who resolved a danger alert: its latest `dangerResolved` entry (null for sites and open dangers).
function resolution(alert: AlertRow): { resolvedBy: string | null; resolvedAt: string | null }
{
    const entry = alert.kind === 'DANGER' ? alert.events.findLast(event => event.type === 'dangerResolved') : undefined;
    return { resolvedBy: entry?.author ?? null, resolvedAt: entry ? entry.at.toISOString() : null };
}

export function fadeMinutes(): number
{
    const value = Number(process.env.LIVE_FADE_MINUTES);
    return Number.isFinite(value) && value > 0 ? value : 5;
}

function ringOf(outline: unknown): LngLat[]
{
    const coordinates = (outline as { coordinates?: LngLat[][] })?.coordinates;
    return Array.isArray(coordinates?.[0]) ? coordinates[0] : [];
}

export function toMapSnapshot(rows: SnapshotRows): MapSnapshot
{
    const zoneFrames = new Map(rows.zones.map(zone => [zone.code, zoneFrame(ringOf(zone.outline))]));
    const cameras = rows.cameras.map(camera =>
    {
        const video = camera.videos[0];
        const baseFrame = zoneFrames.get(camera.zone.code);
        const frame = baseFrame && video ? shiftedZoneFrame(baseFrame, video.liveChunk?.placementOffsetM ?? 0) : undefined;
        const motionMap = video ? motionMapFor(video, frame) : undefined;
        return {
        id: camera.id,
        code: camera.code,
        zoneCode: camera.zone.code,
        position: [camera.lng, camera.lat] as LngLat,
        headingDeg: camera.headingDeg,
        fovDeg: camera.fovDeg,
        rangeM: camera.rangeM,
        status: camera.status,
        calibrated: camera.calibration !== null,
        video: camera.videos[0]
            ? {
                id: camera.videos[0].id,
                source: camera.videos[0].source,
                durationS: camera.videos[0].durationS,
                hasMotion: camera.videos[0].pureMotionPath !== null,
                simRunId: camera.videos[0].simRunId,
                ...(motionMap ? { motionMap } : {}),
                ...(Array.isArray(camera.videos[0].maskPolygon) ? { maskPolygon: camera.videos[0].maskPolygon } : {}),
            }
            : null,
        liveDevice: camera.liveDevice ?? null,
        mask: asCameraMask(camera.maskPolygon),
        };
    });

    const tracks: TrackView[] = (rows.tracks ?? []).map(track => ({
        id: track.id,
        alertId: track.alertId,
        colorIndex: track.colorIndex,
        key: track.video.simRunId ?? track.videoId,
        points: trackPoints(track.points),
    }));
    const colorBySite = new Map<string, number>();
    for (const track of tracks)
    {
        if (track.alertId && track.colorIndex !== null && !colorBySite.has(track.alertId))
        {
            colorBySite.set(track.alertId, track.colorIndex);
        }
    }

    const resolutionsBySite = new Map<string, DangerResolutionRow[]>();
    for (const row of rows.dangerResolutions ?? resolutionsIn(rows.alerts))
    {
        resolutionsBySite.set(row.siteId, [...(resolutionsBySite.get(row.siteId) ?? []), row]);
    }
    const siteSummary = (alert: AlertRow) =>
    {
        const summary = summarizeSite(toEvents(alert.events), alert.kind);
        const resolutions = alert.kind === 'DANGER' ? [] : resolutionsBySite.get(alert.id) ?? [];
        return resolutions.length === 0 ? summary : { ...summary, secured: securedOf([...toEvents(alert.events), ...resolutions.map(row => ({ ...row, type: 'dangerResolved' as const }))]) };
    };

    const alerts = rows.alerts.map(alert => ({
        id: alert.id,
        kind: alert.kind,
        message: alert.message,
        status: alert.status,
        zoneCode: alert.zone.code,
        cameraCode: alert.camera.code,
        position: alert.lng !== null && alert.lat !== null ? [alert.lng, alert.lat] as LngLat : null,
        radiusM: alert.radiusM,
        score: alert.score,
        createdAt: alert.createdAt.toISOString(),
        videoId: alert.videoId,
        simRunId: alert.video?.simRunId ?? null,
        startT: alert.startT,
        endT: alert.endT,
        evidenceTier: alert.evidenceTier,
        simulated: alert.simulated,
        level: alert.level ?? 0,
        siteId: alert.siteId ?? null,
        colorIndex: colorBySite.get(alert.id) ?? null,
        ...resolution(alert),
        site: siteSummary(alert),
    }));
    const sites = alerts.filter(alert => alert.kind !== 'DANGER');
    const dangers = alerts.filter(alert => alert.kind === 'DANGER');

    const motionCandidates: MotionCandidateView[] = rows.cameras.flatMap(camera =>
    {
        const video = camera.videos[0];
        const baseFrame = zoneFrames.get(camera.zone.code);
        const frame = baseFrame ? shiftedZoneFrame(baseFrame, video?.liveChunk?.placementOffsetM ?? 0) : undefined;
        if (!video?.simRunId || !frame || !Array.isArray(video.motionCandidates)) return [];
        return video.motionCandidates.flatMap((item: unknown) =>
        {
            const candidate = item as { id?: unknown; point?: unknown; interval?: unknown; radiusM?: unknown; score?: unknown };
            if (typeof candidate?.id !== 'string' || !Array.isArray(candidate.point) || candidate.point.length !== 2 || !candidate.point.every(value => typeof value === 'number' && Number.isFinite(value)) || !Array.isArray(candidate.interval) || candidate.interval.length !== 2 || !candidate.interval.every(value => typeof value === 'number' && Number.isFinite(value)) || typeof candidate.radiusM !== 'number' || typeof candidate.score !== 'number') return [];
            return [{ id: `${video.id}:${candidate.id}`, cameraCode: camera.code, zoneCode: camera.zone.code, position: simPointToLngLat(frame, candidate.point as [number, number]), radiusM: candidate.radiusM, score: candidate.score, startT: candidate.interval[0], endT: candidate.interval[1], simRunId: video.simRunId! }];
        });
    });

    return {
        zones: rows.zones.map(zone => ({ id: zone.id, code: zone.code, name: zone.name, activityLevel: zone.activityLevel, ring: ringOf(zone.outline), editable: Boolean(zone.createdById) })),
        cameras,
        alerts,
        motionCandidates,
        camerasOnline: cameras.filter(camera => camera.status === 'ONLINE').length,
        camerasTotal: cameras.length,
        inactiveCount: rows.inactiveCount ?? alerts.filter(alert => INACTIVE_SITE_STATUSES.includes(alert.status) || (alert.kind === 'DANGER' && !alert.site.active)).length,
        outcomes: rows.outcomes ?? outcomeCounts(sites.map(alert => alert.site), rows.now ?? Date.now()),
        tracks,
        demoPatrolOnMap: rows.alerts.some(alert => alert.events.some(event => event.author === DEMO_PATROL_AUTHOR)),
        demoPatrol: rows.demoPatrol ?? rows.alerts.some(alert => alert.events.some(event => event.author === DEMO_PATROL_AUTHOR)),
        dangerCount: rows.dangerCount ?? dangers.filter(alert => alert.site.active).length,
        dangerTotal: rows.dangerTotal ?? dangers.length,
        fadeMinutes: fadeMinutes(),
        generatedAt: (rows.now ?? new Date()).toISOString(),
    };
}

function motionMapFor(video: CameraRow['videos'][number], frame: ReturnType<typeof zoneFrame> | undefined): NonNullable<MapSnapshot['cameras'][number]['video']>['motionMap']
{
    const bounds = video.liveChunk?.groundBounds;
    if (!frame || !video.motionMapPath || !Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(value => typeof value === 'number' && Number.isFinite(value)))
    {
        return undefined;
    }
    const [x0, x1, z0, z1] = bounds as [number, number, number, number];
    if (x0 >= x1 || z0 >= z1)
    {
        return undefined;
    }
    return {
        url: `/api/media/motion-map/${encodeURIComponent(video.id)}`,
        corners: [simPointToLngLat(frame, [x0, z1]), simPointToLngLat(frame, [x1, z1]), simPointToLngLat(frame, [x1, z0]), simPointToLngLat(frame, [x0, z0])],
        fitRmseM: video.motionFitRmseM ?? null,
    };
}

export async function loadMapSnapshot(client: PrismaClient, now = new Date()): Promise<MapSnapshot>
{
    const recent = await client.alert.findMany({ orderBy: { createdAt: 'desc' }, take: 100, select: { id: true } });
    const since = new Date(now.getTime() - RECENT_ENTRY_HOURS * 3600_000);
    const [zones, cameras, alerts, inactiveCount, statusCounts, dangerCount, dangerTotal, dangerMissed, demoEntries] = await Promise.all([
        client.zone.findMany({ orderBy: { code: 'asc' } }),
        client.camera.findMany({
            orderBy: { code: 'asc' },
            include: {
                zone: { select: { code: true } },
                liveDevice: { select: { id: true, name: true, kind: true } },
                videos: {
                    // Live media that was pruned is skipped; chunks without a live record are unaffected.
                    where: { AND: [{ OR: [{ source: 'SIMULATION' }, { jobs: { some: { status: 'DONE' } } }] }, { OR: [{ liveChunkId: null }, { liveChunk: { mediaPruned: false } }] }] },
                    select: { id: true, source: true, durationS: true, pureMotionPath: true, simRunId: true, motionMapPath: true, motionFitRmseM: true, motionCandidates: true, maskPolygon: true, liveChunk: { select: { groundBounds: true, placementOffsetM: true } } },
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                },
            },
        }),
        // Every open site, the newest 100 others, and any site a person logged in the last few hours
        // (so recording an old site's outcome never drops it from under the open drawer). Each with its log.
        client.alert.findMany({
            where: { OR: [
                OPEN_WHERE,
                { id: { in: recent.map(row => row.id) } },
                { events: { some: { type: { in: PERSON_EVENTS }, createdAt: { gte: since } } } },
            ] },
            orderBy: { createdAt: 'desc' },
            include: { zone: { select: { code: true } }, camera: { select: { code: true } }, video: { select: { simRunId: true } }, events: { select: { type: true, at: true, createdAt: true, author: true }, orderBy: [{ at: 'asc' }, { createdAt: 'asc' }] } },
        }),
        client.alert.count({ where: INACTIVE_WHERE }),
        // Outcomes cover nest sites only; danger alerts are events about a site.
        client.alert.groupBy({ by: ['status'], where: { kind: { not: 'DANGER' } }, _count: true }),
        client.alert.count({ where: { kind: 'DANGER', status: 'NEW' } }),
        client.alert.count({ where: { kind: 'DANGER' } }),
        countDangerMissed(client, now),
        client.siteEvent.count({ where: { author: DEMO_PATROL_AUTHOR } }),
    ]);

    // Trails of the listed sites, plus unmatched trails of the clips the cameras are showing now.
    const feedVideoIds = cameras.flatMap(camera => camera.videos.map(video => video.id));
    const tracks = await client.track.findMany({
        where: { OR: [{ alertId: { in: alerts.map(alert => alert.id) } }, { alertId: null, videoId: { in: feedVideoIds } }] },
        orderBy: [{ videoId: 'asc' }, { label: 'asc' }],
        select: { id: true, alertId: true, colorIndex: true, videoId: true, points: true, video: { select: { simRunId: true } } },
    });

    // Resolutions logged on any danger alert of a listed site secure it, even when that alert is not listed.
    const dangerResolutions = await loadDangerResolutions(client, alerts.filter(alert => alert.kind !== 'DANGER').map(alert => alert.id));

    return toMapSnapshot({ zones, cameras, alerts, tracks, dangerResolutions, inactiveCount, outcomes: outcomesFromStatusCounts(statusCounts, dangerMissed), dangerCount, dangerTotal, demoPatrol: demoEntries > 0, now });
}

export async function loadDangerResolutions(client: PrismaClient, siteIds: string[]): Promise<DangerResolutionRow[]>
{
    if (siteIds.length === 0)
    {
        return [];
    }
    const rows = await client.siteEvent.findMany({
        where: { type: 'dangerResolved', alert: { kind: 'DANGER', siteId: { in: siteIds } } },
        select: { at: true, createdAt: true, author: true, alert: { select: { siteId: true } } },
    });
    return rows.map(row => ({ siteId: row.alert.siteId!, at: row.at, createdAt: row.createdAt, author: row.author }));
}

export function getMapSnapshot(): Promise<MapSnapshot>
{
    return loadMapSnapshot(prisma);
}
