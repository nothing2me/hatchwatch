import { Prisma, type PrismaClient } from '@/generated/prisma/client';
import { publishChange } from '@/lib/changes';
import { CameraEditError } from './manage';
import { cleanCameraMask, type MaskPoint } from './masks';

/** Saves one camera's watch area (normalised, validated by the caller) or clears it with null, audited. */
export async function setCameraMask(prisma: PrismaClient, actorId: string, code: string, polygon: MaskPoint[] | null, now: Date = new Date()): Promise<{ code: string; mask: MaskPoint[] | null }>
{
    const mask = polygon ? cleanCameraMask(polygon) : null;
    await prisma.$transaction(async tx =>
    {
        const camera = await tx.camera.findUnique({ where: { code }, select: { id: true } });
        if (!camera)
        {
            throw new CameraEditError(`No camera ${code}.`);
        }
        await tx.camera.update({ where: { id: camera.id }, data: { maskPolygon: mask ?? Prisma.DbNull, maskUpdatedAt: now } });
        await tx.auditLog.create({ data: { userId: actorId, action: 'camera.mask', targetType: 'Camera', targetId: camera.id, details: { code, points: mask ? mask.length : null } } });
    });
    publishChange('cameras');
    return { code, mask };
}
