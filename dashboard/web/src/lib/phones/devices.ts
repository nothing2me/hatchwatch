import type { PrismaClient } from '@/generated/prisma/client';
import type { SessionUser } from '@/lib/auth/session';
import type { LiveDeviceView } from '@/lib/types';
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
    const existing = await prisma.liveDevice.findFirst({ where: { ownerId, name, disabledAt: null }, orderBy: { createdAt: 'asc' }, include: { camera: { select: { code: true } } } });
    if (existing)
    {
        return { id: existing.id, name: existing.name, cameraCode: existing.camera?.code ?? null, created: false };
    }
    const row = await prisma.liveDevice.create({ data: { ownerId, name } });
    return { id: row.id, name: row.name, cameraCode: null, created: true };
}

export type FrameAccess = { ok: true; device: { id: string; name: string; cameraCode: string | null } } | { ok: false; status: 403 | 404 };

// The owner or an admin may send for a phone; a removed phone takes no frames.
export async function frameAccess(prisma: PrismaClient, deviceId: string, user: SessionUser): Promise<FrameAccess>
{
    const row = await prisma.liveDevice.findUnique({ where: { id: deviceId }, select: { id: true, name: true, ownerId: true, disabledAt: true, camera: { select: { code: true } } } });
    if (!row)
    {
        return { ok: false, status: 404 };
    }
    if (row.disabledAt || (row.ownerId !== user.id && user.role !== 'ADMIN'))
    {
        return { ok: false, status: 403 };
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
        include: { owner: { select: { name: true } }, camera: { select: { code: true } } },
    });
    return rows.map(row =>
    {
        const frameAt = store.lastFrameAt(row.id);
        return {
            id: row.id,
            name: row.name,
            ownerName: row.owner.name,
            cameraCode: row.camera?.code ?? null,
            online: online.has(row.id),
            recording: options.isRecording?.(row.id) ?? false,
            lastSeenAt: new Date(Math.max(frameAt ?? 0, row.lastSeenAt.getTime())).toISOString(),
        };
    });
}
