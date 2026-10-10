import 'dotenv/config';
import { Prisma } from '../src/generated/prisma/client';
import { createPrismaClient } from '../src/lib/db';
import { bearingBetween, destinationPoint } from '../src/lib/geo';
import { recordingOffsetM } from '../src/lib/sim/frame';
import type { LngLat } from '../src/lib/types';

// One-time, idempotent migration of already imported demonstration recordings.
// A null offset means their map geometry was stored at the centre of the zone.
const prisma = createPrismaClient();

async function main()
{
    const zoneCount = await prisma.zone.count();
    const chunks = await prisma.liveChunk.findMany({
        where: { placementOffsetM: null },
        include: { zone: { select: { outline: true } }, videos: { select: { id: true } } },
        orderBy: { sequence: 'asc' },
    });
    let alertsMoved = 0;
    let tracksMoved = 0;
    for (const chunk of chunks)
    {
        const ring = (chunk.zone.outline as { coordinates: LngLat[][] }).coordinates[0];
        const bounds = chunk.groundBounds;
        const widthM = Array.isArray(bounds) && typeof bounds[0] === 'number' && typeof bounds[1] === 'number' ? bounds[1] - bounds[0] : 24;
        const offsetM = recordingOffsetM(ring, chunk.sequence, zoneCount, widthM);
        const alongBearing = bearingBetween(ring[0], ring[1]);
        const shift = ([lng, lat]: LngLat): LngLat => offsetM === 0 ? [lng, lat] : destinationPoint([lng, lat], offsetM > 0 ? alongBearing : alongBearing + 180, Math.abs(offsetM));
        const videoIds = chunk.videos.map(video => video.id);
        const [alerts, tracks] = await Promise.all([
            prisma.alert.findMany({ where: { videoId: { in: videoIds }, lng: { not: null }, lat: { not: null } }, select: { id: true, lng: true, lat: true } }),
            prisma.track.findMany({ where: { videoId: { in: videoIds } }, select: { id: true, points: true } }),
        ]);
        await prisma.$transaction(async tx =>
        {
            for (const alert of alerts)
            {
                const [lng, lat] = shift([alert.lng!, alert.lat!]);
                await tx.alert.update({ where: { id: alert.id }, data: { lng, lat } });
            }
            for (const track of tracks)
            {
                if (!Array.isArray(track.points)) continue;
                const points = track.points.map(point =>
                {
                    if (!point || typeof point !== 'object' || Array.isArray(point)) return point;
                    const entry = point as Record<string, unknown>;
                    if (typeof entry.lng !== 'number' || typeof entry.lat !== 'number') return point;
                    const [lng, lat] = shift([entry.lng, entry.lat]);
                    return { ...entry, lng, lat };
                });
                await tx.track.update({ where: { id: track.id }, data: { points: points as Prisma.InputJsonValue } });
            }
            await tx.liveChunk.update({ where: { id: chunk.id }, data: { placementOffsetM: offsetM } });
        }, { timeout: 120_000 });
        alertsMoved += alerts.length;
        tracksMoved += tracks.length;
    }
    console.log(`Placed ${chunks.length} recordings; moved ${alertsMoved} alert positions and ${tracksMoved} trails.`);
}

main().finally(() => prisma.$disconnect());
