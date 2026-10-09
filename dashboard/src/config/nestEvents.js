// The kinds of entries a nest site's log can hold.
//
// "system" entries come from the cameras (through the data source).
// "patrol" entries are added by patrol members from the dashboard.
// meansPatrolOnSite marks the patrol entries that can only be logged by
// someone standing at the site, so they count as a patrol visit.

export const nestEventTypes =
{
    detected:
    {
        label: 'Arrived',
        source: 'system',
        meansPatrolOnSite: false,
    },
    departed:
    {
        label: 'Left',
        source: 'system',
        meansPatrolOnSite: false,
    },
    patrolVisit:
    {
        label: 'Patrol visited',
        source: 'patrol',
        meansPatrolOnSite: true,
    },
    nestConfirmed:
    {
        label: 'Nest confirmed',
        source: 'patrol',
        meansPatrolOnSite: true,
    },
    noNestFound:
    {
        label: 'No nest found',
        source: 'patrol',
        meansPatrolOnSite: true,
    },
    protectionInstalled:
    {
        label: 'Protection set up',
        source: 'patrol',
        meansPatrolOnSite: true,
    },
    note:
    {
        label: 'Note',
        source: 'patrol',
        meansPatrolOnSite: false,
    },
};

// The actions a patrol can pick in the update form, in the order shown.
export const patrolActionOrder =
[
    'patrolVisit',
    'nestConfirmed',
    'noNestFound',
    'protectionInstalled',
    'note',
];

// Wording for camera detections. agent.md requires this exact sentence:
// an automated alert never confirms a nest; only a patrol can.
export const detectionAlertText = 'Digging activity detected; nesting unresolved.';
