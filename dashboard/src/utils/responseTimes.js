// How fast patrols respond to alerts, worked out from each site's log.
// Shared by the Nest log page and the tests.
//
// Clock starts when the alert reached the dashboard (alertRaisedAt), not
// when the turtle arrived: the patrol can't act before the alert exists.

import { nestEventTypes } from '../config/nestEvents.js';
import { sortEventsOldestFirst } from './nestStatus.js';

const demoPatrolMarker = '(simulated)';

// One site's response: when the alert was raised, the first patrol update
// from the site, and when protection went up.
export function responseFor(nestSite)
{
    const events = sortEventsOldestFirst(nestSite.events);
    const alertEvent = events.find(function isAlert(event)
    {
        return event.type === 'alertRaised';
    });
    const alertRaisedAt = nestSite.alertRaisedAt ?? alertEvent?.time ?? null;

    const firstPatrol = events.find(function isPatrolOnSite(event)
    {
        return nestEventTypes[event.type]?.meansPatrolOnSite;
    }) ?? null;
    const protection = events.find(function isProtection(event)
    {
        return event.type === 'protectionInstalled';
    }) ?? null;
    const noNest = events.some(function isNoNest(event)
    {
        return event.type === 'noNestFound';
    });

    function millisecondsSinceAlert(event)
    {
        return event && alertRaisedAt ? Math.max(0, Date.parse(event.time) - Date.parse(alertRaisedAt)) : null;
    }

    return {
        nestIdentifier: nestSite.nestIdentifier,
        zoneIdentifier: nestSite.zoneIdentifier,
        alertRaisedAt,
        firstPatrol,
        protection,
        noNest,
        millisecondsToFirstPatrol: millisecondsSinceAlert(firstPatrol),
        millisecondsToProtect: millisecondsSinceAlert(protection),
        protectedBySimulatedPatrol: protection ? protection.author.includes(demoPatrolMarker) : false,
    };
}

function average(values)
{
    return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values)
{
    if (values.length === 0)
    {
        return null;
    }
    const sorted = [...values].sort((first, second) => first - second);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Totals across sites. "Waiting" sites have an alert but no protection yet
// (and weren't ruled out as no-nest): their wait is still growing, so they
// are reported separately rather than mixed into the averages.
export function summarizeResponses(nestSites, now = new Date(), worstCount = 5)
{
    const responses = nestSites.map(responseFor).filter(function hasAlert(response)
    {
        return response.alertRaisedAt !== null;
    });

    const protectedResponses = responses.filter(function wasProtected(response)
    {
        return response.millisecondsToProtect !== null;
    });
    const protectTimes = protectedResponses.map((response) => response.millisecondsToProtect);
    const visitTimes = responses
        .filter((response) => response.millisecondsToFirstPatrol !== null)
        .map((response) => response.millisecondsToFirstPatrol);

    const waiting = responses
        .filter((response) => response.protection === null && !response.noNest)
        .map((response) => ({ ...response, millisecondsWaiting: Math.max(0, now.getTime() - Date.parse(response.alertRaisedAt)) }))
        .sort((first, second) => second.millisecondsWaiting - first.millisecondsWaiting);

    return {
        responses,
        protectedCount: protectedResponses.length,
        averageMillisecondsToProtect: average(protectTimes),
        medianMillisecondsToProtect: median(protectTimes),
        worstMillisecondsToProtect: protectTimes.length > 0 ? Math.max(...protectTimes) : null,
        averageMillisecondsToFirstPatrol: average(visitTimes),
        worstProtected: [...protectedResponses]
            .sort((first, second) => second.millisecondsToProtect - first.millisecondsToProtect)
            .slice(0, worstCount),
        simulatedShare: protectedResponses.length === 0 ? 0 : protectedResponses.filter((response) => response.protectedBySimulatedPatrol).length / protectedResponses.length,
        waiting,
    };
}

// "45 s", "3 min 05 s", "1 h 12 min" for response times.
export function formatElapsed(milliseconds)
{
    if (milliseconds === null || milliseconds === undefined)
    {
        return '—';
    }
    const totalSeconds = Math.round(milliseconds / 1000);
    if (totalSeconds < 60)
    {
        return `${totalSeconds} s`;
    }
    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes < 60)
    {
        return `${totalMinutes} min ${String(totalSeconds % 60).padStart(2, '0')} s`;
    }
    const hours = Math.floor(totalMinutes / 60);
    return `${hours} h ${totalMinutes % 60} min`;
}
