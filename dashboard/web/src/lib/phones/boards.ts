import type { PrismaClient } from '@/generated/prisma/client';
import { CameraEditError } from '@/lib/cameras/manage';
import { newDeviceToken } from './deviceToken';
import { cleanDeviceName, DEVICE_NAME_MAX } from './devices';

export interface IssuedToken
{
    id: string;
    name: string;
    token: string;
}

// A new camera board owned by the admin. The token is returned once and only its hash is stored.
export async function createBoard(prisma: PrismaClient, actorId: string, rawName: string): Promise<IssuedToken>
{
    const name = cleanDeviceName(rawName);
    if (!name)
    {
        throw new CameraEditError(`Give the board a name of 1 to ${DEVICE_NAME_MAX} characters.`);
    }
    const { token, hash } = newDeviceToken();
    const row = await prisma.$transaction(async tx =>
    {
        const created = await tx.liveDevice.create({ data: { ownerId: actorId, name, kind: 'BOARD', tokenHash: hash }, select: { id: true, name: true } });
        await tx.auditLog.create({ data: { userId: actorId, action: 'device.create', targetType: 'LiveDevice', targetId: created.id, details: { name, kind: 'BOARD' } } });
        return created;
    });
    return { id: row.id, name: row.name, token };
}

// Replaces a board's token; the old one stops working on the board's next frame.
export async function rotateBoardToken(prisma: PrismaClient, actorId: string, deviceId: string): Promise<IssuedToken>
{
    const { token, hash } = newDeviceToken();
    const row = await prisma.$transaction(async tx =>
    {
        const device = await tx.liveDevice.findUnique({ where: { id: deviceId }, select: { id: true, name: true, kind: true, disabledAt: true } });
        if (!device || device.disabledAt)
        {
            throw new CameraEditError('That board was removed.');
        }
        if (device.kind !== 'BOARD')
        {
            throw new CameraEditError('Only camera boards have a token.');
        }
        await tx.liveDevice.update({ where: { id: device.id }, data: { tokenHash: hash }, select: { id: true } });
        await tx.auditLog.create({ data: { userId: actorId, action: 'device.rotate', targetType: 'LiveDevice', targetId: device.id, details: { name: device.name } } });
        return device;
    });
    return { id: row.id, name: row.name, token };
}
