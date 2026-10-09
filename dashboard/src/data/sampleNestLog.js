// Made-up nest sites and their logs, used until the pipeline adapter
// exists. The adapter must produce sites with this SAME shape.
//
// Each site has its own log ("events"). The cameras add "system" entries
// (arrived, left). Patrol members add "patrol" entries from the dashboard,
// and those are stored separately by the nest log store, never mixed into
// this file. Positions are pixels on the map image, like everything else.
//
// Times are UTC (ISO 8601). The dashboard shows them in beach time.

import { detectionAlertText } from '../config/nestEvents.js';

export const sampleNestSites =
[
    {
        nestIdentifier: 'NT-005',
        zoneIdentifier: 'B',
        position: { x: 512, y: 428 },
        locationDescription: 'Holiday Beach access, north side, about 10 m seaward of the dune line',
        seenByCameras: ['B1', 'B2'],
        events:
        [
            { eventIdentifier: 'NT-005-1', type: 'detected', time: '2026-10-09T17:48:00Z', source: 'system', author: 'Cameras B1 + B2', note: detectionAlertText },
        ],
    },
    {
        nestIdentifier: 'NT-004',
        zoneIdentifier: 'B',
        position: { x: 452, y: 482 },
        locationDescription: 'Holiday Beach access, south side, about 15 m seaward of the dune line',
        seenByCameras: ['B1', 'B2'],
        events:
        [
            { eventIdentifier: 'NT-004-1', type: 'detected', time: '2026-10-09T03:42:00Z', source: 'system', author: 'Cameras B1 + B2', note: detectionAlertText },
            { eventIdentifier: 'NT-004-2', type: 'departed', time: '2026-10-09T04:31:00Z', source: 'system', author: 'Cameras B1 + B2', note: 'Activity ended; no movement at the site.' },
        ],
    },
    {
        nestIdentifier: 'NT-003',
        zoneIdentifier: 'A',
        position: { x: 300, y: 690 },
        locationDescription: 'Sand Point access, mid-beach, near the north marker post',
        seenByCameras: ['A1'],
        events:
        [
            { eventIdentifier: 'NT-003-1', type: 'detected', time: '2026-10-09T02:15:00Z', source: 'system', author: 'Camera A1 (A2 offline)', note: detectionAlertText },
            { eventIdentifier: 'NT-003-2', type: 'departed', time: '2026-10-09T03:05:00Z', source: 'system', author: 'Camera A1 (A2 offline)', note: 'Activity ended; no movement at the site.' },
            { eventIdentifier: 'NT-003-3', type: 'patrolVisit', time: '2026-10-09T05:10:00Z', source: 'patrol', author: 'J. Alvarez', note: 'Tracks lead up from the water; body pit visible.' },
            { eventIdentifier: 'NT-003-4', type: 'nestConfirmed', time: '2026-10-09T05:20:00Z', source: 'patrol', author: 'J. Alvarez', note: 'Egg chamber located; marker flag placed. Protection still needed.' },
        ],
    },
    {
        nestIdentifier: 'NT-002',
        zoneIdentifier: 'C',
        position: { x: 602, y: 304 },
        locationDescription: 'Pelican Condos stretch, about 20 m south of the boardwalk',
        seenByCameras: ['C1', 'C2'],
        events:
        [
            { eventIdentifier: 'NT-002-1', type: 'detected', time: '2026-10-08T02:03:00Z', source: 'system', author: 'Cameras C1 + C2', note: detectionAlertText },
            { eventIdentifier: 'NT-002-2', type: 'departed', time: '2026-10-08T02:52:00Z', source: 'system', author: 'Cameras C1 + C2', note: 'Activity ended; no movement at the site.' },
            { eventIdentifier: 'NT-002-3', type: 'patrolVisit', time: '2026-10-08T13:10:00Z', source: 'patrol', author: 'J. Alvarez', note: 'Site found from camera position.' },
            { eventIdentifier: 'NT-002-4', type: 'nestConfirmed', time: '2026-10-08T13:25:00Z', source: 'patrol', author: 'J. Alvarez', note: 'Egg chamber found by probing.' },
            { eventIdentifier: 'NT-002-5', type: 'protectionInstalled', time: '2026-10-08T14:05:00Z', source: 'patrol', author: 'M. Reyes', note: 'Stakes and flagging tape, 3 m perimeter. Sign posted.' },
        ],
    },
    {
        nestIdentifier: 'NT-001',
        zoneIdentifier: 'D',
        position: { x: 758, y: 132 },
        locationDescription: 'Ocean View Drive, about 25 m north of the beach access',
        seenByCameras: ['D1', 'D2'],
        events:
        [
            { eventIdentifier: 'NT-001-1', type: 'detected', time: '2026-10-07T03:20:00Z', source: 'system', author: 'Cameras D1 + D2', note: detectionAlertText },
            { eventIdentifier: 'NT-001-2', type: 'departed', time: '2026-10-07T04:05:00Z', source: 'system', author: 'Cameras D1 + D2', note: 'Activity ended; no movement at the site.' },
            { eventIdentifier: 'NT-001-3', type: 'patrolVisit', time: '2026-10-07T12:30:00Z', source: 'patrol', author: 'M. Reyes', note: 'Crawl tracks only.' },
            { eventIdentifier: 'NT-001-4', type: 'noNestFound', time: '2026-10-07T12:40:00Z', source: 'patrol', author: 'M. Reyes', note: 'No egg chamber found; likely a false crawl.' },
        ],
    },
];
