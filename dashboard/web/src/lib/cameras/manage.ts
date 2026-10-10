import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { publishChange } from '@/lib/changes';
import type { CameraStatus, LngLat, ZoneView } from '@/lib/types';
import { CAMERA_CODE, type CAMERA_LIMITS, rangeError } from './limits';
import { distanceToZone, nearestZone, nextCameraCodes, partnerCode, planPairOnZone, PlacementError, seawardToward, zoneOrientation } from './placePair';

export class CameraEditError extends Error {}

// Cameras stay within this distance of their zone's outline.
const MAX_ZONE_DISTANCE_M = 2000;

type Tx = Prisma.TransactionClient;

const STATUSES: CameraStatus[] = ['ONLINE', 'OFFLINE'];
const NEW_CAMERA = { fovDeg: 60, rangeM: 90, status: 'ONLINE' as const };

export interface CameraPatch
{
    code?: string;
    lng?: number;
    lat?: number;
    headingDeg?: number;
    fovDeg?: number;
    rangeM?: number;
    status?: CameraStatus;
}

function ringOf(outline: unknown): LngLat[]
{
    const coordinates = (outline as { coordinates?: LngLat[][] })?.coordinates;
    return Array.isArray(coordinates?.[0]) ? coordinates[0] : [];
}

async function zoneViews(tx: Tx): Promise<(ZoneView & { id: string; addedByAdmin: boolean })[]>
{
    const rows = await tx.zone.findMany({ orderBy: { code: 'asc' } });
    return rows.map(zone => ({ id: zone.id, code: zone.code, name: zone.name, activityLevel: zone.activityLevel, ring: ringOf(zone.outline), addedByAdmin: zone.createdById !== null }));
}

const zoneViewOf = (zone: { id: string; code: string; name: string; activityLevel: ZoneView['activityLevel']; outline: unknown }): ZoneView =>
    ({ id: zone.id, code: zone.code, name: zone.name, activityLevel: zone.activityLevel, ring: ringOf(zone.outline) });

// The live importer feeds each zone's <zone>1 and <zone>2 cameras; those keep their codes and cannot be removed.
const isLiveSlot = (code: string, zoneCode: string) => code === `${zoneCode}1` || code === `${zoneCode}2`;

function placement<T>(work: () => T): T
{
    try
    {
        return work();
    }
    catch (error)
    {
        if (error instanceof PlacementError)
        {
            throw new CameraEditError(error.message);
        }
        throw error;
    }
}

// Two admins saving at once can race for the same camera code.
async function uniqueCodes<T>(work: Promise<T>): Promise<T>
{
    try
    {
        return await work;
    }
    catch (error)
    {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        {
            throw new CameraEditError('That camera code is already taken; try again.');
        }
        throw error;
    }
}

async function addPair(prisma: PrismaClient, actorId: string, click: LngLat, pickZone: (zones: ZoneView[]) => ZoneView): Promise<{ codes: [string, string]; zoneCode: string }>
{
    const result = await uniqueCodes(prisma.$transaction(async tx =>
    {
        const zone = pickZone(await zoneViews(tx));
        const codes = (await tx.camera.findMany({ select: { code: true } })).map(camera => camera.code);
        const plan = placement(() => planPairOnZone(click, zone, codes));
        await tx.camera.createMany({
            data: plan.cameras.map(camera => ({ code: camera.code, zoneId: zone.id, lng: camera.position[0], lat: camera.position[1], headingDeg: camera.headingDeg, ...NEW_CAMERA })),
        });
        await tx.auditLog.create({
            data: { userId: actorId, action: 'camera.pair.add', targetType: 'Zone', targetId: zone.id, details: { zone: zone.code, click, cameras: plan.cameras.map(camera => ({ code: camera.code, position: camera.position, headingDeg: camera.headingDeg })) } },
        });
        return { codes: [plan.cameras[0].code, plan.cameras[1].code] as [string, string], zoneCode: zone.code };
    }));
    publishChange('cameras');
    return result;
}

// A camera pair on the existing zone nearest the click; no zone is created.
export function addCameraPair(prisma: PrismaClient, actorId: string, click: LngLat)
{
    return addPair(prisma, actorId, click, zones => placement(() => nearestZone(click, zones)));
}

// A camera pair on a named zone, centred on the given point (Setup → Cameras).
export function addCameraPairToZone(prisma: PrismaClient, actorId: string, zoneCode: string, at: LngLat)
{
    return addPair(prisma, actorId, at, zones =>
    {
        const zone = zones.find(candidate => candidate.code === zoneCode);
        if (!zone)
        {
            throw new CameraEditError('That zone no longer exists.');
        }
        if (distanceToZone(at, zone) > MAX_ZONE_DISTANCE_M)
        {
            throw new CameraEditError(`That point is more than 2 km from Zone ${zone.code}.`);
        }
        return zone;
    });
}

function checkRange(name: keyof typeof CAMERA_LIMITS, value: number | undefined)
{
    const error = value === undefined ? null : rangeError(name, value);
    if (error)
    {
        throw new CameraEditError(error);
    }
}

// Validates and saves an edit to one camera, audited with before and after values.
export async function updateCamera(prisma: PrismaClient, actorId: string, code: string, patch: CameraPatch): Promise<{ code: string }>
{
    checkRange('lat', patch.lat);
    checkRange('lng', patch.lng);
    checkRange('headingDeg', patch.headingDeg);
    checkRange('fovDeg', patch.fovDeg);
    checkRange('rangeM', patch.rangeM);
    if (patch.status !== undefined && !STATUSES.includes(patch.status))
    {
        throw new CameraEditError('Status must be online or offline.');
    }
    const newCode = patch.code?.trim().toUpperCase();
    if (newCode !== undefined && !CAMERA_CODE.test(newCode))
    {
        throw new CameraEditError('Camera codes are a zone letter and a number from 1 to 99, like B3.');
    }

    const result = await uniqueCodes(prisma.$transaction(async tx =>
    {
        const camera = await tx.camera.findUnique({ where: { code }, include: { zone: true } });
        if (!camera)
        {
            throw new CameraEditError(`Camera ${code} no longer exists.`);
        }
        if ((patch.lng !== undefined || patch.lat !== undefined) && distanceToZone([patch.lng ?? camera.lng, patch.lat ?? camera.lat], zoneViewOf(camera.zone)) > MAX_ZONE_DISTANCE_M)
        {
            throw new CameraEditError(`That spot is more than 2 km from Zone ${camera.zone.code}.`);
        }
        if (newCode !== undefined && newCode !== camera.code)
        {
            if (newCode[0] !== camera.zone.code)
            {
                throw new CameraEditError(`Codes in Zone ${camera.zone.code} start with ${camera.zone.code}.`);
            }
            if (isLiveSlot(camera.code, camera.zone.code))
            {
                throw new CameraEditError(`Live footage for Zone ${camera.zone.code} arrives on ${camera.code}; keep its code.`);
            }
            if (await tx.camera.findUnique({ where: { code: newCode }, select: { id: true } }))
            {
                throw new CameraEditError(`Camera code ${newCode} is already taken.`);
            }
        }
        const data = {
            ...(newCode !== undefined ? { code: newCode } : {}),
            ...(patch.lng !== undefined ? { lng: patch.lng } : {}),
            ...(patch.lat !== undefined ? { lat: patch.lat } : {}),
            ...(patch.headingDeg !== undefined ? { headingDeg: patch.headingDeg % 360 } : {}),
            ...(patch.fovDeg !== undefined ? { fovDeg: patch.fovDeg } : {}),
            ...(patch.rangeM !== undefined ? { rangeM: patch.rangeM } : {}),
            ...(patch.status !== undefined ? { status: patch.status } : {}),
        };
        const before = Object.fromEntries(Object.keys(data).map(key => [key, camera[key as keyof typeof camera]]));
        const saved = await tx.camera.update({ where: { id: camera.id }, data });
        await tx.auditLog.create({ data: { userId: actorId, action: 'camera.update', targetType: 'Camera', targetId: camera.id, details: { code: camera.code, before, after: data } as Prisma.InputJsonValue } });
        return { code: saved.code };
    }));
    publishChange('cameras');
    return result;
}

// Removes a camera that has recorded nothing and is not a live-feed slot.
export async function deleteCamera(prisma: PrismaClient, actorId: string, code: string): Promise<void>
{
    await prisma.$transaction(async tx =>
    {
        const camera = await tx.camera.findUnique({ where: { code }, include: { zone: { select: { code: true } } } });
        if (!camera)
        {
            throw new CameraEditError(`Camera ${code} no longer exists.`);
        }
        const [videos, alerts] = await Promise.all([tx.video.count({ where: { cameraId: camera.id } }), tx.alert.count({ where: { cameraId: camera.id } })]);
        if (videos + alerts > 0)
        {
            throw new CameraEditError(`Camera ${code} has footage or alerts; it cannot be removed.`);
        }
        if (isLiveSlot(camera.code, camera.zone.code))
        {
            throw new CameraEditError(`Live footage for Zone ${camera.zone.code} arrives on ${code}; it cannot be removed.`);
        }
        await tx.camera.delete({ where: { id: camera.id } });
        await tx.auditLog.create({ data: { userId: actorId, action: 'camera.delete', targetType: 'Camera', targetId: camera.id, details: { code, zone: camera.zone.code, lng: camera.lng, lat: camera.lat } } });
    });
    publishChange('cameras');
}

// Turns a camera and its pair partner to face the sea, each 20° toward the other; positions are kept.
export async function faceOcean(prisma: PrismaClient, actorId: string, code: string): Promise<{ codes: string[] }>
{
    const result = await prisma.$transaction(async tx =>
    {
        const camera = await tx.camera.findUnique({ where: { code }, include: { zone: true } });
        if (!camera)
        {
            throw new CameraEditError(`Camera ${code} no longer exists.`);
        }
        const partnerName = partnerCode(camera.code);
        const partner = partnerName ? await tx.camera.findFirst({ where: { code: partnerName, zoneId: camera.zoneId } }) : null;
        const { seaward } = zoneOrientation(zoneViewOf(camera.zone));
        const cameras = partner ? [camera, partner].sort((a, b) => a.code.localeCompare(b.code)) : [camera];
        const changes = cameras.map(item =>
        {
            const other = cameras.find(candidate => candidate !== item);
            return { id: item.id, code: item.code, before: item.headingDeg, after: other ? seawardToward([item.lng, item.lat], [other.lng, other.lat], seaward) : seaward };
        });
        for (const change of changes)
        {
            await tx.camera.update({ where: { id: change.id }, data: { headingDeg: change.after } });
        }
        await tx.auditLog.create({ data: { userId: actorId, action: 'camera.face-ocean', targetType: 'Zone', targetId: camera.zone.id, details: { zone: camera.zone.code, seaward, cameras: changes.map(({ code: c, before, after }) => ({ code: c, before, after })) } } });
        return { codes: changes.map(change => change.code) };
    });
    publishChange('cameras');
    return result;
}

// Retires a zone: its cameras move to the nearest other zone under that zone's next codes,
// its live chunks and alerts are reassigned there, and the zone is deleted. One transaction.
export async function mergeZoneInto(prisma: PrismaClient, actorId: string, sourceCode: string): Promise<{ targetCode: string; moved: { from: string; to: string }[] }>
{
    const result = await uniqueCodes(prisma.$transaction(async tx =>
    {
        const zones = await zoneViews(tx);
        const source = zones.find(zone => zone.code === sourceCode);
        if (!source)
        {
            throw new CameraEditError('That zone no longer exists.');
        }
        // Seeded zones carry the simulation import pairs and live slots; only map-added zones can be merged away.
        if (!source.addedByAdmin)
        {
            throw new CameraEditError(`Zone ${source.code} is a built-in zone; only zones added on the map can be merged.`);
        }
        const others = zones.filter(zone => zone.code !== sourceCode);
        if (others.length === 0)
        {
            throw new CameraEditError('There is no other zone to merge into.');
        }
        const ring = source.ring.length > 1 ? source.ring.slice(0, -1) : source.ring;
        const centre: LngLat = ring.length > 0 ? [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length] : [0, 0];
        let target: ZoneView;
        try
        {
            target = nearestZone(centre, others);
        }
        catch (error)
        {
            if (error instanceof PlacementError)
            {
                throw new CameraEditError(`No other zone lies within 2 km of Zone ${source.code}; nothing was merged.`);
            }
            throw error;
        }

        const cameras = await tx.camera.findMany({ where: { zoneId: source.id }, orderBy: { code: 'asc' } });
        const allCodes = (await tx.camera.findMany({ select: { code: true } })).map(camera => camera.code);
        const newCodes = placement(() => nextCameraCodes(target.code, allCodes, cameras.length));
        const moved = cameras.map((camera, i) => ({ id: camera.id, from: camera.code, to: newCodes[i] }));
        for (const move of moved)
        {
            await tx.camera.update({ where: { id: move.id }, data: { code: move.to, zoneId: target.id } });
        }
        const [chunks, alerts] = await Promise.all([
            tx.liveChunk.updateMany({ where: { zoneId: source.id }, data: { zoneId: target.id } }),
            tx.alert.updateMany({ where: { zoneId: source.id }, data: { zoneId: target.id } }),
        ]);
        await tx.zone.delete({ where: { id: source.id } });
        await tx.auditLog.create({
            data: { userId: actorId, action: 'zone.merge', targetType: 'Zone', targetId: target.id, details: { source: source.code, sourceId: source.id, target: target.code, cameras: moved.map(({ from, to }) => ({ from, to })), liveChunks: chunks.count, alerts: alerts.count } },
        });
        return { targetCode: target.code, moved: moved.map(({ from, to }) => ({ from, to })) };
    }));
    publishChange('cameras');
    return result;
}

export interface CameraRow
{
    code: string;
    zoneCode: string;
    lng: number;
    lat: number;
    headingDeg: number;
    fovDeg: number;
    rangeM: number;
    status: CameraStatus;
    footage: number;
    alerts: number;
    liveSlot: boolean;
    /** Latest simulation clip: the mask editor draws its polygon over this feed. */
    video?: { id: string; maskPolygon: [number, number][] | null } | null;
}

// Every camera with its footage, alert counts and latest pickup, for Setup → Cameras.
export async function listCameras(prisma: PrismaClient): Promise<{ zones: { code: string; name: string; mergeable: boolean }[]; cameras: CameraRow[] }>
{
    const [zones, cameras] = await Promise.all([
        prisma.zone.findMany({ orderBy: { code: 'asc' }, select: { code: true, name: true, createdById: true } }),
        prisma.camera.findMany({
            include: {
                zone: { select: { code: true } },
                _count: { select: { videos: true, alerts: true } },
                videos: { where: { source: 'SIMULATION' }, orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, maskPolygon: true } },
            },
        }),
    ]);
    const order = (code: string) => { const m = /^([A-Z])([0-9]+)$/.exec(code); return m ? [m[1], Number(m[2])] as const : [code, 0] as const; };
    cameras.sort((a, b) => { const [x, y] = [order(a.code), order(b.code)]; return x[0].localeCompare(y[0]) || x[1] - y[1]; });
    return {
        zones: zones.map(zone => ({ code: zone.code, name: zone.name, mergeable: zone.createdById !== null })),
        cameras: cameras.map(camera => ({
            code: camera.code, zoneCode: camera.zone.code, lng: camera.lng, lat: camera.lat, headingDeg: camera.headingDeg,
            fovDeg: camera.fovDeg, rangeM: camera.rangeM, status: camera.status, footage: camera._count.videos, alerts: camera._count.alerts,
            liveSlot: isLiveSlot(camera.code, camera.zone.code),
            video: camera.videos[0] ? { id: camera.videos[0].id, maskPolygon: Array.isArray(camera.videos[0].maskPolygon) ? camera.videos[0].maskPolygon as [number, number][] : null } : null,
        })),
    };
}
