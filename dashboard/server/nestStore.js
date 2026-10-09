// The dashboard backend's own record of nest sites, their logs, and the
// latest camera footage per pair. Lives in the dashboard's data folder,
// separate from the simulator's artifacts (agent.md: separate storage).
//
// - state.json holds the current state and is replaced atomically.
// - audit.jsonl gets one line per log entry and is only ever appended to.
// - Log entries are never edited or removed; a site leaving the live map is
//   itself a logged "archived" entry.

import { EventEmitter } from 'node:events';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nestEventTypes } from '../src/config/nestEvents.js';
import { summarizeNestSite } from '../src/utils/nestStatus.js';

const maximumAuthorLength = 60;
const maximumNoteLength = 500;
const archivedSitesInSnapshot = 100;

function emptyState()
{
    return { version: 1, nextSiteNumber: 1, processedChunks: {}, feeds: {}, sites: [] };
}

export class NestStore extends EventEmitter
{
    constructor({ dataDirectory, zones, cameraPairs, settings, now = () => new Date() })
    {
        super();
        this.dataDirectory = dataDirectory;
        this.zones = zones;
        this.cameraPairs = cameraPairs;
        this.settings = settings;
        this.now = now;
        this.state = emptyState();
        this.pendingWrite = Promise.resolve();
        this.eventCounter = 0;
    }

    async load()
    {
        await mkdir(this.dataDirectory, { recursive: true });
        try
        {
            const saved = JSON.parse(await readFile(join(this.dataDirectory, 'state.json'), 'utf8'));
            if (saved.version === 1)
            {
                this.state = saved;
            }
        }
        catch (error)
        {
            if (error.code !== 'ENOENT')
            {
                throw new Error(`Could not read ${join(this.dataDirectory, 'state.json')}: ${error.message}`);
            }
        }
    }

    // Writes are queued so they never overlap, and each one replaces the file atomically.
    save()
    {
        const text = JSON.stringify(this.state);
        this.pendingWrite = this.pendingWrite.then(async () =>
        {
            const temporary = join(this.dataDirectory, 'state.json.tmp');
            await writeFile(temporary, text);
            await rename(temporary, join(this.dataDirectory, 'state.json'));
        });
        return this.pendingWrite;
    }

    async audit(entries)
    {
        if (entries.length === 0)
        {
            return;
        }
        const lines = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
        await appendFile(join(this.dataDirectory, 'audit.jsonl'), lines);
    }

    processedChunkIdentifiers()
    {
        return new Set(Object.keys(this.state.processedChunks));
    }

    hasChunk(chunkId)
    {
        return Object.hasOwn(this.state.processedChunks, chunkId);
    }

    nextEventIdentifier(nestIdentifier)
    {
        this.eventCounter += 1;
        return `${nestIdentifier}-${Date.now().toString(36)}-${this.eventCounter}`;
    }

    findSite(nestIdentifier)
    {
        return this.state.sites.find((site) => site.nestIdentifier === nestIdentifier) ?? null;
    }

    // Adds a converted chunk (see liveChunkAdapter.convertChunk). Safe to call
    // twice with the same chunk: the second call changes nothing.
    async ingestChunk(manifest, converted)
    {
        if (this.hasChunk(manifest.chunk_id))
        {
            return [];
        }

        const newSites = converted.sites.map((site) =>
        {
            const nestIdentifier = `NT-${String(this.state.nextSiteNumber).padStart(4, '0')}`;
            this.state.nextSiteNumber += 1;
            return {
                nestIdentifier,
                ...site,
                events: site.events.map((event) => ({ eventIdentifier: this.nextEventIdentifier(nestIdentifier), ...event })),
            };
        });

        this.state.sites.push(...newSites);
        this.state.feeds[converted.feed.pairIdentifier] = converted.feed;
        this.state.processedChunks[manifest.chunk_id] =
        {
            sequence: manifest.sequence,
            zoneIdentifier: newSites[0]?.zoneIdentifier ?? converted.feed.pairIdentifier,
            publishedAt: manifest.published_at,
            siteIdentifiers: newSites.map((site) => site.nestIdentifier),
        };

        await this.save();
        await this.audit(newSites.flatMap((site) => site.events.map((event) => ({ nestIdentifier: site.nestIdentifier, ...event }))));
        this.emit('change', { reason: 'chunk', chunkId: manifest.chunk_id, newSites });
        return newSites;
    }

    // Validates and appends one patrol entry. Throws an Error with a
    // statusCode so the HTTP layer can answer 400 / 404.
    async addPatrolEntry(nestIdentifier, { type, author, note })
    {
        const site = this.findSite(nestIdentifier);
        if (!site)
        {
            throw Object.assign(new Error(`No nest site ${nestIdentifier}`), { statusCode: 404 });
        }

        const eventType = nestEventTypes[type];
        if (!eventType || eventType.source !== 'patrol')
        {
            throw Object.assign(new Error('Unknown patrol action'), { statusCode: 400 });
        }

        const trimmedAuthor = typeof author === 'string' ? author.trim() : '';
        const trimmedNote = typeof note === 'string' ? note.trim() : '';
        if (trimmedAuthor === '' || trimmedAuthor.length > maximumAuthorLength)
        {
            throw Object.assign(new Error(`Name must be 1 to ${maximumAuthorLength} characters`), { statusCode: 400 });
        }
        if (trimmedNote.length > maximumNoteLength || (type === 'note' && trimmedNote === ''))
        {
            throw Object.assign(new Error(`Note must be ${type === 'note' ? '1' : '0'} to ${maximumNoteLength} characters`), { statusCode: 400 });
        }

        const entry =
        {
            eventIdentifier: this.nextEventIdentifier(nestIdentifier),
            type,
            time: this.now().toISOString(),
            source: 'patrol',
            author: trimmedAuthor,
            note: trimmedNote,
        };
        site.events.push(entry);

        await this.save();
        await this.audit([{ nestIdentifier, ...entry }]);
        this.emit('change', { reason: 'patrol', nestIdentifier, entry });
        return site;
    }

    ageMinutes(site)
    {
        const summary = summarizeNestSite(site);
        return (this.now().getTime() - Date.parse(summary.arrivedAt)) / 60000;
    }

    // Archives sites older than the archive age, logging why. Returns them.
    async sweep()
    {
        const archived = [];
        for (const site of this.state.sites)
        {
            if (!summarizeNestSite(site).isArchived && this.ageMinutes(site) >= this.settings.archiveAfterMinutes)
            {
                const entry =
                {
                    eventIdentifier: this.nextEventIdentifier(site.nestIdentifier),
                    type: 'archived',
                    time: this.now().toISOString(),
                    source: 'system',
                    author: 'Dashboard',
                    note: `Older than ${this.settings.archiveAfterMinutes} min; removed from the live map. The log is kept.`,
                };
                site.events.push(entry);
                archived.push({ site, entry });
            }
        }

        if (archived.length > 0)
        {
            await this.save();
            await this.audit(archived.map(({ site, entry }) => ({ nestIdentifier: site.nestIdentifier, ...entry })));
            this.emit('change', { reason: 'archive', nestIdentifiers: archived.map(({ site }) => site.nestIdentifier) });
        }
        return archived.map(({ site }) => site);
    }

    // 1 while fresh, fading to 0.25 by the archive age; 0 once archived.
    visibility(site)
    {
        if (summarizeNestSite(site).isArchived)
        {
            return 0;
        }
        const { fadeStartMinutes, archiveAfterMinutes } = this.settings;
        const age = this.ageMinutes(site);
        if (age <= fadeStartMinutes)
        {
            return 1;
        }
        const fraction = Math.min(1, (age - fadeStartMinutes) / Math.max(0.001, archiveAfterMinutes - fadeStartMinutes));
        return Math.round((1 - 0.75 * fraction) * 100) / 100;
    }

    // High: a site arrived in the zone within the recent window.
    // Medium: the zone still has sites on the live map. Low: none.
    activityLevel(zoneIdentifier)
    {
        const active = this.state.sites.filter((site) => site.zoneIdentifier === zoneIdentifier && !summarizeNestSite(site).isArchived);
        if (active.some((site) => this.ageMinutes(site) <= this.settings.recentActivityMinutes))
        {
            return 'high';
        }
        return active.length > 0 ? 'medium' : 'low';
    }

    snapshot()
    {
        const nowTime = this.now().getTime();
        const staleMilliseconds = this.settings.cameraStaleMinutes * 60000;

        const cameraPairs = this.cameraPairs.map((cameraPair) =>
        {
            const feed = this.state.feeds[cameraPair.pairIdentifier] ?? null;
            const isFresh = feed !== null && nowTime - Date.parse(feed.publishedAt) <= staleMilliseconds;
            return {
                ...cameraPair,
                feed,
                cameras: cameraPair.cameras.map((camera) =>
                {
                    const footage = feed?.cameras.find((entry) => entry.cameraIdentifier === camera.cameraIdentifier);
                    return {
                        ...camera,
                        status: isFresh ? 'online' : 'offline',
                        lastFrameTime: feed ? feed.lastFrameTime : null,
                        videoUrl: footage ? footage.videoUrl : null,
                    };
                }),
            };
        });

        const withVisibility = this.state.sites.map((site) => ({ ...site, visibility: this.visibility(site) }));
        const active = withVisibility.filter((site) => site.visibility > 0);
        const archived = withVisibility.filter((site) => site.visibility === 0).slice(-archivedSitesInSnapshot);
        const nestSites = [...active, ...archived].sort((first, second) =>
            Date.parse(summarizeNestSite(second).arrivedAt) - Date.parse(summarizeNestSite(first).arrivedAt));

        const chunkEntries = Object.entries(this.state.processedChunks).sort((first, second) => second[1].sequence - first[1].sequence);

        return {
            mode: 'live',
            generatedAt: this.now().toISOString(),
            settings:
            {
                fadeStartMinutes: this.settings.fadeStartMinutes,
                archiveAfterMinutes: this.settings.archiveAfterMinutes,
            },
            feed:
            {
                chunksProcessed: chunkEntries.length,
                lastChunkId: chunkEntries[0]?.[0] ?? null,
                lastChunkPublishedAt: chunkEntries[0]?.[1].publishedAt ?? null,
            },
            zones: this.zones.map((zone) => ({ ...zone, activityLevel: this.activityLevel(zone.zoneIdentifier) })),
            cameraPairs,
            nestSites,
        };
    }
}
