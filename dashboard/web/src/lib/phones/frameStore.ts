import type { DetectionsView } from '@/lib/types';

export const MAX_FRAME_BYTES = 500 * 1024;
export const MAX_FRAMES_PER_SECOND = 10;
export const ONLINE_MS = 10_000;
export const TOUCH_EVERY_MS = 5_000;
export const DETECTIONS_FRESH_MS = ONLINE_MS;
const PRUNE_MS = 60_000;

export interface BoardMotion
{
    percent: number;
    active: boolean;
    box: [number, number, number, number];
}

interface Entry
{
    jpeg: Buffer;
    at: number;
    recent: number[];
    touchedAt: number;
    motion: BoardMotion | null;
    detections: (DetectionsView & { postedAt: number }) | null;
}

export type PutResult = { ok: true; at: number; touch: boolean } | { ok: false; reason: 'rate' };

// Newest JPEG per phone, held in memory by the single web process (spec §3). Not shared across instances.
export class FrameStore
{
    private entries = new Map<string, Entry>();

    put(deviceId: string, jpeg: Buffer, now: number = Date.now(), motion: BoardMotion | null = null): PutResult
    {
        const entry = this.entries.get(deviceId);
        const recent = (entry?.recent ?? []).filter(t => now - t < 1000);
        if (recent.length >= MAX_FRAMES_PER_SECOND)
        {
            if (entry)
            {
                entry.recent = recent;
            }
            return { ok: false, reason: 'rate' };
        }
        recent.push(now);
        const at = entry && now <= entry.at ? entry.at + 1 : now;
        const touch = !entry || now - entry.touchedAt >= TOUCH_EVERY_MS;
        this.entries.set(deviceId, { jpeg, at, recent, touchedAt: touch || !entry ? now : entry.touchedAt, motion, detections: entry?.detections ?? null });
        return { ok: true, at, touch };
    }

    latest(deviceId: string, now: number = Date.now()): { jpeg: Buffer; at: number } | null
    {
        const entry = this.entries.get(deviceId);
        return entry && now - entry.at <= ONLINE_MS ? { jpeg: entry.jpeg, at: entry.at } : null;
    }

    // The motion that came with the newest frame, while the device is online.
    motion(deviceId: string, now: number = Date.now()): (BoardMotion & { at: number }) | null
    {
        const entry = this.entries.get(deviceId);
        return entry?.motion && now - entry.at <= ONLINE_MS ? { ...entry.motion, at: entry.at } : null;
    }

    // A worker result for the device's current picture; older or repeated frame times are refused, and so is a time
    // after the newest frame this store issued (a far-future result would otherwise lock out every later one).
    putDetections(deviceId: string, detections: DetectionsView, now: number = Date.now()): 'stored' | 'stale' | 'offline'
    {
        const entry = this.entries.get(deviceId);
        if (!entry || now - entry.at > ONLINE_MS)
        {
            return 'offline';
        }
        if (detections.at > entry.at || (entry.detections && detections.at <= entry.detections.at))
        {
            return 'stale';
        }
        entry.detections = { ...detections, postedAt: now };
        return 'stored';
    }

    // Null while offline, or when the worker has not reported for DETECTIONS_FRESH_MS (the tile says "Detection off").
    detections(deviceId: string, now: number = Date.now()): DetectionsView | null
    {
        const entry = this.entries.get(deviceId);
        const stored = entry?.detections;
        if (!entry || !stored || now - entry.at > ONLINE_MS || now - stored.postedAt > DETECTIONS_FRESH_MS)
        {
            return null;
        }
        return { at: stored.at, dark: stored.dark, width: stored.width, height: stored.height, objects: stored.objects, trails: stored.trails };
    }

    isOnline(deviceId: string, now: number = Date.now()): boolean
    {
        return this.latest(deviceId, now) !== null;
    }

    onlineIds(now: number = Date.now()): string[]
    {
        for (const [id, entry] of this.entries)
        {
            if (now - entry.at > PRUNE_MS)
            {
                this.entries.delete(id);
            }
        }
        return [...this.entries.keys()].filter(id => this.isOnline(id, now));
    }

    lastFrameAt(deviceId: string): number | null
    {
        return this.entries.get(deviceId)?.at ?? null;
    }

    forget(deviceId: string): void
    {
        this.entries.delete(deviceId);
    }
}

const globalStore = globalThis as unknown as { __hatchwatchFrames?: FrameStore };
export const frameStore = globalStore.__hatchwatchFrames ??= new FrameStore();
