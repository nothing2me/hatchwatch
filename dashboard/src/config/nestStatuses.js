// How each nest site status is labeled and colored.
//
// Statuses are never stored directly. They are worked out from the site's
// log (see utils/nestStatus.js), so the log is the one source of truth and
// every change has a who and a when.

// Whether the site is physically protected. Every new site starts out
// "unprotected" automatically, until a patrol logs that protection is up.
export const protectionStatuses =
{
    unprotected:
    {
        label: 'Unprotected',
        tone: 'bad',
        pinFill: '#B42318',
    },
    protected:
    {
        label: 'Protected',
        tone: 'good',
        pinFill: '#2E9E5B',
    },
    notNeeded:
    {
        label: 'No protection needed',
        tone: 'neutral',
        // Darkened from #7D8A92 so it stays distinct from the green (validated with the dataviz palette checks).
        pinFill: '#56626A',
    },
};

// What a patrol found at the site. Cameras alone can only ever say
// "unresolved"; a nest is confirmed only by a person on the beach.
export const nestingStatuses =
{
    unresolved:
    {
        label: 'Nesting unresolved',
        tone: 'warning',
        chartFill: '#8A5A00',
    },
    confirmed:
    {
        label: 'Nest confirmed by patrol',
        tone: 'good',
        chartFill: '#2E9E5B',
    },
    noNest:
    {
        label: 'No nest found',
        tone: 'neutral',
        chartFill: '#56626A',
    },
};
