export type Role = 'ADMIN' | 'VIEWER';
export type ActivityLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type CameraStatus = 'ONLINE' | 'OFFLINE';
export type VideoSource = 'UPLOAD' | 'SIMULATION';
export type EvidenceTier = 'TWO_CAMERA' | 'SINGLE_CAMERA';
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

export interface FeedVideo
{
    id: string;
    source: VideoSource;
    durationS: number | null;
    hasMotion: boolean;
    simRunId: string | null;
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
    video: FeedVideo | null;
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
    videoId: string;
    simRunId: string | null;
    startT: number;
    endT: number;
    evidenceTier: EvidenceTier | null;
    simulated: boolean;
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
