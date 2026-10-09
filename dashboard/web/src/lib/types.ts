export type Role = 'ADMIN' | 'VIEWER';
export type ActivityLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type CameraStatus = 'ONLINE' | 'OFFLINE';
export type LngLat = [number, number];

export const ALERT_MESSAGES = {
    DIGGING: 'Digging activity detected; nesting unresolved.',
    TRACK_ONLY: 'Crawl tracked; digging not observed.',
    NO_TURTLE: 'No turtle tracked.',
} as const;

export type AlertKind = keyof typeof ALERT_MESSAGES;
export type AlertStatus = 'NEW' | 'REVIEWED' | 'DISMISSED' | 'FIELD_CONFIRMED';

export interface ZoneView
{
    id: string;
    code: string;
    name: string;
    activityLevel: ActivityLevel;
    ring: LngLat[];          // closed ring, first point repeated last
}

export interface CameraView
{
    id: string;
    code: string;
    zoneCode: string;
    position: LngLat;
    headingDeg: number;
    fovDeg: number;
    rangeM: number;
    status: CameraStatus;
    calibrated: boolean;
    latestVideoId: string | null;
}

export interface AlertView
{
    id: string;
    kind: AlertKind;
    message: string;
    status: AlertStatus;
    zoneCode: string;
    cameraCode: string;
    position: LngLat | null;
    radiusM: number;
    score: number | null;
    createdAt: string;       // ISO
}

export interface MapSnapshot
{
    zones: ZoneView[];
    cameras: CameraView[];
    alerts: AlertView[];
    camerasOnline: number;
    camerasTotal: number;
    activeAlertCount: number; // status NEW
}
