import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { publishChange } from '@/lib/changes';
import type { CameraStatus, LngLat, ZoneView } from '@/lib/types';
import { CAMERA_CODE, type CAMERA_LIMITS, rangeError } from './limits';
import { checkZoneClear, distanceToZone, nearestZone, nextCameraCodes, partnerCode, placementFor, planNewZone, planPairOnZone, PlacementError, seawardToward, translateZone, zoneOrientation } from './placePair';

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
            throw new CameraEditError('That camera or zone code was just taken; try again.');
        }
        throw error;
    }
}

export type PairResult = { codes: [string, string]; zoneCode: string; newZone: boolean };
type ZoneList = Awaited<ReturnType<typeof zoneViews>>;

async function pairOnZone(tx: Tx, actorId: string, click: LngLat, zone: ZoneView): Promise<PairResult>
{
    const codes = (await tx.camera.findMany({ select: { code: true } })).map(camera => camera.code);
    const plan = placement(() => planPairOnZone(click, zone, codes));
    await tx.camera.createMany({
        data: plan.cameras.map(camera => ({ code: camera.code, zoneId: zone.id, lng: camera.position[0], lat: camera.position[1], headingDeg: camera.headingDeg, ...NEW_CAMERA })),
    });
    await tx.auditLog.create({
        data: { userId: actorId, action: 'camera.pair.add', targetType: 'Zone', targetId: zone.id, details: { zone: zone.code, click, cameras: plan.cameras.map(camera => ({ code: camera.code, position: camera.position, headingDeg: camera.headingDeg })) } },
    });
    return { codes: [plan.cameras[0].code, plan.cameras[1].code], zoneCode: zone.code, newZone: false };
}

// A new zone at the click (rectangle on the shore, made by this admin) with its first pair, audited as one entry.
async function pairOnNewZone(tx: Tx, actorId: string, click: LngLat, zones: ZoneList): Promise<PairResult>
{
    const codes = (await tx.camera.findMany({ select: { code: true } })).map(camera => camera.code);
    const plan = placement(() => planNewZone(click, zones, zones.map(zone => zone.code), codes));
    const zone = await tx.zone.create({ data: { code: plan.code, name: `Zone ${plan.code}`, activityLevel: 'LOW', createdById: actorId, outline: { type: 'Polygon', coordinates: [plan.ring] } } });
    await tx.camera.createMany({
        data: plan.cameras.map(camera => ({ code: camera.code, zoneId: zone.id, lng: camera.position[0], lat: camera.position[1], headingDeg: camera.headingDeg, ...NEW_CAMERA })),
    });
    await tx.auditLog.create({
        data: { userId: actorId, action: 'zone.create', targetType: 'Zone', targetId: zone.id, details: { zone: plan.code, click, ring: plan.ring, cameras: plan.cameras.map(camera => ({ code: camera.code, position: camera.position, headingDeg: camera.headingDeg })) } },
    });
    return { codes: [plan.cameras[0].code, plan.cameras[1].code], zoneCode: plan.code, newZone: true };
}

async function inTransaction<T>(prisma: PrismaClient, work: (tx: Tx) => Promise<T>): Promise<T>
{
    const result = await uniqueCodes(prisma.$transaction(work));
    publishChange('cameras');
    return result;
}

// A map click: inside or within 150 m of a zone adds a pair to it; farther from every zone makes a new zone there.
export function addCameraPair(prisma: PrismaClient, actorId: string, click: LngLat): Promise<PairResult>
{
    return inTransaction(prisma, async tx =>
    {
        const zones = await zoneViews(tx);
        const choice = placementFor(click, zones);
        return choice.kind === 'join' ? pairOnZone(tx, actorId, click, choice.zone) : pairOnNewZone(tx, actorId, click, zones);
    });
}

// A camera pair on a named zone, centred on the given point (Setup → Cameras).
export function addCameraPairToZone(prisma: PrismaClient, actorId: string, zoneCode: string, at: LngLat): Promise<PairResult>
{
    return inTransaction(prisma, async tx =>
    {
        const zone = (await zoneViews(tx)).find(candidate => candidate.code === zoneCode);
        if (!zone)
        {
            throw new CameraEditError('That zone no longer exists.');
        }
        if (distanceToZone(at, zone) > MAX_ZONE_DISTANCE_M)
        {
            throw new CameraEditError(`That point is more than 2 km from Zone ${zone.code}.`);
        }
        return pairOnZone(tx, actorId, at, zone);
    });
}

// Always a new zone at the point (Setup → Cameras); refused when its rectangle would overlap a zone.
export function addCameraPairNewZone(prisma: PrismaClient, actorId: string, at: LngLat): Promise<PairResult>
{
    return inTransaction(prisma, async tx => pairOnNewZone(tx, actorId, at, await zoneViews(tx)));
}

async function mapMadeZone(tx: Tx, code: string, verb: 'moved' | 'deleted')
{
    const zones = await zoneViews(tx);
    const zone = zones.find(candidate => candidate.code === code);
    if (!zone)
    {
        throw new CameraEditError('That zone no longer exists.');
    }
    // Seeded zones carry the simulation import pairs and the live slots.
    if (!zone.addedByAdmin)
    {
        throw new CameraEditError(`Zone ${zone.code} is a built-in zone; only zones added on the map can be ${verb}.`);
    }
    return { zone, others: zones.filter(candidate => candidate.code !== code) };
}

// Drags a map-made zone: its outline and cameras shift by the same offset (from → to), headings kept.
export function moveZone(prisma: PrismaClient, actorId: string, code: string, from: LngLat, to: LngLat): Promise<{ code: string }>
{
    return inTransaction(prisma, async tx =>
    {
        const { zone, others } = await mapMadeZone(tx, code, 'moved');
        const cameras = await tx.camera.findMany({ where: { zoneId: zone.id }, orderBy: { code: 'asc' } });
        const moved = translateZone(zone.ring, cameras.map(camera => [camera.lng, camera.lat] as LngLat), from, to);
        placement(() => checkZoneClear(moved.ring, others));
        for (const [point, label] of [[moved.ring[0], 'zone'] as const, ...moved.points.map(point => [point, 'camera'] as const)])
        {
            if (rangeError('lng', point[0]) || rangeError('lat', point[1]))
            {
                throw new CameraEditError(`That would put the ${label} off the map.`);
            }
        }
        await tx.zone.update({ where: { id: zone.id }, data: { outline: { type: 'Polygon', coordinates: [moved.ring] } } });
        for (const [i, camera] of cameras.entries())
        {
            await tx.camera.update({ where: { id: camera.id }, data: { lng: moved.points[i][0], lat: moved.points[i][1] } });
        }
        await tx.auditLog.create({
            data: { userId: actorId, action: 'zone.move', targetType: 'Zone', targetId: zone.id, details: { zone: zone.code, from, to, before: zone.ring, after: moved.ring, cameras: cameras.map(camera => camera.code) } },
        });
        return { code: zone.code };
    });
}

// Removes a map-made zone and its cameras when nothing was ever recorded there.
export function deleteZone(prisma: PrismaClient, actorId: string, code: string): Promise<{ code: string }>
{
    return inTransaction(prisma, async tx =>
    {
        const { zone } = await mapMadeZone(tx, code, 'deleted');
        const [videos, alerts, chunks] = await Promise.all([
            tx.video.count({ where: { camera: { zoneId: zone.id } } }),
            tx.alert.count({ where: { OR: [{ zoneId: zone.id }, { camera: { zoneId: zone.id } }] } }),
            tx.liveChunk.count({ where: { zoneId: zone.id } }),
        ]);
        if (videos + alerts + chunks > 0)
        {
            throw new CameraEditError(`Zone ${zone.code} has footage, alerts or live chunks; merge it into a neighbour instead.`);
        }
        const cameras = await tx.camera.findMany({ where: { zoneId: zone.id }, orderBy: { code: 'asc' }, select: { code: true } });
        await tx.camera.deleteMany({ where: { zoneId: zone.id } });
        await tx.zone.delete({ where: { id: zone.id } });
        await tx.auditLog.create({ data: { userId: actorId, action: 'zone.delete', targetType: 'Zone', targetId: zone.id, details: { zone: zone.code, ring: zone.ring, cameras: cameras.map(camera => camera.code) } } });
        return { code: zone.code };
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
}

// Every camera with its footage and alert counts, for Setup → Cameras.
export async function listCameras(prisma: PrismaClient): Promise<{ zones: { code: string; name: string; mergeable: boolean }[]; cameras: CameraRow[] }>
{
    const [zones, cameras] = await Promise.all([
        prisma.zone.findMany({ orderBy: { code: 'asc' }, select: { code: true, name: true, createdById: true } }),
        prisma.camera.findMany({ include: { zone: { select: { code: true } }, _count: { select: { videos: true, alerts: true } } } }),
    ]);
    const order = (code: string) => { const m = /^([A-Z])([0-9]+)$/.exec(code); return m ? [m[1], Number(m[2])] as const : [code, 0] as const; };
    cameras.sort((a, b) => { const [x, y] = [order(a.code), order(b.code)]; return x[0].localeCompare(y[0]) || x[1] - y[1]; });
    return {
        zones: zones.map(zone => ({ code: zone.code, name: zone.name, mergeable: zone.createdById !== null })),
        cameras: cameras.map(camera => ({
            code: camera.code, zoneCode: camera.zone.code, lng: camera.lng, lat: camera.lat, headingDeg: camera.headingDeg,
            fovDeg: camera.fovDeg, rangeM: camera.rangeM, status: camera.status, footage: camera._count.videos, alerts: camera._count.alerts,
            liveSlot: isLiveSlot(camera.code, camera.zone.code),
        })),
    };
}
