import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { asCameraMask, feetInMask, type MaskPoint } from '@/lib/cameras/masks';
import { publishChange } from '@/lib/changes';
import { summarizeSite } from '@/lib/sites/summary';
import type { DetectionsView, SiteEventType } from '@/lib/types';

export const CAMERA_DANGER_MIN_TRACK_MS = 2_000;
export const CAMERA_DANGER_MIN_SCORE = 0.5;
export const CAMERA_DANGER_REPEAT_MS = 10 * 60_000;
export const CAMERA_DANGER_LOG_EVERY_MS = 60_000;
export const CAMERA_DANGER_AUTHOR = 'Camera';

export type CameraDangerResult = 'none' | 'raised' | 'logged';

/** The locked check (camera row lock and zone scan) runs at most once per camera per this many ms. */
export const CAMERA_DANGER_CHECK_EVERY_MS = 5_000;

/** Per-camera, in-memory gate in front of the database check; results arrive up to 2 a second per device. */
export class CameraDangerThrottle
{
    private readonly last = new Map<string, number>();

    constructor(private readonly everyMs = CAMERA_DANGER_CHECK_EVERY_MS) {}

    /** True (and remembered) when the camera's check may run at `now`. */
    take(cameraId: string, now: number): boolean
    {
        const previous = this.last.get(cameraId);
        if (previous !== undefined && now >= previous && now - previous < this.everyMs)
        {
            return false;
        }
        this.last.set(cameraId, now);
        return true;
    }
}

const sharedThrottle = new CameraDangerThrottle();

export const cameraDangerMessage = (code: string) => `Danger · person seen on camera ${code} near active nest sites — check now`;
export const cameraDangerNote = (code: string, track: string, sites: number, zone: string) =>
    `Person on camera ${code} (track ${track}), ${sites} active unprotected site(s) in zone ${zone}`;

// A person in this result, scored at least 0.50, whose track has been seen for at least 2 s and whose feet are inside
// the mask (null: the whole picture); the longest-seen wins.
export function qualifyingPerson(detections: DetectionsView, mask: readonly MaskPoint[] | null = null): { track: string; score: number } | null
{
    let best: { track: string; score: number; span: number } | null = null;
    for (const object of detections.objects)
    {
        if (object.label !== 'person' || object.score === undefined || object.score < CAMERA_DANGER_MIN_SCORE)
        {
            continue;
        }
        if (!feetInMask(object.box, detections.width, detections.height, mask))
        {
            continue;
        }
        const times = detections.trails.find(trail => trail.track === object.track)?.points.map(point => point[0]) ?? [];
        const span = times.length > 0 ? Math.max(...times) - Math.min(...times) : 0;
        if (span >= CAMERA_DANGER_MIN_TRACK_MS && (!best || span > best.span))
        {
            best = { track: object.track, score: object.score, span };
        }
    }
    return best && { track: best.track, score: best.score };
}

// Nest sites (not DANGER rows) in the zone whose log says active and unprotected right now. "Open" here is the
// cached status set NEW/REVIEWED/FIELD_CONFIRMED, the nest-site half of OPEN_WHERE in src/server/snapshot.ts.
async function activeUnprotectedSites(tx: Prisma.TransactionClient, zoneId: string): Promise<number>
{
    const sites = await tx.alert.findMany({
        where: { zoneId, kind: { not: 'DANGER' }, status: { in: ['NEW', 'REVIEWED', 'FIELD_CONFIRMED'] } },
        select: { kind: true, events: { select: { type: true, at: true, createdAt: true } } },
    });
    return sites.filter(site =>
    {
        const summary = summarizeSite(site.events.map(event => ({ ...event, type: event.type as SiteEventType })), site.kind);
        return summary.active && summary.protection === 'unprotected';
    }).length;
}

const warnedInvalidMask = new Set<string>();

// An invalid stored mask counts as no mask (the whole picture), so it can neither block nor widen alerts; said once per camera.
function storedMask(camera: { id: string; code: string; maskPolygon: unknown }): MaskPoint[] | null
{
    const mask = asCameraMask(camera.maskPolygon);
    if (!mask && camera.maskPolygon !== null && !warnedInvalidMask.has(camera.id))
    {
        warnedInvalidMask.add(camera.id);
        console.warn(`[camera-danger] camera ${camera.code} has an invalid stored mask; using the whole picture`);
    }
    return mask;
}

/**
 * Spec §6: one open camera-level DANGER per camera; repeat sightings append at most one log entry a minute; a new
 * alert only once the previous one was resolved at least 10 minutes ago. The camera row lock serialises results;
 * the throttle keeps that locked check to once per camera every 5 s.
 */
export async function raiseCameraDanger(prisma: PrismaClient, deviceId: string, detections: DetectionsView, now: Date, throttle: CameraDangerThrottle = sharedThrottle): Promise<CameraDangerResult>
{
    if (!qualifyingPerson(detections))
    {
        return 'none';                       // nothing anywhere in the picture: no database work
    }
    const device = await prisma.liveDevice.findUnique({
        where: { id: deviceId },
        select: { disabledAt: true, camera: { select: { id: true, code: true, zoneId: true, lng: true, lat: true, maskPolygon: true, zone: { select: { code: true } } } } },
    });
    const camera = device && !device.disabledAt ? device.camera : null;
    if (!camera)
    {
        return 'none';
    }
    // Only people whose feet are inside this camera's watch area count; outside ones never raise or append (spec §4).
    const person = qualifyingPerson(detections, storedMask(camera));
    if (!person || !throttle.take(camera.id, now.getTime()))
    {
        return 'none';
    }
    const result = await prisma.$transaction(async (tx): Promise<CameraDangerResult> =>
    {
        await tx.$queryRaw`SELECT id FROM "Camera" WHERE id = ${camera.id} FOR UPDATE`;
        const sites = await activeUnprotectedSites(tx, camera.zoneId);
        const note = cameraDangerNote(camera.code, person.track, sites, camera.zone.code);
        const open = await tx.alert.findFirst({ where: { cameraId: camera.id, kind: 'DANGER', siteId: null, videoId: null, status: 'NEW' }, orderBy: { createdAt: 'desc' }, select: { id: true } });
        if (open)
        {
            // Locked and re-read: a volunteer may have resolved it meanwhile, and a `danger` entry after that would re-open it.
            await tx.$queryRaw`SELECT id FROM "Alert" WHERE id = ${open.id} FOR UPDATE`;
            const events = await tx.siteEvent.findMany({ where: { alertId: open.id }, select: { type: true, at: true }, orderBy: [{ at: 'desc' }, { createdAt: 'desc' }] });
            if (events.some(event => event.type === 'dangerResolved'))
            {
                return 'none';
            }
            const last = events.find(event => event.type === 'danger');
            if (last && now.getTime() - last.at.getTime() < CAMERA_DANGER_LOG_EVERY_MS)
            {
                return 'none';
            }
            await tx.siteEvent.create({ data: { alertId: open.id, type: 'danger', author: CAMERA_DANGER_AUTHOR, userId: null, note, at: now } });
            return 'logged';
        }
        if (sites === 0)
        {
            return 'none';
        }
        const previous = await tx.alert.findFirst({
            where: { cameraId: camera.id, kind: 'DANGER', siteId: null, videoId: null },
            orderBy: { createdAt: 'desc' },
            select: { events: { where: { type: 'dangerResolved' }, orderBy: { at: 'desc' }, take: 1, select: { at: true } } },
        });
        const resolvedAt = previous?.events[0]?.at;
        if (previous && (!resolvedAt || now.getTime() - resolvedAt.getTime() < CAMERA_DANGER_REPEAT_MS))
        {
            return 'none';
        }
        const alert = await tx.alert.create({
            data: {
                videoId: null, cameraId: camera.id, zoneId: camera.zoneId, kind: 'DANGER', message: cameraDangerMessage(camera.code),
                level: 1, siteId: null, lng: camera.lng, lat: camera.lat, radiusM: 0, startT: 0, endT: 0, score: null, simulated: false, detectedAt: now,
            },
            select: { id: true },
        });
        await tx.siteEvent.create({ data: { alertId: alert.id, type: 'danger', author: CAMERA_DANGER_AUTHOR, userId: null, note, at: now } });
        return 'raised';
    });
    if (result !== 'none')
    {
        publishChange('site-event');
    }
    return result;
}
