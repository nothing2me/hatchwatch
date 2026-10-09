// A "data source" is anything that can hand the dashboard snapshots of the
// beach. The UI only uses the methods below, so the sample data and the
// live backend (liveDataSource.js) are interchangeable.
//
// Contract every data source must follow:
//
//     dataSource.mode                          'sample' or 'live'
//     dataSource.subscribe(onSnapshot)         -> unsubscribe
//     dataSource.subscribeToAlerts(onAlert)    -> unsubscribe
//     dataSource.subscribeToConnection(onState)-> unsubscribe ('connecting' | 'connected' | 'disconnected')
//     dataSource.addPatrolEntry(id, entry)     -> Promise (rejects with a readable message)
//
//   - onSnapshot(snapshot) is called right away and after every change.
//   - A snapshot has the shape of sampleData.js plus nestSites (see sampleNestLog.js).

import { sampleSnapshot } from './sampleData.js';
import { sampleNestSites } from './sampleNestLog.js';
import { createLocalNestLogStore } from './nestLogStore.js';

function doNothing()
{
}

// Sample mode: the fixed sample beach, plus the made-up nest log with patrol
// entries kept in this browser's localStorage.
export function createSampleDataSource()
{
    const nestLogStore = createLocalNestLogStore(sampleNestSites);

    return {
        mode: 'sample',

        subscribe(onSnapshot)
        {
            return nestLogStore.subscribe(function combine(nestSites)
            {
                onSnapshot({ ...sampleSnapshot, nestSites });
            });
        },

        subscribeToAlerts()
        {
            return doNothing;
        },

        subscribeToConnection(onState)
        {
            onState('connected');
            return doNothing;
        },

        addPatrolEntry(nestIdentifier, entry)
        {
            nestLogStore.addPatrolEntry(nestIdentifier, entry);
            return Promise.resolve();
        },

        // Demo helper, sample mode only.
        clearPatrolEntries: nestLogStore.clearPatrolEntries,
    };
}
