import 'server-only';
import { prisma } from '@/lib/db';
import { outcomeCounts } from '@/lib/sites/outcomes';
import { summarizeSite } from '@/lib/sites/summary';
import type { ActivityLevel, AlertKind, AlertStatus, CameraStatus, EvidenceTier, LngLat, MapSnapshot, SiteEventType, VideoSource } from '@/lib/types';

export interface ZoneRow
{
    id: string; code: string; name: string; activityLevel: ActivityLevel;
    outline: unknown;
}

export interface CameraRow
{
    id: string; code: string; zone: { code: string };
    lng: number; lat: number; headingDeg: number; fovDeg: number; rangeM: number;
    status: CameraStatus; calibration: unknown; videos: { id: string; source: VideoSource; durationS: number | null; pureMotionPath: string | null; simRunId: string | null }[];
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
    outcomeEvents?: { type: string; at: Date; createdAt?: Date }[][];
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
    const cameras = rows.cameras.map(camera => ({
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
            }
            : null,
    }));

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

    return {
        zones: rows.zones.map(zone => ({ id: zone.id, code: zone.code, name: zone.name, activityLevel: zone.activityLevel, ring: ringOf(zone.outline) })),
        cameras,
        alerts,
        camerasOnline: cameras.filter(camera => camera.status === 'ONLINE').length,
        camerasTotal: cameras.length,
        activeAlertCount: alerts.filter(alert => alert.status === 'NEW').length,
        inactiveCount: rows.inactiveCount ?? alerts.filter(alert => ['DISMISSED', 'HATCHED', 'LOST', 'ARCHIVED'].includes(alert.status)).length,
        outcomes: outcomeCounts((rows.outcomeEvents ?? rows.alerts.map(alert => alert.events)).map(events => summarizeSite(toEvents(events)))),
        fadeMinutes: fadeMinutes(),
    };
}

export async function getMapSnapshot(): Promise<MapSnapshot>
{
    const recent = await prisma.alert.findMany({ orderBy: { createdAt: 'desc' }, take: 100, select: { id: true } });
    const [zones, cameras, alerts, activeCount, inactiveCount, everyAlert] = await Promise.all([
        prisma.zone.findMany({ orderBy: { code: 'asc' } }),
        prisma.camera.findMany({
            orderBy: { code: 'asc' },
            include: {
                zone: { select: { code: true } },
                videos: {
                    where: { OR: [{ source: 'SIMULATION' }, { jobs: { some: { status: 'DONE' } } }] },
                    select: { id: true, source: true, durationS: true, pureMotionPath: true, simRunId: true },
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                },
            },
        }),
        // Every open site plus the newest 100 others, each with its log.
        prisma.alert.findMany({
            where: { OR: [{ status: { in: ['NEW', 'REVIEWED', 'FIELD_CONFIRMED'] } }, { id: { in: recent.map(row => row.id) } }] },
            orderBy: { createdAt: 'desc' },
            include: { zone: { select: { code: true } }, camera: { select: { code: true } }, video: { select: { simRunId: true } }, events: { select: { type: true, at: true, createdAt: true }, orderBy: [{ at: 'asc' }, { createdAt: 'asc' }] } },
        }),
        prisma.alert.count({ where: { status: 'NEW' } }),
        prisma.alert.count({ where: { status: { in: ['DISMISSED', 'HATCHED', 'LOST', 'ARCHIVED'] } } }),
        // Outcome totals read every site's log; acceptable at demo scale.
        prisma.alert.findMany({ select: { events: { select: { type: true, at: true, createdAt: true }, orderBy: [{ at: 'asc' }, { createdAt: 'asc' }] } } }),
    ]);

    const snapshot = toMapSnapshot({ zones, cameras, alerts, inactiveCount, outcomeEvents: everyAlert.map(alert => alert.events) });
    return { ...snapshot, activeAlertCount: activeCount };
}
