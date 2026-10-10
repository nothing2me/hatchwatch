import type { MaskPoint } from '@/lib/cameras/masks';

export type Role = 'ADMIN' | 'VOLUNTEER' | 'VIEWER';
export type ActivityLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type CameraStatus = 'ONLINE' | 'OFFLINE';
export type VideoSource = 'UPLOAD' | 'SIMULATION';
export type EvidenceTier = 'TWO_CAMERA' | 'SINGLE_CAMERA';
export type LngLat = [number, number];

export const ALERT_MESSAGES = {
    DIGGING: 'Digging activity detected; nesting unresolved.',
    TRACK_ONLY: 'Crawl tracked; digging not observed.',
    NO_TURTLE: 'No turtle tracked.',
    DANGER: 'Danger · person near an active nest site — immediate action',
} as const;

export type AlertKind = keyof typeof ALERT_MESSAGES;
export type AlertStatus = 'NEW' | 'REVIEWED' | 'DISMISSED' | 'FIELD_CONFIRMED' | 'HATCHED' | 'LOST' | 'ARCHIVED';
export type SiteEventType = 'detected' | 'departed' | 'archived' | 'patrolVisit' | 'nestConfirmed' | 'noNestFound' | 'nestDamaged' | 'protectionInstalled' | 'hatched' | 'lost' | 'note' | 'danger' | 'dangerResolved';
export type Protection = 'unprotected' | 'protected' | 'notNeeded';
export type Nesting = 'unresolved' | 'confirmed' | 'noNest';
export type Outcome = 'open' | 'hatched' | 'lost';
export type DangerState = 'none' | 'active' | 'resolved';

export interface SiteSummary
{
    protection: Protection;
    nesting: Nesting;
    outcome: Outcome;
    active: boolean;
    personActed: boolean;
    patrolVisited: boolean;
    detectedAt: string | null;
    archivedAt: string | null;
    /** A patrol found the nest damaged (trampled, driven over, dug up, washed out). Sticky once logged; the site stays active. */
    damaged: boolean;
    /** Person-near-site state from the log: a `danger` entry makes it active until someone resolves or acts on the site. */
    danger: DangerState;
    /** ISO time the site counts as Not saved unless protection is logged first (first danger + 30 min); null = no deadline. */
    dangerDeadline: string | null;
    /** Nest sites: who secured the site and when (see securedOf); null while unsecured. Always null on DANGER alerts. */
    secured: Secured | null;
}

export interface Secured
{
    by: string;
    at: string;              // ISO
}

export interface ZoneView
{
    id: string;
    code: string;
    name: string;
    activityLevel: ActivityLevel;
    ring: LngLat[];          // closed ring, first point repeated last
    /** Added on the map by an admin (can be moved and deleted there); seeded zones are not. */
    editable?: boolean;
}

export interface FeedVideo
{
    id: string;
    source: VideoSource;
    durationS: number | null;
    hasMotion: boolean;
    simRunId: string | null;
    motionMap?: { url: string; corners: [LngLat, LngLat, LngLat, LngLat]; fitRmseM: number | null };
    /** Operator-drawn watch polygon in source-frame pixels; motion signals are
     * computed only inside it at extraction. Never simulator truth. */
    maskPolygon?: [number, number][];
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
    liveDevice: { id: string; name: string; kind?: LiveDeviceKind } | null;   // kind defaults to PHONE when absent
    /** Watch area in normalised 0-1 picture coordinates; null or absent: the whole picture counts. */
    mask?: MaskPoint[] | null;
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
    /** Null for camera-level dangers (no clip). */
    videoId: string | null;
    simRunId: string | null;
    startT: number;
    endT: number;
    evidenceTier: EvidenceTier | null;
    simulated: boolean;
    /** 1 = level-1 danger; 0 = ordinary site. */
    level: number;
    /** DANGER alerts: the linked nest site. */
    siteId: string | null;
    /** Trail palette index of this site's matched trail; null when it has none. */
    colorIndex: number | null;
    /** DANGER alerts: who resolved it and when (the latest `dangerResolved` entry); null while open. */
    resolvedBy?: string | null;
    resolvedAt?: string | null;
    site: SiteSummary;
}

export interface MotionCandidateView
{
    id: string;
    cameraCode: string;
    zoneCode: string;
    position: LngLat;
    radiusM: number;
    score: number;
    startT: number;
    endT: number;
    simRunId: string;
}

export interface TrackView
{
    id: string;
    alertId: string | null;
    colorIndex: number | null;
    /** Clip key (simRunId) the trail's clock belongs to. */
    key: string;
    points: { t: number; position: LngLat }[];
}

export interface MapSnapshot
{
    zones: ZoneView[];
    cameras: CameraView[];
    alerts: AlertView[];
    motionCandidates?: MotionCandidateView[];
    camerasOnline: number;
    camerasTotal: number;
    inactiveCount: number;    // dismissed, hatched, lost or archived nest sites, plus resolved danger alerts
    tracks: TrackView[];
    dangerCount: number;      // DANGER alerts not yet resolved
    dangerTotal: number;      // every DANGER alert in the log
    outcomes: { saved: number; notSaved: number; pending: number };
    /** True when any logged patrol entry (whole log) was written by the demo patrol. */
    demoPatrol?: boolean;
    /** True when a site listed in this snapshot carries a demo patrol entry. */
    demoPatrolOnMap?: boolean;
    fadeMinutes: number;
    /** ISO time the server built this snapshot; the client re-applies time rules (30-min Not saved) from here. */
    generatedAt?: string;
}

export type LiveDeviceKind = 'PHONE' | 'BOARD';

// Motion measured on a camera board, as last reported with a frame (schemas/esp32-frame.v1.md).
export interface BoardMotionView
{
    percent: number;
    active: boolean;
    box: [number, number, number, number];
    at: string;
}

export type DetectionLabel = 'person' | 'possible turtle';
export type PixelBox = [number, number, number, number];

export interface DetectedObject
{
    track: string;            // 'P3' person, 'T1' possible turtle; per device
    label: DetectionLabel;
    score?: number;           // people only; a model score, not a probability
    box: PixelBox;            // x, y, w, h in picture pixels
}

export interface DetectionTrail
{
    track: string;
    label: DetectionLabel;
    points: [number, number, number][];   // [epoch ms, x, y] box centres, oldest first, ≤ 60 points / 30 s
}

// Newest result of the live detection worker for one device (memory only, same lifetime as frames).
export interface DetectionsView
{
    at: number;               // frame time (epoch ms) the result belongs to
    dark: boolean;
    width: number;
    height: number;
    objects: DetectedObject[];
    trails: DetectionTrail[];
}

export interface LiveDeviceView
{
    id: string;
    name: string;
    kind: LiveDeviceKind;
    ownerName: string;
    cameraCode: string | null;
    online: boolean;
    recording: boolean;
    lastSeenAt: string;
    motion: BoardMotionView | null;
    detections: DetectionsView | null;
}

export interface RecordingView
{
    path: string;
    deviceId: string;
    deviceName: string;
    cameraCode: string | null;
    startedAt: string;
    durationS: number;
    sizeBytes: number;
    playable: boolean;
}
