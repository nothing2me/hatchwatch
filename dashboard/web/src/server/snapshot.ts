import 'server-only';
import type { PrismaClient } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { outcomeCounts } from '@/lib/sites/outcomes';
import { PERSON_EVENTS, summarizeSite } from '@/lib/sites/summary';
import { simPointToLngLat, zoneFrame } from '@/lib/sim/frame';
import type { ActivityLevel, AlertKind, AlertStatus, CameraStatus, EvidenceTier, LngLat, MapSnapshot, MotionCandidateView, SiteEventType, VideoSource } from '@/lib/types';

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
    status: CameraStatus; calibration: unknown; videos: { id: string; source: VideoSource; durationS: number | null; pureMotionPath: string | null; simRunId: string | null; motionMapPath?: string | null; motionFitRmseM?: number | null; motionCandidates?: unknown; liveChunk?: { groundBounds: unknown } | null }[];
}

export interface AlertRow
{
    id: string; kind: AlertKind; message: string; status: AlertStatus;
    zone: { code: string }; camera: { code: string };
    lng: number | null; lat: number | null; radiusM: number; score: number | null; createdAt: Date;
    videoId: string; video: { simRunId: string | null }; startT: number; endT: number;
    evidenceTier: EvidenceTier | null; simulated: boolean;
    events: { type: string; at: Date; createdAt?: Date }[];
}

export interface SnapshotRows
{
    zones: ZoneRow[];
    cameras: CameraRow[];
    alerts: AlertRow[];
    inactiveCount?: number;
    outcomes?: MapSnapshot['outcomes'];
}

/** Hours a site stays in the snapshot after a person's last entry, however old it is. */
export const RECENT_ENTRY_HOURS = 6;

// Cached statuses mirror each site's log (statusFor), so totals need no event reads.
export function outcomesFromStatusCounts(rows: { status: AlertStatus; _count: number }[]): MapSnapshot['outcomes']
{
    const counts = { saved: 0, notSaved: 0, pending: 0 };
    for (const { status, _count: count } of rows)
    {
        if (status === 'HATCHED') counts.saved += count;
        else if (status === 'LOST' || status === 'ARCHIVED') counts.notSaved += count;
        else if (status !== 'DISMISSED') counts.pending += count;
    }
    return counts;
}

const toEvents = (events: { type: string; at: Date; createdAt?: Date }[]) => events as { type: SiteEventType; at: Date; createdAt?: Date }[];

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
        const motionMap = camera.videos[0] ? motionMapFor(camera.videos[0], zoneFrames.get(camera.zone.code)) : undefined;
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
            }
            : null,
        };
    });

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
        simRunId: alert.video.simRunId,
        startT: alert.startT,
        endT: alert.endT,
        evidenceTier: alert.evidenceTier,
        simulated: alert.simulated,
        site: summarizeSite(toEvents(alert.events)),
    }));

    const motionCandidates: MotionCandidateView[] = rows.cameras.flatMap(camera =>
    {
        const video = camera.videos[0];
        const frame = zoneFrames.get(camera.zone.code);
        if (!video?.simRunId || !frame || !Array.isArray(video.motionCandidates)) return [];
        return video.motionCandidates.flatMap((item: unknown) =>
        {
            const candidate = item as { id?: unknown; point?: unknown; interval?: unknown; radiusM?: unknown; score?: unknown };
            if (typeof candidate?.id !== 'string' || !Array.isArray(candidate.point) || candidate.point.length !== 2 || !candidate.point.every(value => typeof value === 'number' && Number.isFinite(value)) || !Array.isArray(candidate.interval) || candidate.interval.length !== 2 || !candidate.interval.every(value => typeof value === 'number' && Number.isFinite(value)) || typeof candidate.radiusM !== 'number' || typeof candidate.score !== 'number') return [];
            return [{ id: `${video.id}:${candidate.id}`, cameraCode: camera.code, zoneCode: camera.zone.code, position: simPointToLngLat(frame, candidate.point as [number, number]), radiusM: candidate.radiusM, score: candidate.score, startT: candidate.interval[0], endT: candidate.interval[1], simRunId: video.simRunId! }];
        });
    });

    return {
        zones: rows.zones.map(zone => ({ id: zone.id, code: zone.code, name: zone.name, activityLevel: zone.activityLevel, ring: ringOf(zone.outline), custom: (zone.createdById ?? null) !== null })),
        cameras,
        alerts,
        motionCandidates,
        camerasOnline: cameras.filter(camera => camera.status === 'ONLINE').length,
        camerasTotal: cameras.length,
        inactiveCount: rows.inactiveCount ?? alerts.filter(alert => ['DISMISSED', 'HATCHED', 'LOST', 'ARCHIVED'].includes(alert.status)).length,
        outcomes: rows.outcomes ?? outcomeCounts(alerts.map(alert => alert.site)),
        fadeMinutes: fadeMinutes(),
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
    const [zones, cameras, alerts, inactiveCount, statusCounts] = await Promise.all([
        client.zone.findMany({ orderBy: { code: 'asc' } }),
        client.camera.findMany({
            orderBy: { code: 'asc' },
            include: {
                zone: { select: { code: true } },
                videos: {
                    // Live media that was pruned is skipped; chunks without a live record are unaffected.
                    where: { AND: [{ OR: [{ source: 'SIMULATION' }, { jobs: { some: { status: 'DONE' } } }] }, { OR: [{ liveChunkId: null }, { liveChunk: { mediaPruned: false } }] }] },
                    select: { id: true, source: true, durationS: true, pureMotionPath: true, simRunId: true, motionMapPath: true, motionFitRmseM: true, motionCandidates: true, liveChunk: { select: { groundBounds: true } } },
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                },
            },
        }),
        // Every open site, the newest 100 others, and any site a person logged in the last few hours
        // (so recording an old site's outcome never drops it from under the open drawer). Each with its log.
        client.alert.findMany({
            where: { OR: [
                { status: { in: ['NEW', 'REVIEWED', 'FIELD_CONFIRMED'] } },
                { id: { in: recent.map(row => row.id) } },
                { events: { some: { type: { in: PERSON_EVENTS }, createdAt: { gte: since } } } },
            ] },
            orderBy: { createdAt: 'desc' },
            include: { zone: { select: { code: true } }, camera: { select: { code: true } }, video: { select: { simRunId: true } }, events: { select: { type: true, at: true, createdAt: true }, orderBy: [{ at: 'asc' }, { createdAt: 'asc' }] } },
        }),
        client.alert.count({ where: { status: { in: ['DISMISSED', 'HATCHED', 'LOST', 'ARCHIVED'] } } }),
        client.alert.groupBy({ by: ['status'], _count: true }),
    ]);

    return toMapSnapshot({ zones, cameras, alerts, inactiveCount, outcomes: outcomesFromStatusCounts(statusCounts) });
}

export function getMapSnapshot(): Promise<MapSnapshot>
{
    return loadMapSnapshot(prisma);
}
