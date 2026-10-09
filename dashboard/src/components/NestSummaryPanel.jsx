// Sidebar card on the map page: a quick look at the nest sites, with the
// ones still waiting on protection first. Clicking a row opens its log.

import { protectionStatuses } from '../config/nestStatuses.js';
import { summarizeNestSite } from '../utils/nestStatus.js';

// Unprotected sites come first, then protected, then no-nest sites.
const protectionSortOrder = ['unprotected', 'protected', 'notNeeded'];

// Keeps the card short on a busy night; the Nest log page lists everything.
const maximumRows = 8;

export default function NestSummaryPanel({ nestSites, onOpenNest })
{
    const rows = nestSites
        .map(function summarize(nestSite)
        {
            return { nestSite, summary: summarizeNestSite(nestSite) };
        })
        .filter(function isOnLiveMap(row)
        {
            return !row.summary.isArchived;
        })
        .sort(function byUrgencyThenNewest(firstRow, secondRow)
        {
            const orderDifference = protectionSortOrder.indexOf(firstRow.summary.protectionStatus)
                - protectionSortOrder.indexOf(secondRow.summary.protectionStatus);

            if (orderDifference !== 0)
            {
                return orderDifference;
            }

            return Date.parse(secondRow.summary.arrivedAt) - Date.parse(firstRow.summary.arrivedAt);
        });

    const unprotectedCount = rows.filter(function isUnprotected(row)
    {
        return row.summary.protectionStatus === 'unprotected';
    }).length;

    return (
        <section className="panel">
            <div className="panel__header">
                <h2 className="panel__title">Nest sites</h2>
                <span className={`status-badge status-badge--${unprotectedCount > 0 ? 'bad' : 'good'}`}>
                    {unprotectedCount} unprotected
                </span>
            </div>

            {rows.length === 0 && <p className="panel__empty">No sites on the map right now.</p>}

            <div className="pair-list">
                {rows.slice(0, maximumRows).map(function renderNestRow({ nestSite, summary })
                {
                    const protection = protectionStatuses[summary.protectionStatus];

                    return (
                        <button
                            key={nestSite.nestIdentifier}
                            type="button"
                            className="pair-list__row"
                            onClick={function handleOpenNest()
                            {
                                onOpenNest(nestSite.nestIdentifier);
                            }}
                        >
                            <span className="status-dot" style={{ background: protection.pinFill }} aria-hidden="true" />
                            <span className="pair-list__name">
                                {nestSite.nestIdentifier} · Zone {nestSite.zoneIdentifier}
                                {summary.isOnSite && <span className="on-site-tag">On site now</span>}
                            </span>
                            <span className="pair-list__status">
                                {summary.patrolVisited ? protection.label : 'No patrol yet'}
                            </span>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
