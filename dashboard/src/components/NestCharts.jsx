// The header on the Nest log page: headline counts, two donuts (protection
// and what patrols found), and sites per zone. Everything is counted from
// the same site logs the list below shows, so the numbers always agree.
//
// Chart rules followed (dataviz skill): donuts only for part-to-whole with
// few slices, colors validated for color-blind separation, a legend with
// counts on every chart so identity is never color alone, a hover tooltip on
// every mark, and a table view of the same numbers.

import { useState } from 'react';
import { protectionStatuses, nestingStatuses } from '../config/nestStatuses.js';
import { summarizeNestSite } from '../utils/nestStatus.js';

const scopeOptions =
[
    { value: 'map', label: 'On the map now' },
    { value: 'all', label: 'Everything logged' },
];

// Single hue for the zone bars: zone colors on the map already mean activity level.
const zoneBarFill = '#1E4A66';

function percent(part, whole)
{
    return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

// Counts sites per status key, in the config's order (fixed, never re-sorted).
function countByStatus(summaries, statuses, pick)
{
    return Object.entries(statuses).map(function countStatus([key, status])
    {
        return {
            key,
            label: status.label,
            fill: status.chartFill ?? status.pinFill,
            count: summaries.filter(function matches(summary)
            {
                return pick(summary) === key;
            }).length,
        };
    });
}

export default function NestCharts({ nestSites, zones })
{
    const [scope, setScope] = useState('map');
    const [showTable, setShowTable] = useState(false);

    const allSummaries = nestSites.map(function summarize(nestSite)
    {
        return { nestSite, summary: summarizeNestSite(nestSite) };
    });
    const rows = scope === 'map'
        ? allSummaries.filter(function isOnMap(row)
        {
            return !row.summary.isArchived;
        })
        : allSummaries;
    const summaries = rows.map(function getSummary(row)
    {
        return row.summary;
    });

    const total = rows.length;
    const protection = countByStatus(summaries, protectionStatuses, function getProtection(summary)
    {
        return summary.protectionStatus;
    });
    const nesting = countByStatus(summaries, nestingStatuses, function getNesting(summary)
    {
        return summary.nestingStatus;
    });
    const byZone = zones.map(function countZone(zone)
    {
        return {
            key: zone.zoneIdentifier,
            label: `${zone.zoneIdentifier} · ${zone.name}`,
            count: rows.filter(function inZone(row)
            {
                return row.nestSite.zoneIdentifier === zone.zoneIdentifier;
            }).length,
        };
    });

    const visitedCount = summaries.filter(function wasVisited(summary)
    {
        return summary.patrolVisited;
    }).length;
    const twoCameraCount = rows.filter(function seenByBoth(row)
    {
        return row.nestSite.evidenceTier ? row.nestSite.evidenceTier === 'two_camera' : row.nestSite.seenByCameras.length === 2;
    }).length;
    const archivedCount = allSummaries.filter(function isArchived(row)
    {
        return row.summary.isArchived;
    }).length;
    const unprotectedCount = protection.find(function isUnprotected(entry)
    {
        return entry.key === 'unprotected';
    }).count;

    return (
        <section className="panel nest-charts" aria-labelledby="nest-charts-heading">
            <div className="nest-charts__header">
                <h2 id="nest-charts-heading" className="panel__title">Tonight at a glance</h2>
                <div role="group" aria-label="Which sites to count" className="segmented-control">
                    {scopeOptions.map(function renderScope(option)
                    {
                        const isSelected = option.value === scope;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                aria-pressed={isSelected}
                                className={isSelected ? 'segmented-control__button segmented-control__button--selected' : 'segmented-control__button'}
                                onClick={function handleScope()
                                {
                                    setScope(option.value);
                                }}
                            >
                                {option.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="stat-tiles">
                <StatTile label={scope === 'map' ? 'Sites on the map' : 'Sites logged'} value={total} />
                <StatTile label="Unprotected" value={unprotectedCount} detail={`${percent(unprotectedCount, total)}% of sites`} tone={unprotectedCount > 0 ? 'bad' : undefined} />
                <StatTile label="Patrol visited" value={visitedCount} detail={`of ${total}`} />
                <StatTile label="Seen by both cameras" value={`${percent(twoCameraCount, total)}%`} detail={`${twoCameraCount} of ${total}`} />
                <StatTile label="Faded off the map" value={archivedCount} detail="kept in the log" />
            </div>

            {total === 0
                ? <p className="panel__empty">No sites to chart yet. They'll appear as the cameras pick up activity.</p>
                : (
                    <div className="nest-charts__grid">
                        <DonutChart title="Protection" segments={protection} total={total} />
                        <DonutChart title="What patrols found" segments={nesting} total={total} />
                        <ZoneBars title="Sites by zone" bars={byZone} total={total} />
                    </div>
                )}

            {total > 0 && (
                <div>
                    <button
                        type="button"
                        className="text-button"
                        aria-expanded={showTable}
                        onClick={function toggleTable()
                        {
                            setShowTable(!showTable);
                        }}
                    >
                        {showTable ? 'Hide the numbers as a table' : 'Show the numbers as a table'}
                    </button>
                    {showTable && (
                        <table className="nest-charts__table">
                            <caption>Site counts, {scopeOptions.find((option) => option.value === scope).label.toLowerCase()}</caption>
                            <thead>
                                <tr>
                                    <th scope="col">Group</th>
                                    <th scope="col">Category</th>
                                    <th scope="col">Sites</th>
                                    <th scope="col">Share</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[['Protection', protection], ['What patrols found', nesting], ['Zone', byZone]].flatMap(function renderGroup([group, entries])
                                {
                                    return entries.map(function renderRow(entry)
                                    {
                                        return (
                                            <tr key={`${group}-${entry.key}`}>
                                                <td>{group}</td>
                                                <td>{entry.label}</td>
                                                <td>{entry.count}</td>
                                                <td>{percent(entry.count, total)}%</td>
                                            </tr>
                                        );
                                    });
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </section>
    );
}

function StatTile({ label, value, detail, tone })
{
    return (
        <div className="stat-tile">
            <span className="stat-tile__label">{label}</span>
            <span className={tone ? `stat-tile__value stat-tile__value--${tone}` : 'stat-tile__value'}>{value}</span>
            {detail && <span className="stat-tile__detail">{detail}</span>}
        </div>
    );
}

// Floating label shown while a mark is hovered or focused.
function useTooltip()
{
    const [tooltip, setTooltip] = useState(null);

    function show(event, text)
    {
        const box = event.currentTarget.closest('.chart-card').getBoundingClientRect();
        const point = event.clientX !== undefined && event.clientX !== 0
            ? { x: event.clientX - box.left, y: event.clientY - box.top }
            : { x: box.width / 2, y: 40 };
        setTooltip({ text, ...point });
    }

    function hide()
    {
        setTooltip(null);
    }

    const element = tooltip && (
        <div className="chart-tooltip" style={{ left: tooltip.x, top: tooltip.y }} role="status">
            {tooltip.text}
        </div>
    );

    return { show, hide, element };
}

// An SVG path for one ring slice between two angles (radians, 0 = 12 o'clock).
function ringSlicePath(startAngle, endAngle, outerRadius, innerRadius)
{
    const point = (radius, angle) => [radius * Math.sin(angle), -radius * Math.cos(angle)];
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    const [x1, y1] = point(outerRadius, startAngle);
    const [x2, y2] = point(outerRadius, endAngle);
    const [x3, y3] = point(innerRadius, endAngle);
    const [x4, y4] = point(innerRadius, startAngle);
    return `M${x1},${y1} A${outerRadius},${outerRadius} 0 ${largeArc} 1 ${x2},${y2} L${x3},${y3} A${innerRadius},${innerRadius} 0 ${largeArc} 0 ${x4},${y4} Z`;
}

function DonutChart({ title, segments, total })
{
    const tooltip = useTooltip();
    const outerRadius = 56;
    const innerRadius = 36;
    const visibleSegments = segments.filter(function hasSites(segment)
    {
        return segment.count > 0;
    });

    let angle = 0;
    const slices = visibleSegments.map(function toSlice(segment)
    {
        const sweep = (segment.count / total) * Math.PI * 2;
        const slice = { ...segment, startAngle: angle, endAngle: angle + sweep };
        angle += sweep;
        return slice;
    });

    return (
        <figure className="chart-card">
            <figcaption className="chart-card__title">{title}</figcaption>
            <div className="donut">
                <svg viewBox="-60 -60 120 120" className="donut__svg" role="img" aria-label={`${title}: ${segments.map((segment) => `${segment.label} ${segment.count}`).join(', ')}`}>
                    {slices.length === 1
                        ? (
                            // A single category fills the whole ring.
                            <circle
                                r={(outerRadius + innerRadius) / 2}
                                fill="none"
                                stroke={slices[0].fill}
                                strokeWidth={outerRadius - innerRadius}
                                className="donut__slice"
                                tabIndex={0}
                                onMouseMove={(event) => tooltip.show(event, `${slices[0].label}: ${slices[0].count} (100%)`)}
                                onFocus={(event) => tooltip.show(event, `${slices[0].label}: ${slices[0].count} (100%)`)}
                                onMouseLeave={tooltip.hide}
                                onBlur={tooltip.hide}
                            />
                        )
                        : slices.map(function renderSlice(slice)
                        {
                            const text = `${slice.label}: ${slice.count} (${percent(slice.count, total)}%)`;
                            return (
                                <path
                                    key={slice.key}
                                    d={ringSlicePath(slice.startAngle, slice.endAngle, outerRadius, innerRadius)}
                                    fill={slice.fill}
                                    // 2px surface-colored gap between slices.
                                    stroke="#FFFFFF"
                                    strokeWidth="2"
                                    strokeLinejoin="round"
                                    className="donut__slice"
                                    tabIndex={0}
                                    onMouseMove={(event) => tooltip.show(event, text)}
                                    onFocus={(event) => tooltip.show(event, text)}
                                    onMouseLeave={tooltip.hide}
                                    onBlur={tooltip.hide}
                                />
                            );
                        })}
                    <text y="-2" className="donut__total">{total}</text>
                    <text y="13" className="donut__total-label">sites</text>
                </svg>
                <ul className="chart-legend">
                    {segments.map(function renderLegendRow(segment)
                    {
                        return (
                            <li key={segment.key} className="chart-legend__row">
                                <span className="chart-legend__swatch" style={{ background: segment.fill }} aria-hidden="true" />
                                <span className="chart-legend__label">{segment.label}</span>
                                <span className="chart-legend__value">{segment.count} · {percent(segment.count, total)}%</span>
                            </li>
                        );
                    })}
                </ul>
            </div>
            {tooltip.element}
        </figure>
    );
}

function ZoneBars({ title, bars, total })
{
    const tooltip = useTooltip();
    const largest = Math.max(1, ...bars.map((bar) => bar.count));

    return (
        <figure className="chart-card">
            <figcaption className="chart-card__title">{title}</figcaption>
            <ul className="zone-bars">
                {bars.map(function renderBar(bar)
                {
                    const text = `Zone ${bar.label}: ${bar.count} sites (${percent(bar.count, total)}%)`;
                    return (
                        <li
                            key={bar.key}
                            className="zone-bars__row"
                            tabIndex={0}
                            onMouseMove={(event) => tooltip.show(event, text)}
                            onFocus={(event) => tooltip.show(event, text)}
                            onMouseLeave={tooltip.hide}
                            onBlur={tooltip.hide}
                        >
                            <span className="zone-bars__label">{bar.label}</span>
                            <span className="zone-bars__track">
                                <span className="zone-bars__bar" style={{ width: `${(bar.count / largest) * 100}%`, background: zoneBarFill }} />
                            </span>
                            <span className="zone-bars__value">{bar.count}</span>
                        </li>
                    );
                })}
            </ul>
            {tooltip.element}
        </figure>
    );
}
