import type { PrismaClient } from '@/generated/prisma/client';
import { publishChange } from '@/lib/changes';
import type { LiveDeviceView } from '@/lib/types';

// A device is online while it heartbeats (every 5 s from /cam); three missed beats and it is offline.
export const DEVICE_ONLINE_MS = 15_000;

export function isDeviceOnline(lastSeenAt: Date, now: Date = new Date()): boolean
{
    return now.getTime() - lastSeenAt.getTime() <= DEVICE_ONLINE_MS;
}

export async function registerDevice(prisma: PrismaClient, ownerId: string, name: string): Promise<{ id: string; name: string }>
{
    const clean = name.trim().slice(0, 60) || 'Unnamed device';
    return prisma.liveDevice.create({ data: { ownerId, name: clean }, select: { id: true, name: true } });
}

// Only the device's owner may keep it alive. False when the device is missing or someone else's.
export async function touchDevice(prisma: PrismaClient, deviceId: string, ownerId: string): Promise<boolean>
{
    const result = await prisma.liveDevice.updateMany({ where: { id: deviceId, ownerId }, data: { lastSeenAt: new Date() } });
    return result.count === 1;
}

export async function listDevices(prisma: PrismaClient, now: Date = new Date()): Promise<LiveDeviceView[]>
{
    const rows = await prisma.liveDevice.findMany({ orderBy: { createdAt: 'desc' }, include: { camera: { select: { code: true } } } });
    return rows.map(row => ({ id: row.id, name: row.name, online: isDeviceOnline(row.lastSeenAt, now), cameraCode: row.camera?.code ?? null }));
}

export class AssignError extends Error
{
    constructor(public code: 'NO_CAMERA' | 'NO_DEVICE' | 'DEVICE_IN_USE', message: string)
    {
        super(message);
    }
}

// Points a camera at a live device (or back to its simulation loop with null). Audited.
export async function assignSource(prisma: PrismaClient, { cameraCode, deviceId, userId }: { cameraCode: string; deviceId: string | null; userId: string }): Promise<void>
{
    await prisma.$transaction(async tx =>
    {
        const camera = await tx.camera.findUnique({ where: { code: cameraCode } });
        if (!camera)
        {
            throw new AssignError('NO_CAMERA', `Camera ${cameraCode} does not exist.`);
        }
        if (deviceId)
        {
            const device = await tx.liveDevice.findUnique({ where: { id: deviceId }, include: { camera: { select: { code: true } } } });
            if (!device)
            {
                throw new AssignError('NO_DEVICE', 'That device is no longer registered.');
            }
            if (device.camera && device.camera.code !== cameraCode)
            {
                throw new AssignError('DEVICE_IN_USE', `That device already feeds camera ${device.camera.code}.`);
            }
        }
        await tx.camera.update({ where: { id: camera.id }, data: { liveDeviceId: deviceId } });
        await tx.auditLog.create({ data: { userId, action: 'camera.source', targetType: 'Camera', targetId: camera.id, details: { cameraCode, deviceId } } });
    });
    publishChange('cameras');
}
