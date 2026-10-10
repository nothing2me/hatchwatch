import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PrismaClient } from '@/generated/prisma/client';
import { publishChange } from '@/lib/changes';
import { mediaRoot } from '@/lib/media';
import { addSiteEvent } from '@/lib/sites/events';
import { PERSON_EVENTS } from '@/lib/sites/summary';
import { importLiveChunk, LIVE_MANIFEST_FILE } from './importChunk';

export interface LiveSettings
{
    root: string;
    mediaRoot: string;
    fadeMinutes: number;
    archiveMinutes: number;
    keep: number;
}

const positive = (value: string | undefined, fallback: number) =>
{
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export function liveSettings(env: NodeJS.ProcessEnv = process.env): LiveSettings
{
    return {
        root: resolve(process.cwd(), env.LIVE_ROOT || '../../artifacts/public'),
        mediaRoot: mediaRoot(),
        fadeMinutes: positive(env.LIVE_FADE_MINUTES, 5),
        archiveMinutes: positive(env.LIVE_ARCHIVE_MINUTES, 20),
        keep: Math.floor(positive(env.LIVE_KEEP, 40)),
    };
}

// Chunks that failed to import, by id -> manifest mtime; skipped until the manifest changes.
const failed = new Map<string, number>();

// Imports every new chunk folder that has its manifest (written last by the runner).
export async function scanOnce(prisma: PrismaClient, settings: LiveSettings): Promise<number>
{
    if (!existsSync(settings.root))
    {
        return 0;
    }
    const names = readdirSync(settings.root, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && /^live-[0-9]{6}-[A-Za-z0-9]+$/.test(entry.name))
        .map(entry => entry.name)
        .sort();
    let imported = 0;
    for (const name of names)
    {
        const chunkDir = join(settings.root, name);
        const manifestPath = join(chunkDir, LIVE_MANIFEST_FILE);
        if (!existsSync(manifestPath))
        {
            continue;
        }
        const mtime = statSync(manifestPath).mtimeMs;
        if (failed.get(name) === mtime)
        {
            continue;
        }
        try
        {
            failed.delete(name);
            const result = await importLiveChunk(prisma, { chunkDir, mediaRoot: settings.mediaRoot });
            if (result)
            {
                imported += 1;
                console.log(`[live] imported ${result.chunkId} onto zone ${result.zoneCode} (${result.sites} sites)`);
            }
        }
        catch (error)
        {
            failed.set(name, mtime);
            console.error(`[live] could not import ${name}:`, error instanceof Error ? error.message : error);
        }
    }
    return imported;
}

// Archives active sites older than archiveMinutes that no person has touched.
export async function ageSites(prisma: PrismaClient, settings: LiveSettings, now: Date = new Date()): Promise<number>
{
    const cutoff = new Date(now.getTime() - settings.archiveMinutes * 60_000);
    const candidates = await prisma.alert.findMany({
        where: {
            status: 'NEW',
            video: { liveChunkId: { not: null } },
            detectedAt: { lt: cutoff },
            events: { none: { type: { in: PERSON_EVENTS } } },
        },
        select: { id: true },
    });
    let archived = 0;
    for (const { id } of candidates)
    {
        const summary = await addSiteEvent(prisma, {
            alertId: id,
            type: 'archived',
            note: `Older than ${settings.archiveMinutes} min; removed from the live map. The log is kept.`,
            userId: null,
            author: 'Live feed',
            at: now,
            system: true,
            onlyIfUntouched: true,
        });
        if (summary)
        {
            archived += 1;
        }
    }
    return archived;
}

// Deletes media of all but the newest `keep` chunks; database rows stay.
export async function pruneMedia(prisma: PrismaClient, settings: LiveSettings): Promise<number>
{
    const stale = await prisma.liveChunk.findMany({
        where: { mediaPruned: false },
        orderBy: { sequence: 'desc' },
        skip: settings.keep,
        select: { id: true },
    });
    for (const { id } of stale)
    {
        // Flag first: a half-deleted folder must never be offered as a feed.
        await prisma.liveChunk.update({ where: { id }, data: { mediaPruned: true } });
        rmSync(join(settings.mediaRoot, 'live', id), { recursive: true, force: true });
    }
    if (stale.length)
    {
        publishChange('live-prune');
    }
    return stale.length;
}

const globalWatcher = globalThis as unknown as { __nesttraceLiveWatcher?: () => void };

export function startLiveWatcher(prisma: PrismaClient, settings: LiveSettings): () => void
{
    if (globalWatcher.__nesttraceLiveWatcher)
    {
        return globalWatcher.__nesttraceLiveWatcher;
    }
    let running = false;
    const tick = async () =>
    {
        if (running)
        {
            return;
        }
        running = true;
        try
        {
            await scanOnce(prisma, settings);
            await ageSites(prisma, settings);
            await pruneMedia(prisma, settings);
        }
        catch (error)
        {
            console.error('[live] watcher pass failed:', error instanceof Error ? error.message : error);
        }
        finally
        {
            running = false;
        }
    };
    const timer = setInterval(() => { void tick(); }, 3000);
    void tick();
    const stop = () =>
    {
        clearInterval(timer);
        globalWatcher.__nesttraceLiveWatcher = undefined;
    };
    globalWatcher.__nesttraceLiveWatcher = stop;
    console.log(`[live] watching ${settings.root}`);
    return stop;
}
