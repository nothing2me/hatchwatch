// Works out a nest site's current state by reading its log from oldest to
// newest. Nothing about a site's status is stored on its own: every flag
// below comes from a log entry, so the log always explains the status.

import { nestEventTypes } from '../config/nestEvents.js';

// Returns a copy of the events sorted from oldest to newest.
export function sortEventsOldestFirst(events)
{
    return [...events].sort(function compareTimes(firstEvent, secondEvent)
    {
        return Date.parse(firstEvent.time) - Date.parse(secondEvent.time);
    });
}

// Summarizes one nest site for the UI.
export function summarizeNestSite(nestSite)
{
    const events = sortEventsOldestFirst(nestSite.events);

    let arrivedAt = null;
    let departedAt = null;
    let lastPatrolVisitAt = null;
    let nestingStatus = 'unresolved';
    let hasProtection = false;

    // Later entries win, so a patrol can correct an earlier finding.
    for (const event of events)
    {
        const eventType = nestEventTypes[event.type];

        if (event.type === 'detected' && arrivedAt === null)
        {
            arrivedAt = event.time;
        }
        else if (event.type === 'departed')
        {
            departedAt = event.time;
        }
        else if (event.type === 'nestConfirmed')
        {
            nestingStatus = 'confirmed';
        }
        else if (event.type === 'noNestFound')
        {
            nestingStatus = 'noNest';
        }
        else if (event.type === 'protectionInstalled')
        {
            hasProtection = true;
        }

        if (eventType && eventType.meansPatrolOnSite)
        {
            lastPatrolVisitAt = event.time;
        }
    }

    // Unprotected is the automatic starting flag. Only a logged protection
    // setup clears it, or a patrol finding that there is no nest to protect.
    let protectionStatus = 'unprotected';

    if (hasProtection)
    {
        protectionStatus = 'protected';
    }
    else if (nestingStatus === 'noNest')
    {
        protectionStatus = 'notNeeded';
    }

    return {
        events,
        arrivedAt,
        departedAt,
        isOnSite: arrivedAt !== null && departedAt === null,
        lastPatrolVisitAt,
        patrolVisited: lastPatrolVisitAt !== null,
        nestingStatus,
        protectionStatus,
        lastUpdatedAt: events.length > 0 ? events[events.length - 1].time : null,
    };
}

// Counts the sites that still need protection set up.
export function countUnprotectedSites(nestSites)
{
    return nestSites.filter(function isUnprotected(nestSite)
    {
        return summarizeNestSite(nestSite).protectionStatus === 'unprotected';
    }).length;
}
