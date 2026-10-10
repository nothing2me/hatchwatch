import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { publishChange } from '@/lib/changes';
import type { LngLat, ZoneView } from '@/lib/types';
import { planCameraPair, PlacementError } from './placePair';

export class CameraEditError extends Error {}

const BLOCKED = 'This zone has footage or alerts; it cannot be removed.';

function ringOf(outline: unknown): LngLat[]
{
    const coordinates = (outline as { coordinates?: LngLat[][] })?.coordinates;
    return Array.isArray(coordinates?.[0]) ? coordinates[0] : [];
}

// Plans and stores a new zone with a camera pair on its land edge, in one transaction.
export async function addCameraPair(prisma: PrismaClient, actorId: string, click: LngLat): Promise<{ code: string }>
{
    const rows = await prisma.zone.findMany({ orderBy: { code: 'asc' } });
    const zones: ZoneView[] = rows.map(zone => ({ id: zone.id, code: zone.code, name: zone.name, activityLevel: zone.activityLevel, ring: ringOf(zone.outline), custom: zone.createdById !== null }));
    let plan;
    try
    {
        plan = planCameraPair(click, zones, rows.map(zone => zone.code));
    }
    catch (error)
    {
        if (error instanceof PlacementError)
        {
            throw new CameraEditError(error.message);
        }
        throw error;
    }

    try
    {
        await prisma.$transaction(async tx =>
        {
            const zone = await tx.zone.create({
                data: {
                    code: plan.code,
                    name: `Zone ${plan.code}`,
                    activityLevel: 'LOW',
                    createdById: actorId,
                    outline: { type: 'Polygon', coordinates: [plan.ring] },
                },
            });
            await tx.camera.createMany({
                data: plan.cameras.map(camera => ({
                    code: camera.code, zoneId: zone.id, lng: camera.position[0], lat: camera.position[1],
                    headingDeg: camera.headingDeg, fovDeg: 60, rangeM: 90, status: 'ONLINE' as const,
                })),
            });
            await tx.auditLog.create({
                data: { userId: actorId, action: 'zone.create', targetType: 'Zone', targetId: zone.id, details: { code: plan.code, click, cameras: plan.cameras.map(camera => camera.code) } },
            });
        });
    }
    catch (error)
    {
        // Two admins clicking at once can race for the same letter.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        {
            throw new CameraEditError('Another zone was added at the same moment; click again.');
        }
        throw error;
    }
    publishChange('cameras');
    return { code: plan.code };
}

// Removes a zone added on the map, only while nothing has been recorded against it.
export async function deleteZone(prisma: PrismaClient, actorId: string, code: string): Promise<void>
{
    await prisma.$transaction(async tx =>
    {
        const zone = await tx.zone.findUnique({ where: { code }, include: { cameras: { select: { id: true, code: true } } } });
        if (!zone)
        {
            throw new CameraEditError('That zone no longer exists.');
        }
        if (zone.createdById === null)
        {
            throw new CameraEditError('Only zones added on the map can be removed.');
        }
        const cameraIds = zone.cameras.map(camera => camera.id);
        const [chunks, videos, alerts] = await Promise.all([
            tx.liveChunk.count({ where: { zoneId: zone.id } }),
            tx.video.count({ where: { cameraId: { in: cameraIds } } }),
            tx.alert.count({ where: { OR: [{ zoneId: zone.id }, { cameraId: { in: cameraIds } }] } }),
        ]);
        if (chunks + videos + alerts > 0)
        {
            throw new CameraEditError(BLOCKED);
        }
        await tx.camera.deleteMany({ where: { zoneId: zone.id } });
        await tx.zone.delete({ where: { id: zone.id } });
        await tx.auditLog.create({
            data: { userId: actorId, action: 'zone.delete', targetType: 'Zone', targetId: zone.id, details: { code, cameras: zone.cameras.map(camera => camera.code) } },
        });
    });
    publishChange('cameras');
}
