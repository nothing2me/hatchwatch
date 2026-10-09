// A "data source" is anything that can hand the dashboard snapshots of the
// beach. The dashboard only ever calls subscribe(), so we can swap the
// sample data for the pipeline adapter (or real cameras) without touching the UI.
//
// Contract every data source must follow:
//
//     const unsubscribe = dataSource.subscribe(onSnapshot);
//
//   - onSnapshot(snapshot) is called with the latest snapshot, right away
//     and again every time something changes.
//   - The returned unsubscribe() stops the updates.
//   - A snapshot has the shape shown in sampleData.js.

import { sampleSnapshot } from './sampleData.js';

// Builds a data source that delivers the fixed sample snapshot once.
export function createSampleDataSource()
{
    return {
        subscribe(onSnapshot)
        {
            // Deliver the snapshot immediately so the page has data on first render.
            onSnapshot(sampleSnapshot);

            // Nothing ever changes in the sample data, so unsubscribing has nothing to stop.
            return function unsubscribe()
            {
            };
        },
    };
}

// TODO (adapter): add createPipelineDataSource() following the same contract,
// then switch App.jsx to use it. Per agent.md it may read ONLY reviewed public
// pipeline outputs (predictions.json, public calibration, evidence videos,
// motion-map.png) through a small versioned schema. Never import from web/,
// call the local research API, or read anything under */private/.
// Alerts built from predictions must use the wording
// "Digging activity detected; nesting unresolved." and never claim a nest.
