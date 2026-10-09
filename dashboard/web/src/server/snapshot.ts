import 'server-only';
import { prisma } from '@/lib/db';
import type { ActivityLevel, AlertKind, AlertStatus, CameraStatus, LngLat, MapSnapshot } from '@/lib/types';

export interface ZoneRow
{
    id: string; code: string; name: string; activityLevel: ActivityLevel;
    outline: unknown;
}

export interface CameraRow
{
    id: string; code: string; zone: { code: string };
    lng: number; lat: number; headingDeg: number; fovDeg: number; rangeM: number;
    status: CameraStatus; calibration: unknown; videos: { id: string }[];
}

export interface AlertRow
{
    id: string; kind: AlertKind; message: string; status: AlertStatus;
    zone: { code: string }; camera: { code: string };
    lng: number | null; lat: number | null; radiusM: number; score: number | null; createdAt: Date;
}

export interface SnapshotRows
{
    zones: ZoneRow[];
    cameras: CameraRow[];
    alerts: AlertRow[];
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
        latestVideoId: camera.videos[0]?.id ?? null,
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
    }));

    return {
        zones: rows.zones.map(zone => ({ id: zone.id, code: zone.code, name: zone.name, activityLevel: zone.activityLevel, ring: ringOf(zone.outline) })),
        cameras,
        alerts,
        camerasOnline: cameras.filter(camera => camera.status === 'ONLINE').length,
        camerasTotal: cameras.length,
        activeAlertCount: alerts.filter(alert => alert.status === 'NEW').length,
    };
}

export async function getMapSnapshot(): Promise<MapSnapshot>
{
    const [zones, cameras, alerts] = await Promise.all([
        prisma.zone.findMany({ orderBy: { code: 'asc' } }),
        prisma.camera.findMany({
            orderBy: { code: 'asc' },
            include: {
                zone: { select: { code: true } },
                videos: { select: { id: true }, orderBy: { createdAt: 'desc' }, take: 1 },
            },
        }),
        prisma.alert.findMany({
            orderBy: { createdAt: 'desc' },
            take: 100,
            include: { zone: { select: { code: true } }, camera: { select: { code: true } } },
        }),
    ]);

    return toMapSnapshot({ zones, cameras, alerts });
}
