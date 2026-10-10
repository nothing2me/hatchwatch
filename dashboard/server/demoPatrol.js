// Optional demo patrol (NESTTRACE_DEMO_PATROL=1): answers new alerts the way
// a patrol would, so a live demo shows sites being visited and secured.
//
// It posts through the same store method real patrol members use, signs
// every entry "Demo patrol (simulated)", and only ever logs a visit and a
// precautionary protection setup. It never confirms or rules out a nest:
// that needs a person at the site, and the demo patrol has no access to
// the simulator's truth.

import { summarizeNestSite } from '../src/utils/nestStatus.js';

export const demoPatrolName = 'Demo patrol (simulated)';

export function startDemoPatrol(store, { visitDelaySeconds = [40, 120], protectDelaySeconds = [30, 75], random = Math.random, schedule = setTimeout, cancel = clearTimeout } = {})
{
    const timers = new Set();

    function delayMilliseconds([low, high])
    {
        return (low + random() * (high - low)) * 1000;
    }

    function later(milliseconds, action)
    {
        const timer = schedule(() =>
        {
            timers.delete(timer);
            action().catch((error) => console.error(`[demo patrol] ${error.message}`));
        }, milliseconds);
        timers.add(timer);
    }

    // Steps are skipped if a real patrol member already covered them.
    function respondTo(nestIdentifier)
    {
        later(delayMilliseconds(visitDelaySeconds), async () =>
        {
            const site = store.findSite(nestIdentifier);
            if (!site || summarizeNestSite(site).isArchived || summarizeNestSite(site).patrolVisited)
            {
                return;
            }
            await store.addPatrolEntry(nestIdentifier, { type: 'patrolVisit', author: demoPatrolName, note: 'Responded to camera alert; disturbed sand at the marked spot.' });

            later(delayMilliseconds(protectDelaySeconds), async () =>
            {
                const current = store.findSite(nestIdentifier);
                if (!current || summarizeNestSite(current).isArchived || summarizeNestSite(current).protectionStatus !== 'unprotected')
                {
                    return;
                }
                await store.addPatrolEntry(nestIdentifier, { type: 'protectionInstalled', author: demoPatrolName, note: 'Precautionary stakes and tape, 3 m perimeter. Nesting still unresolved.' });
            });
        });
    }

    function handleChange(change)
    {
        if (change.reason === 'chunk')
        {
            change.newSites.forEach((site) => respondTo(site.nestIdentifier));
        }
    }

    // Pick up unvisited sites left from before a restart.
    for (const site of store.state.sites)
    {
        const summary = summarizeNestSite(site);
        if (!summary.isArchived && !summary.patrolVisited)
        {
            respondTo(site.nestIdentifier);
        }
    }

    store.on('change', handleChange);

    return function stopDemoPatrol()
    {
        store.off('change', handleChange);
        timers.forEach((timer) => cancel(timer));
        timers.clear();
    };
}
