// List of every nest site, newest first, with filters for what the patrol
// cares about most: sites that are still unprotected or never visited.
// Sites that have faded off the live map stay here under "Archived".

import { useState } from 'react';
import { protectionStatuses } from '../config/nestStatuses.js';
import { summarizeNestSite } from '../utils/nestStatus.js';
import { formatDateTime } from '../utils/formatTime.js';

// Each filter has a label and a test run against a site's summary.
const filterOptions =
[
    {
        value: 'active',
        label: 'On map',
        matches: function matchesActive(summary)
        {
            return !summary.isArchived;
        },
    },
    {
        value: 'unprotected',
        label: 'Unprotected',
        matches: function matchesUnprotected(summary)
        {
            return !summary.isArchived && summary.protectionStatus === 'unprotected';
        },
    },
    {
        value: 'needsPatrol',
        label: 'No patrol yet',
        matches: function matchesNeedsPatrol(summary)
        {
            return !summary.isArchived && !summary.patrolVisited;
        },
    },
    {
        value: 'protected',
        label: 'Protected',
        matches: function matchesProtected(summary)
        {
            return !summary.isArchived && summary.protectionStatus === 'protected';
        },
    },
    {
        value: 'archived',
        label: 'Archived',
        matches: function matchesArchived(summary)
        {
            return summary.isArchived;
        },
    },
];

export default function NestList(
{
    nestSites,
    zones,
    dataTag,
    selectedNestIdentifier,
    onSelectNest,
    onClearPatrolEntries,
})
{
    const [selectedFilter, setSelectedFilter] = useState('active');

    const activeFilter = filterOptions.find(function isSelectedFilter(option)
    {
        return option.value === selectedFilter;
    });

    // Pair each site with its summary once, then filter and sort newest first.
    const rows = nestSites
        .map(function summarize(nestSite)
        {
            return { nestSite, summary: summarizeNestSite(nestSite) };
        })
        .filter(function passesFilter(row)
        {
            return activeFilter.matches(row.summary);
        })
        .sort(function newestFirst(firstRow, secondRow)
        {
            return Date.parse(secondRow.summary.arrivedAt) - Date.parse(firstRow.summary.arrivedAt);
        });

    return (
        <section className="panel nest-list" aria-labelledby="nest-list-heading">
            <div className="map-panel__title-row">
                <h1 id="nest-list-heading" className="map-panel__title">Nest log</h1>
                <span className="sample-tag">{dataTag}</span>
            </div>

            <div role="group" aria-label="Filter nest sites" className="segmented-control nest-list__filters">
                {filterOptions.map(function renderFilterButton(option)
                {
                    const isSelected = option.value === selectedFilter;

                    return (
                        <button
                            key={option.value}
                            type="button"
                            aria-pressed={isSelected}
                            className={isSelected ? 'segmented-control__button segmented-control__button--selected' : 'segmented-control__button'}
                            onClick={function handleFilterClick()
                            {
                                setSelectedFilter(option.value);
                            }}
                        >
                            {option.label}
                        </button>
                    );
                })}
            </div>

            {rows.length === 0 && <p className="panel__empty">No sites match this filter.</p>}

            <div className="nest-list__rows">
                {rows.map(function renderNestRow({ nestSite, summary })
                {
                    const isSelected = nestSite.nestIdentifier === selectedNestIdentifier;
                    const protection = protectionStatuses[summary.protectionStatus];
                    const zone = zones.find(function matchesZone(candidate)
                    {
                        return candidate.zoneIdentifier === nestSite.zoneIdentifier;
                    });

                    return (
                        <button
                            key={nestSite.nestIdentifier}
                            type="button"
                            aria-pressed={isSelected}
                            className={isSelected ? 'nest-row nest-row--selected' : 'nest-row'}
                            onClick={function handleNestClick()
                            {
                                onSelectNest(nestSite.nestIdentifier);
                            }}
                        >
                            <span className="nest-row__pin" style={{ background: protection.pinFill }} aria-hidden="true" />
                            <span className="nest-row__main">
                                <span className="nest-row__title">
                                    {nestSite.nestIdentifier}
                                    {summary.isOnSite && <span className="on-site-tag">On site now</span>}
                                    {nestSite.evidenceTier === 'single_camera' && <span className="review-tag">One camera</span>}
                                </span>
                                <span className="nest-row__meta">
                                    Zone {nestSite.zoneIdentifier}{zone ? `, ${zone.name}` : ''} · arrived {formatDateTime(summary.arrivedAt)}
                                </span>
                                <span className="nest-row__meta">
                                    {summary.patrolVisited ? `Patrol visited ${formatDateTime(summary.lastPatrolVisitAt)}` : 'No patrol yet'}
                                </span>
                            </span>
                            <span className={`status-badge status-badge--${protection.tone}`}>{protection.label}</span>
                        </button>
                    );
                })}
            </div>

            {/* Sample mode only: the live log is shared and append-only. */}
            {onClearPatrolEntries && (
                <button type="button" className="text-button" onClick={onClearPatrolEntries}>
                    Reset demo patrol entries
                </button>
            )}
        </section>
    );
}
