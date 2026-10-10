// How fast alerts turn into protected nests: headline times, the slowest
// cases against the average, and a log of every alert with when patrol
// personnel first updated it and when protection went up.

import { useState } from 'react';
import { formatDateTime } from '../utils/formatTime.js';
import { formatElapsed, summarizeResponses } from '../utils/responseTimes.js';

const barFill = '#1E4A66';
const sortOptions =
[
    { value: 'newest', label: 'Newest alerts' },
    { value: 'slowest', label: 'Slowest first' },
];

function sortValue(response, now)
{
    if (response.millisecondsToProtect !== null)
    {
        return response.millisecondsToProtect;
    }
    // Still-waiting sites count as slow as their current wait.
    return response.noNest ? -1 : now.getTime() - Date.parse(response.alertRaisedAt);
}

export default function ResponseTimes({ nestSites, generatedAt, onSelectNest })
{
    const [sortOrder, setSortOrder] = useState('newest');
    const [hovered, setHovered] = useState(null);
    const now = new Date(generatedAt);
    const summary = summarizeResponses(nestSites, now);

    if (summary.responses.length === 0)
    {
        return (
            <section className="panel nest-charts" aria-labelledby="response-heading">
                <h2 id="response-heading" className="panel__title">Patrol response times</h2>
                <p className="panel__empty">Response times appear once the cameras raise their first alert.</p>
            </section>
        );
    }

    const rows = [...summary.responses].sort(function order(first, second)
    {
        return sortOrder === 'slowest'
            ? sortValue(second, now) - sortValue(first, now)
            : Date.parse(second.alertRaisedAt) - Date.parse(first.alertRaisedAt);
    });

    const longestWait = summary.waiting[0] ?? null;
    const scale = Math.max(1, summary.worstMillisecondsToProtect ?? 1, summary.averageMillisecondsToProtect ?? 1);
    const averageLeft = summary.averageMillisecondsToProtect !== null ? (summary.averageMillisecondsToProtect / scale) * 100 : null;

    return (
        <section className="panel nest-charts" aria-labelledby="response-heading">
            <h2 id="response-heading" className="panel__title">Patrol response times</h2>

            <div className="stat-tiles">
                <div className="stat-tile">
                    <span className="stat-tile__label">Average time to protect</span>
                    <span className="stat-tile__value">{formatElapsed(summary.averageMillisecondsToProtect)}</span>
                    <span className="stat-tile__detail">over {summary.protectedCount} protected sites</span>
                </div>
                <div className="stat-tile">
                    <span className="stat-tile__label">Median</span>
                    <span className="stat-tile__value">{formatElapsed(summary.medianMillisecondsToProtect)}</span>
                    <span className="stat-tile__detail">half were faster</span>
                </div>
                <div className="stat-tile">
                    <span className="stat-tile__label">Worst case</span>
                    <span className="stat-tile__value">{formatElapsed(summary.worstMillisecondsToProtect)}</span>
                    <span className="stat-tile__detail">{summary.worstProtected[0] ? summary.worstProtected[0].nestIdentifier : 'none yet'}</span>
                </div>
                <div className="stat-tile">
                    <span className="stat-tile__label">Average to first patrol update</span>
                    <span className="stat-tile__value">{formatElapsed(summary.averageMillisecondsToFirstPatrol)}</span>
                    <span className="stat-tile__detail">from the alert</span>
                </div>
                <div className="stat-tile">
                    <span className="stat-tile__label">Still waiting</span>
                    <span className={summary.waiting.length > 0 ? 'stat-tile__value stat-tile__value--bad' : 'stat-tile__value'}>{summary.waiting.length}</span>
                    <span className="stat-tile__detail">{longestWait ? `longest ${formatElapsed(longestWait.millisecondsWaiting)} (${longestWait.nestIdentifier})` : 'every alert answered'}</span>
                </div>
            </div>

            {summary.worstProtected.length > 0 && (
                <figure className="chart-card">
                    <figcaption className="chart-card__title">Slowest to protect vs the average</figcaption>
                    <div className="worst-bars">
                        {averageLeft !== null && (
                            <div className="worst-bars__average" style={{ left: `calc(var(--worst-label-width) + (100% - var(--worst-label-width) - var(--worst-value-width)) * ${averageLeft / 100})` }}>
                                <span className="worst-bars__average-label">Average {formatElapsed(summary.averageMillisecondsToProtect)}</span>
                            </div>
                        )}
                        {summary.worstProtected.map(function renderBar(response)
                        {
                            const isHovered = hovered === response.nestIdentifier;
                            return (
                                <button
                                    key={response.nestIdentifier}
                                    type="button"
                                    className="worst-bars__row"
                                    onMouseEnter={() => setHovered(response.nestIdentifier)}
                                    onMouseLeave={() => setHovered(null)}
                                    onFocus={() => setHovered(response.nestIdentifier)}
                                    onBlur={() => setHovered(null)}
                                    onClick={() => onSelectNest(response.nestIdentifier)}
                                    aria-label={`${response.nestIdentifier}, zone ${response.zoneIdentifier}: protected ${formatElapsed(response.millisecondsToProtect)} after the alert, by ${response.protection.author}`}
                                >
                                    <span className="worst-bars__label">{response.nestIdentifier} · {response.zoneIdentifier}</span>
                                    <span className="worst-bars__track">
                                        <span className="worst-bars__bar" style={{ width: `${(response.millisecondsToProtect / scale) * 100}%`, background: barFill }} />
                                    </span>
                                    <span className="worst-bars__value">{formatElapsed(response.millisecondsToProtect)}</span>
                                    {isHovered && (
                                        <span className="chart-tooltip worst-bars__tooltip" role="status">
                                            Alert {formatDateTime(response.alertRaisedAt)} · protected {formatDateTime(response.protection.time)} by {response.protection.author}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                    {summary.simulatedShare > 0 && (
                        <p className="stat-tile__detail">
                            {Math.round(summary.simulatedShare * 100)}% of protections so far were logged by the demo patrol (simulated), so these times reflect its timing, not a real crew.
                        </p>
                    )}
                </figure>
            )}

            <div className="nest-charts__header">
                <h3 className="nest-detail__subtitle">Response log</h3>
                <div role="group" aria-label="Sort the response log" className="segmented-control">
                    {sortOptions.map(function renderSort(option)
                    {
                        const isSelected = option.value === sortOrder;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                aria-pressed={isSelected}
                                className={isSelected ? 'segmented-control__button segmented-control__button--selected' : 'segmented-control__button'}
                                onClick={() => setSortOrder(option.value)}
                            >
                                {option.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="response-log" tabIndex={0} aria-label={`Response log, ${rows.length} alerts`}>
                <table className="nest-charts__table response-log__table">
                    <thead>
                        <tr>
                            <th scope="col">Site</th>
                            <th scope="col">Alert raised</th>
                            <th scope="col">First patrol update</th>
                            <th scope="col">Protected</th>
                            <th scope="col">Time to protect</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(function renderRow(response)
                        {
                            let outcome;
                            if (response.millisecondsToProtect !== null)
                            {
                                outcome = formatElapsed(response.millisecondsToProtect);
                            }
                            else if (response.noNest)
                            {
                                outcome = 'No nest found';
                            }
                            else
                            {
                                outcome = <span className="response-log__waiting">Waiting {formatElapsed(now.getTime() - Date.parse(response.alertRaisedAt))}</span>;
                            }

                            return (
                                <tr key={response.nestIdentifier}>
                                    <td>
                                        <button type="button" className="text-button response-log__site" onClick={() => onSelectNest(response.nestIdentifier)}>
                                            {response.nestIdentifier}
                                        </button>
                                        <span className="stat-tile__detail"> Zone {response.zoneIdentifier}</span>
                                    </td>
                                    <td>{formatDateTime(response.alertRaisedAt)}</td>
                                    <td>
                                        {response.firstPatrol
                                            ? <>{formatDateTime(response.firstPatrol.time)}<span className="stat-tile__detail"> · {response.firstPatrol.author} (+{formatElapsed(response.millisecondsToFirstPatrol)})</span></>
                                            : '—'}
                                    </td>
                                    <td>
                                        {response.protection
                                            ? <>{formatDateTime(response.protection.time)}<span className="stat-tile__detail"> · {response.protection.author}</span></>
                                            : '—'}
                                    </td>
                                    <td>{outcome}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
