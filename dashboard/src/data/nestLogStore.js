// The nest log store: hands the dashboard every nest site with its full
// log, and records new patrol entries.
//
// Contract (same pattern as dataSource.js):
//
//     const unsubscribe = nestLogStore.subscribe(onNestSites);
//     nestLogStore.addPatrolEntry(nestIdentifier, { type, author, note });
//
//   - onNestSites(nestSites) is called right away and after every change.
//   - Patrol entries are append-only: they are never edited or deleted,
//     so each site's log stays a true record of what happened.
//
// This version keeps patrol entries in the browser's localStorage, which
// is enough for the demo but is per-browser. A real backend store with the
// same two methods will replace it so every patrol sees the same log.

const storageKey = 'nesttrace.patrolEntries.v1';

// Reads saved patrol entries, keyed by nest identifier. Storage can be
// blocked (private windows, strict settings), so failures mean "none saved".
function readSavedPatrolEntries()
{
    try
    {
        const savedText = window.localStorage.getItem(storageKey);
        return savedText ? JSON.parse(savedText) : {};
    }
    catch
    {
        return {};
    }
}

function savePatrolEntries(patrolEntriesBySite)
{
    try
    {
        window.localStorage.setItem(storageKey, JSON.stringify(patrolEntriesBySite));
    }
    catch
    {
        // Storage is blocked: entries still show until the page reloads.
    }
}

// Builds a store that starts from the given sites (sample or adapter data)
// and layers this browser's patrol entries on top of each site's log.
export function createLocalNestLogStore(seedNestSites)
{
    let patrolEntriesBySite = readSavedPatrolEntries();
    const listeners = new Set();

    function buildNestSites()
    {
        return seedNestSites.map(function addPatrolEntries(nestSite)
        {
            const patrolEntries = patrolEntriesBySite[nestSite.nestIdentifier] ?? [];
            return { ...nestSite, events: [...nestSite.events, ...patrolEntries] };
        });
    }

    function notifyListeners()
    {
        const nestSites = buildNestSites();

        for (const listener of listeners)
        {
            listener(nestSites);
        }
    }

    return {
        subscribe(onNestSites)
        {
            listeners.add(onNestSites);
            onNestSites(buildNestSites());

            return function unsubscribe()
            {
                listeners.delete(onNestSites);
            };
        },

        addPatrolEntry(nestIdentifier, { type, author, note })
        {
            const newEntry =
            {
                eventIdentifier: `${nestIdentifier}-patrol-${Date.now()}`,
                type,
                time: new Date().toISOString(),
                source: 'patrol',
                author,
                note,
            };

            const existingEntries = patrolEntriesBySite[nestIdentifier] ?? [];
            patrolEntriesBySite = { ...patrolEntriesBySite, [nestIdentifier]: [...existingEntries, newEntry] };

            savePatrolEntries(patrolEntriesBySite);
            notifyListeners();
        },

        // Demo helper: forget every patrol entry made in this browser.
        clearPatrolEntries()
        {
            patrolEntriesBySite = {};
            savePatrolEntries(patrolEntriesBySite);
            notifyListeners();
        },
    };
}
