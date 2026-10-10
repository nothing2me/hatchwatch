import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import type { PrismaClient } from '@/generated/prisma/client';
import { ALERT_MESSAGES, type LngLat } from '@/lib/types';
import { simPointToLngLat, zoneFrame } from './frame';
import { readRunPaths, storeRunPaths, type StoredSite } from './paths';
import { calibrationSchema, pinsFileSchema, timestampsSchema, type SimPin } from './schema';

export const SIM_IMPORT_SCHEMA = 'sim-import-v1';

export interface ImportResult
{
    runId: string;
    videoIds: [string, string];
    alertCount: number;
    trackCount: number;
    dangerCount: number;
}

const REQUIRED = ['camera-0.mp4', 'camera-1.mp4', 'view-0/pure-motion.mp4', 'view-1/pure-motion.mp4', 'calibration-0.json', 'calibration-1.json', 'timestamps.json', 'analysis.json'];
// source file in the run folder -> destination name in media/sim/<run>/
const COPIES: [string, string][] = [
    ['camera-0.mp4', 'camera-0.mp4'],
    ['camera-1.mp4', 'camera-1.mp4'],
    ['view-0/pure-motion.mp4', 'motion-0.mp4'],
    ['view-1/pure-motion.mp4', 'motion-1.mp4'],
];

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

export async function importSimRun({ runDir, pair, mediaRoot, prisma }: {
    runDir: string; pair: string; mediaRoot: string; prisma: PrismaClient;
}): Promise<ImportResult>
{
    const dir = resolve(runDir);
    if (dir.split(sep).includes('private'))
    {
        throw new Error(`Refusing to import from a private path: ${dir}`);
    }
    const missing = REQUIRED.filter(file => !existsSync(join(dir, file)));
    if (missing.length)
    {
        throw new Error(`Run is missing required public files: ${missing.join(', ')}`);
    }

    const runId = basename(dir);
    const calibration = calibrationSchema.parse(readJson(join(dir, 'calibration-0.json')));
    const timestamps = timestampsSchema.parse(readJson(join(dir, 'timestamps.json')));
    const pinsPath = join(dir, 'pins/predictions.json');
    const pins: SimPin[] = existsSync(pinsPath) ? pinsFileSchema.parse(readJson(pinsPath)).methods.pins : [];
    const paths = readRunPaths(dir);

    const step = timestamps[1] - timestamps[0];
    const fps = 1 / step;
    const durationS = timestamps[timestamps.length - 1] + step;

    const zone = await prisma.zone.findUniqueOrThrow({ where: { code: pair } });
    const cameras = await Promise.all([1, 2].map(n => prisma.camera.findUniqueOrThrow({ where: { code: `${pair}${n}` } })));
    const ring = (zone.outline as { coordinates: LngLat[][] }).coordinates[0];
    const frame = zoneFrame(ring);

    // Copy media and write the manifest only after every input validated.
    const target = join(mediaRoot, 'sim', runId);
    mkdirSync(target, { recursive: true });
    for (const [source, destination] of COPIES)
    {
        copyFileSync(join(dir, source), join(target, destination));
    }
    const manifestFiles = [...REQUIRED, ...(existsSync(pinsPath) ? ['pins/predictions.json'] : []), ...paths.files];
    writeFileSync(join(target, 'import-manifest.json'), JSON.stringify({
        schema: SIM_IMPORT_SCHEMA,
        runId,
        pair,
        importedAt: new Date().toISOString(),
        files: Object.fromEntries(manifestFiles.map(file => [file, sha256(join(dir, file))])),
    }, null, 2));

    const relative = (name: string) => `sim/${runId}/${name}`;

    return prisma.$transaction(async tx =>
    {
        // Replace this run anywhere, and any other simulated run previously imported onto this pair.
        const previous = { OR: [{ simRunId: runId }, { source: 'SIMULATION' as const, cameraId: { in: cameras.map(camera => camera.id) } }] };
        const old = await tx.video.findMany({ where: previous, select: { id: true } });
        const oldAlerts = { alert: { videoId: { in: old.map(video => video.id) } } };
        await tx.track.deleteMany({ where: { videoId: { in: old.map(video => video.id) } } });
        await tx.alertStatusChange.deleteMany({ where: oldAlerts });
        await tx.alertNote.deleteMany({ where: oldAlerts });
        // Danger alerts first: they point at the sites (cascade) and carry their own notes.
        await tx.alert.deleteMany({ where: { videoId: { in: old.map(video => video.id) }, kind: 'DANGER' } });
        await tx.alert.deleteMany({ where: { videoId: { in: old.map(video => video.id) } } });
        await tx.video.deleteMany({ where: previous });

        const videos = await Promise.all(cameras.map((camera, index) => tx.video.create({
            data: {
                cameraId: camera.id,
                source: 'SIMULATION',
                path: relative(`camera-${index}.mp4`),
                pureMotionPath: relative(`motion-${index}.mp4`),
                simRunId: runId,
                originalName: `${runId}/camera-${index}.mp4`,
                durationS,
                fps,
                width: calibration.width,
                height: calibration.height,
            },
        })));

        const importedAt = new Date();
        const sites: StoredSite[] = [];
        for (const simPin of pins)
        {
            const [lng, lat] = simPointToLngLat(frame, simPin.point);
            // A pin seen by one camera belongs to that camera; two-camera pins stay on <pair>1.
            const view = simPin.source_views.length === 1 ? simPin.source_views[0] : 0;
            const created = await tx.alert.create({
                data: {
                    videoId: videos[view].id,
                    cameraId: cameras[view].id,
                    zoneId: zone.id,
                    kind: 'DIGGING',
                    message: ALERT_MESSAGES.DIGGING,
                    score: simPin.score,
                    lng,
                    lat,
                    radiusM: 0.9,
                    startT: simPin.interval[0],
                    endT: simPin.interval[1],
                    evidenceTier: simPin.evidence_tier === 'two_camera' ? 'TWO_CAMERA' : 'SINGLE_CAMERA',
                    simulated: true,
                    detectedAt: importedAt,
                },
            });
            await tx.siteEvent.create({ data: { alertId: created.id, type: 'detected', author: 'Camera', userId: null, at: importedAt } });
            sites.push({ pinId: simPin.id, alertId: created.id, videoId: videos[view].id, cameraId: created.cameraId, position: [lng, lat], startT: simPin.interval[0] });
        }

        // A looping demo clip has no wall clock: its dangers are logged at import time, after the detections.
        const stored = await storeRunPaths(tx, { paths, pins, sites, frame, zoneId: zone.id, fallbackVideoId: videos[0].id, clock: () => importedAt });

        return { runId, videoIds: [videos[0].id, videos[1].id] as [string, string], alertCount: pins.length, trackCount: stored.tracks, dangerCount: stored.dangers };
    });
}
