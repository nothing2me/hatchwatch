import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Prisma } from '@/generated/prisma/client';
import { DANGER_MESSAGE, DANGER_RADIUS_M, findDangers, limitDangersPerSite } from '@/lib/danger';
import type { LngLat } from '@/lib/types';
import { simPointToLngLat, type ZoneFrame } from './frame';
import { peopleFileSchema, tracksFileSchema, type SimPerson, type SimPin, type SimTrack } from './schema';

export const TRACKS_FILE = 'tracks/tracks.json';
export const PEOPLE_FILE = 'people/people.json';
/** Trail palette size on the dashboard; colour indexes wrap in pin order. */
export const TRAIL_COLORS = 6;

export interface RunPaths { tracks: SimTrack[]; people: SimPerson[]; files: string[] }

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

// Reads and validates the optional public trail and people files of a run or chunk folder.
export function readRunPaths(dir: string): RunPaths
{
    const files: string[] = [];
    let tracks: SimTrack[] = [];
    let people: SimPerson[] = [];
    if (existsSync(join(dir, TRACKS_FILE)))
    {
        tracks = tracksFileSchema.parse(readJson(join(dir, TRACKS_FILE))).tracks;
        files.push(TRACKS_FILE);
    }
    if (existsSync(join(dir, PEOPLE_FILE)))
    {
        people = peopleFileSchema.parse(readJson(join(dir, PEOPLE_FILE))).people;
        files.push(PEOPLE_FILE);
    }
    return { tracks, people, files };
}

export interface StoredSite { pinId: string; alertId: string; videoId: string; cameraId: string; position: LngLat; startT: number }

/**
 * Stores trails as Track rows (matched to the site of their pin, colour = pin order) and raises one level-1
 * DANGER alert per person approach (at most one per site per minute), each logged on its site as `danger`.
 * Runs inside the importer's transaction, on sites that transaction just created.
 */
export async function storeRunPaths(tx: Prisma.TransactionClient, { paths, pins, sites, frame, zoneId, fallbackVideoId, clock }: {
    paths: RunPaths;
    pins: SimPin[];
    sites: StoredSite[];
    frame: ZoneFrame;
    zoneId: string;
    fallbackVideoId: string;
    clock: (t: number) => Date;
}): Promise<{ tracks: number; dangers: number }>
{
    const siteByPin = new Map(sites.map(site => [site.pinId, site]));
    const pinOrder = new Map(pins.map((pin, index) => [pin.id, index]));
    const toPoints = (points: [number, number, number][]) => points.map(([t, x, y]) => ({ t, position: simPointToLngLat(frame, [x, y]) }));

    for (const track of paths.tracks)
    {
        const site = track.pin_id === null ? undefined : siteByPin.get(track.pin_id);
        const points = toPoints(track.points);
        await tx.track.create({
            data: {
                videoId: site?.videoId ?? fallbackVideoId,
                alertId: site?.alertId ?? null,
                colorIndex: site ? (pinOrder.get(site.pinId) ?? 0) % TRAIL_COLORS : null,
                points: points.map(point => ({ t: point.t, lng: point.position[0], lat: point.position[1] })),
                startT: points[0].t,
                endT: points[points.length - 1].t,
                geoReferenced: true,
                label: track.id,
            },
        });
    }

    const people = paths.people.map(person => ({ id: person.id, points: toPoints(person.points) }));
    const dangers = limitDangersPerSite(findDangers(sites.map(site => ({ alertId: site.alertId, position: site.position, startT: site.startT })), people));
    const siteById = new Map(sites.map(site => [site.alertId, site]));
    for (const danger of dangers)
    {
        const site = siteById.get(danger.alertId)!;
        const at = clock(danger.at);
        const mmss = `${String(Math.floor(danger.closestT / 60)).padStart(2, '0')}:${String(Math.floor(danger.closestT % 60)).padStart(2, '0')}`;
        const note = `Person within ${DANGER_RADIUS_M} m of the site at ${mmss} (${danger.personId}).`;
        const alert = await tx.alert.create({
            data: {
                videoId: site.videoId,
                cameraId: site.cameraId,
                zoneId,
                kind: 'DANGER',
                message: DANGER_MESSAGE,
                level: 1,
                siteId: site.alertId,
                lng: danger.position[0],
                lat: danger.position[1],
                radiusM: DANGER_RADIUS_M,
                startT: danger.startT,
                endT: danger.endT,
                simulated: true,
                detectedAt: at,
            },
        });
        await tx.siteEvent.createMany({
            data: [
                { alertId: alert.id, type: 'danger', author: 'Camera', userId: null, note, at },
                { alertId: site.alertId, type: 'danger', author: 'Camera', userId: null, note, at },
            ],
        });
    }
    return { tracks: paths.tracks.length, dangers: dangers.length };
}
