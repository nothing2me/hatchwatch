import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import type { PrismaClient } from '@/generated/prisma/client';
import { publishChange } from '@/lib/changes';
import { simPointToLngLat, zoneFrame } from '@/lib/sim/frame';
import { readRunPaths, storeRunPaths, type StoredSite } from '@/lib/sim/paths';
import { calibrationSchema, pinsFileSchema, type SimPin } from '@/lib/sim/schema';
import { ALERT_MESSAGES, type LngLat } from '@/lib/types';
import { liveManifestSchema } from './manifest';

export const LIVE_MANIFEST_FILE = 'live-chunk.json';

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

// Imports one live-chunk.v1 folder. Returns null when the chunk is already imported.
export async function importLiveChunk(prisma: PrismaClient, { chunkDir, mediaRoot }: { chunkDir: string; mediaRoot: string }): Promise<{ chunkId: string; zoneCode: string; sites: number; tracks: number; dangers: number } | null>
{
    const dir = resolve(chunkDir);
    if (dir.split(sep).includes('private'))
    {
        throw new Error(`Refusing to import from a private path: ${dir}`);
    }
    const manifest = liveManifestSchema.parse(readJson(join(dir, LIVE_MANIFEST_FILE)));
    if (manifest.chunk_id !== basename(dir))
    {
        throw new Error(`Chunk id ${manifest.chunk_id} does not match its folder ${basename(dir)}`);
    }
    if (await prisma.liveChunk.findUnique({ where: { id: manifest.chunk_id }, select: { id: true } }))
    {
        return null;
    }

    const files = [...manifest.cameras.flatMap(camera => [camera.video, camera.calibration]), manifest.pins];
    const missing = files.filter(file => !existsSync(join(dir, file)));
    if (missing.length)
    {
        throw new Error(`Chunk ${manifest.chunk_id} is missing: ${missing.join(', ')}`);
    }
    const calibrations = manifest.cameras.map(camera => calibrationSchema.parse(readJson(join(dir, camera.calibration))));
    const pins: SimPin[] = pinsFileSchema.parse(readJson(join(dir, manifest.pins))).methods.pins;
    // Optional trails and people, written by the runner before the manifest.
    const paths = readRunPaths(dir);

    const zones = await prisma.zone.findMany({ orderBy: { code: 'asc' } });
    if (zones.length === 0)
    {
        throw new Error('No zones to place the live chunk on');
    }
    const zone = zones[manifest.sequence % zones.length];
    const dashboardCameras = await prisma.camera.findMany({ where: { code: { in: [`${zone.code}1`, `${zone.code}2`] } } });
    // The manifest camera at x_min sits at the <zone>1 end, x_max at <zone>2.
    const cameraFor = (end: 'x_min' | 'x_max') =>
    {
        const found = dashboardCameras.find(camera => camera.code === `${zone.code}${end === 'x_min' ? 1 : 2}`);
        if (!found)
        {
            throw new Error(`Zone ${zone.code} has no camera for ${end}`);
        }
        return found;
    };
    const cameraByIndex = manifest.cameras.map(camera => cameraFor(camera.end));
    const ring = (zone.outline as { coordinates: LngLat[][] }).coordinates[0];
    const frame = zoneFrame(ring);

    const startedAt = new Date(manifest.recording_started_at);
    const relative = (name: string) => `live/${manifest.chunk_id}/${name}`;
    const target = join(mediaRoot, 'live', manifest.chunk_id);
    // Stage next to the final folder and rename only after the commit, so a failed or racing import never touches committed media.
    const staging = join(mediaRoot, 'live', `.${manifest.chunk_id}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`);
    mkdirSync(staging, { recursive: true });
    try
    {
        for (const camera of manifest.cameras)
        {
            copyFileSync(join(dir, camera.video), join(staging, camera.video));
        }
        const result = await prisma.$transaction(async tx =>
        {
            await tx.liveChunk.create({ data: { id: manifest.chunk_id, sequence: manifest.sequence, zoneId: zone.id, startedAt } });
            const videos = await Promise.all(manifest.cameras.map((camera, index) => tx.video.create({
                data: {
                    cameraId: cameraByIndex[index].id,
                    source: 'SIMULATION',
                    path: relative(camera.video),
                    pureMotionPath: null,
                    simRunId: manifest.chunk_id,
                    originalName: `${manifest.chunk_id}/${camera.video}`,
                    durationS: manifest.clip_seconds,
                    fps: manifest.fps,
                    width: calibrations[index].width,
                    height: calibrations[index].height,
                    liveChunkId: manifest.chunk_id,
                },
            })));
            const sites: StoredSite[] = [];
            for (const pin of pins)
            {
                // One camera saw it: that camera owns it. Two cameras: the x_min (<zone>1) camera.
                const view = pin.source_views.length === 1
                    ? manifest.cameras.findIndex(camera => camera.index === pin.source_views[0])
                    : manifest.cameras.findIndex(camera => camera.end === 'x_min');
                if (view < 0)
                {
                    throw new Error(`Pin ${pin.id} names a camera the manifest does not list`);
                }
                const [lng, lat] = simPointToLngLat(frame, pin.point);
                const detectedAt = new Date(startedAt.getTime() + pin.interval[0] * 1000);
                const alert = await tx.alert.create({
                    data: {
                        videoId: videos[view].id,
                        cameraId: cameraByIndex[view].id,
                        zoneId: zone.id,
                        kind: 'DIGGING',
                        message: ALERT_MESSAGES.DIGGING,
                        score: pin.score,
                        lng,
                        lat,
                        radiusM: 0.9,
                        startT: pin.interval[0],
                        endT: pin.interval[1],
                        evidenceTier: pin.evidence_tier === 'two_camera' ? 'TWO_CAMERA' : 'SINGLE_CAMERA',
                        simulated: true,
                        detectedAt,
                    },
                });
                await tx.siteEvent.createMany({
                    data: [
                        { alertId: alert.id, type: 'detected', author: 'Camera', userId: null, at: detectedAt },
                        { alertId: alert.id, type: 'departed', author: 'Camera', userId: null, at: new Date(startedAt.getTime() + pin.interval[1] * 1000) },
                    ],
                });
                sites.push({ pinId: pin.id, alertId: alert.id, videoId: videos[view].id, cameraId: alert.cameraId, position: [lng, lat], startT: pin.interval[0] });
            }
            const xMin = manifest.cameras.findIndex(camera => camera.end === 'x_min');
            const stored = await storeRunPaths(tx, {
                paths, pins, sites, frame, zoneId: zone.id, fallbackVideoId: videos[xMin].id,
                clock: t => new Date(startedAt.getTime() + t * 1000),
            });
            return { chunkId: manifest.chunk_id, zoneCode: zone.code, sites: pins.length, tracks: stored.tracks, dangers: stored.dangers };
        });
        renameSync(staging, target);
        publishChange('live-chunk');
        return result;
    }
    catch (error)
    {
        rmSync(staging, { recursive: true, force: true });
        // Another watcher committed this chunk first: not an error, and its media stays untouched.
        if ((error as { code?: string }).code === 'P2002' || await prisma.liveChunk.findUnique({ where: { id: manifest.chunk_id }, select: { id: true } }))
        {
            return null;
        }
        throw error;
    }
}
