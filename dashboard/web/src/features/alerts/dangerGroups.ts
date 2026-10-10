import type { AlertView } from '@/lib/types';
import { alertKey } from '@/features/map/playback';

/** Dangers in one zone and clip raised within this window of the first one read as one person passing. */
export const DANGER_GROUP_WINDOW_MS = 60_000;

export interface DangerGroup
{
    key: string;
    zoneCode: string;
    /** ISO time of the group's first danger. */
    at: string;
    dangers: AlertView[];
}

// One card per person passing: zone + clip + time within 60 s. Person ids are not used: the detector
// splits one walker into several tracks, and the id lives only in the log note.
export function groupDangers(dangers: AlertView[], windowMs = DANGER_GROUP_WINDOW_MS): DangerGroup[]
{
    const ordered = [...dangers].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.startT - b.startT || a.id.localeCompare(b.id));
    const open = new Map<string, DangerGroup>();
    const groups: DangerGroup[] = [];
    for (const danger of ordered)
    {
        const bucket = `${danger.zoneCode}|${alertKey(danger)}`;
        const current = open.get(bucket);
        if (current && Date.parse(danger.createdAt) - Date.parse(current.at) <= windowMs)
        {
            current.dangers.push(danger);
            continue;
        }
        const group = { key: `${bucket}|${danger.createdAt}`, zoneCode: danger.zoneCode, at: danger.createdAt, dangers: [danger] };
        open.set(bucket, group);
        groups.push(group);
    }
    for (const group of groups)
    {
        // Within a card, sites read in clip order (the order the person passed them).
        group.dangers.sort((a, b) => a.startT - b.startT);
    }
    return groups.reverse();
}

/** Plain names of the trail palette, in palette order, so a site can be named by the trail drawn to it. */
export const TRAIL_NAMES = ['blue', 'pink', 'green', 'violet', 'teal', 'yellow'] as const;

// Short name for a nest site: its trail colour when it has one (the map rings it in that colour),
// otherwise its camera; then when in the clip the turtle was there.
export function siteLabel(site: Pick<AlertView, 'zoneCode' | 'cameraCode' | 'startT' | 'kind' | 'colorIndex'>): string
{
    const who = site.colorIndex !== null ? `${TRAIL_NAMES[site.colorIndex % TRAIL_NAMES.length]} trail` : site.cameraCode;
    return `Zone ${site.zoneCode} · ${who} · ${site.kind === 'DIGGING' ? 'dug' : 'seen'} at ${site.startT.toFixed(1)} s`;
}
