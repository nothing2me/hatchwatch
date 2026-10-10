export const MAX_FRAME_BYTES = 500 * 1024;
export const MAX_FRAMES_PER_SECOND = 10;
export const ONLINE_MS = 10_000;
export const TOUCH_EVERY_MS = 5_000;
const PRUNE_MS = 60_000;

interface Entry
{
    jpeg: Buffer;
    at: number;
    recent: number[];
    touchedAt: number;
}

export type PutResult = { ok: true; at: number; touch: boolean } | { ok: false; reason: 'rate' };

// Newest JPEG per phone, held in memory by the single web process (spec §3). Not shared across instances.
export class FrameStore
{
    private entries = new Map<string, Entry>();

    put(deviceId: string, jpeg: Buffer, now: number = Date.now()): PutResult
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
        this.entries.set(deviceId, { jpeg, at, recent, touchedAt: touch || !entry ? now : entry.touchedAt });
        return { ok: true, at, touch };
    }

    latest(deviceId: string, now: number = Date.now()): { jpeg: Buffer; at: number } | null
    {
        const entry = this.entries.get(deviceId);
        return entry && now - entry.at <= ONLINE_MS ? { jpeg: entry.jpeg, at: entry.at } : null;
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

const globalStore = globalThis as unknown as { __nesttraceFrames?: FrameStore };
export const frameStore = globalStore.__nesttraceFrames ??= new FrameStore();
