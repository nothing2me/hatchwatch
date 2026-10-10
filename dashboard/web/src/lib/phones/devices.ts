import type { PrismaClient } from '@/generated/prisma/client';
import type { SessionUser } from '@/lib/auth/session';
import { CameraEditError } from '@/lib/cameras/manage';
import { publishChange } from '@/lib/changes';
import type { LiveDeviceView } from '@/lib/types';
import { tokenMatches } from './deviceToken';
import type { FrameStore } from './frameStore';

export const DEVICE_NAME_MAX = 60;

export function cleanDeviceName(name: string): string | null
{
    const clean = name.replace(/\s+/g, ' ').trim();
    return clean.length >= 1 && clean.length <= DEVICE_NAME_MAX ? clean : null;
}

export interface RegisteredDevice
{
    id: string;
    name: string;
    cameraCode: string | null;
    created: boolean;
}

// One phone per owner and name while it is not removed; the phone re-registers on every Start.
export async function registerDevice(prisma: PrismaClient, ownerId: string, name: string): Promise<RegisteredDevice>
{
    const existing = await prisma.liveDevice.findFirst({ where: { ownerId, name, kind: 'PHONE', disabledAt: null }, orderBy: { createdAt: 'asc' }, include: { camera: { select: { code: true } } } });
    if (existing)
    {
        return { id: existing.id, name: existing.name, cameraCode: existing.camera?.code ?? null, created: false };
    }
    const row = await prisma.liveDevice.create({ data: { ownerId, name, kind: 'PHONE' } });
    return { id: row.id, name: row.name, cameraCode: null, created: true };
}

export type FrameAccess = { ok: true; device: { id: string; name: string; cameraCode: string | null } } | { ok: false; status: 401 | 403 | 404 };

// Session senders: a board needs its token (401); otherwise the owner or an admin, never a viewer, and never a removed phone.
export async function frameAccess(prisma: PrismaClient, deviceId: string, user: SessionUser): Promise<FrameAccess>
{
    const row = await prisma.liveDevice.findUnique({ where: { id: deviceId }, select: { id: true, name: true, kind: true, ownerId: true, disabledAt: true, camera: { select: { code: true } } } });
    if (!row)
    {
        return { ok: false, status: 404 };
    }
    if (row.kind === 'BOARD')
    {
        return { ok: false, status: 401 };
    }
    if ((user.role !== 'VOLUNTEER' && user.role !== 'ADMIN') || row.disabledAt || (row.ownerId !== user.id && user.role !== 'ADMIN'))
    {
        return { ok: false, status: 403 };
    }
    return { ok: true, device: { id: row.id, name: row.name, cameraCode: row.camera?.code ?? null } };
}

export type BoardAccess = { ok: true; device: { id: string; name: string; cameraCode: string | null } } | { ok: false };

// A bearer token opens only its own BOARD while that board is not removed. The comparison runs even for unknown ids.
export async function boardAccess(prisma: PrismaClient, deviceId: string, token: string): Promise<BoardAccess>
{
    const row = await prisma.liveDevice.findUnique({ where: { id: deviceId }, select: { id: true, name: true, kind: true, tokenHash: true, disabledAt: true, camera: { select: { code: true } } } });
    const matches = tokenMatches(token, row?.tokenHash ?? null);
    if (!row || !matches || row.kind !== 'BOARD' || row.disabledAt)
    {
        return { ok: false };
    }
    return { ok: true, device: { id: row.id, name: row.name, cameraCode: row.camera?.code ?? null } };
}

export async function touchDevice(prisma: PrismaClient, deviceId: string, at: Date): Promise<void>
{
    await prisma.liveDevice.updateMany({ where: { id: deviceId }, data: { lastSeenAt: at } });
}

// Online phones for everyone; admins (all: true) also get silent ones, for the Source picker and the phones list.
export async function listDevices(prisma: PrismaClient, store: FrameStore, options: { all: boolean; isRecording?: (deviceId: string) => boolean; now?: number }): Promise<LiveDeviceView[]>
{
    const now = options.now ?? Date.now();
    const online = new Set(store.onlineIds(now));
    const rows = await prisma.liveDevice.findMany({
        where: options.all ? { disabledAt: null } : { disabledAt: null, id: { in: [...online] } },
        orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, kind: true, lastSeenAt: true, owner: { select: { name: true } }, camera: { select: { code: true } } },
    });
    return rows.map(row =>
    {
        const frameAt = store.lastFrameAt(row.id);
        const reading = row.kind === 'BOARD' ? store.motion(row.id, now) : null;
        return {
            id: row.id,
            name: row.name,
            kind: row.kind,
            ownerName: row.owner.name,
            cameraCode: row.camera?.code ?? null,
            online: online.has(row.id),
            recording: options.isRecording?.(row.id) ?? false,
            lastSeenAt: new Date(Math.max(frameAt ?? 0, row.lastSeenAt.getTime())).toISOString(),
            motion: reading ? { percent: reading.percent, active: reading.active, box: reading.box, at: new Date(reading.at).toISOString() } : null,
        };
    });
}

// Admin removal: the phone takes no more frames, leaves every list, and its camera returns to the simulation loop.
export async function removeDevice(prisma: PrismaClient, actorId: string, deviceId: string): Promise<{ unlinked: string | null }>
{
    const result = await prisma.$transaction(async tx =>
    {
        const device = await tx.liveDevice.findUnique({ where: { id: deviceId }, include: { camera: { select: { id: true, code: true } } } });
        if (!device || device.disabledAt)
        {
            throw new CameraEditError('That phone was already removed.');
        }
        if (device.camera)
        {
            await tx.camera.update({ where: { id: device.camera.id }, data: { liveDeviceId: null } });
        }
        await tx.liveDevice.update({ where: { id: deviceId }, data: { disabledAt: new Date() } });
        await tx.auditLog.create({ data: { userId: actorId, action: 'device.remove', targetType: 'LiveDevice', targetId: deviceId, details: { name: device.name, unlinked: device.camera?.code ?? null } } });
        return { unlinked: device.camera?.code ?? null };
    });
    publishChange('cameras');
    return result;
}
