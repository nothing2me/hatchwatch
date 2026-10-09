// One nest site: its status flags, key facts, where it is, its own log
// from oldest to newest, and the form patrol members use to add to it.

import { nestEventTypes, detectionAlertText } from '../config/nestEvents.js';
import { protectionStatuses, nestingStatuses } from '../config/nestStatuses.js';
import { summarizeNestSite } from '../utils/nestStatus.js';
import { formatDateTime, formatDuration } from '../utils/formatTime.js';
import NestLocationPreview from './NestLocationPreview.jsx';
import PatrolUpdateForm from './PatrolUpdateForm.jsx';

export default function NestDetail({ nestSite, zones, onAddPatrolEntry })
{
    const summary = summarizeNestSite(nestSite);
    const protection = protectionStatuses[summary.protectionStatus];
    const nesting = nestingStatuses[summary.nestingStatus];

    const zone = zones.find(function matchesZone(candidate)
    {
        return candidate.zoneIdentifier === nestSite.zoneIdentifier;
    });

    return (
        <section className="panel nest-detail" aria-labelledby="nest-detail-heading">
            <div className="nest-detail__header">
                <h2 id="nest-detail-heading" className="nest-detail__title">{nestSite.nestIdentifier}</h2>
                <span className={`status-badge status-badge--${protection.tone}`}>{protection.label}</span>
                <span className={`status-badge status-badge--${nesting.tone}`}>{nesting.label}</span>
                {summary.isOnSite && <span className="on-site-tag">On site now</span>}
            </div>

            {/* Until a patrol reports back, the cameras can only say this much. */}
            {summary.nestingStatus === 'unresolved' && (
                <p className="nest-detail__alert" role="status">{detectionAlertText}</p>
            )}

            {nestSite.evidenceTier === 'single_camera' && (
                <p className="nest-detail__note">
                    Only {nestSite.seenByCameras[0]} picked this up; the other camera in the pair didn't. Review the clips before sending a patrol.
                </p>
            )}

            {summary.isArchived && (
                <p className="nest-detail__note">
                    This site faded off the live map {formatDateTime(summary.archivedAt)}. Its log is kept, and patrol updates can still be added.
                </p>
            )}

            <div className="fact-grid fact-grid--wide">
                <div className="fact">
                    <span className="fact__label">Arrived</span>
                    <span className="fact__value">{formatDateTime(summary.arrivedAt)}</span>
                </div>
                <div className="fact">
                    <span className="fact__label">Left</span>
                    <span className="fact__value">{summary.departedAt ? formatDateTime(summary.departedAt) : 'Still on site'}</span>
                </div>
                <div className="fact">
                    <span className="fact__label">Time on site</span>
                    <span className="fact__value">
                        {summary.departedAt ? formatDuration(summary.arrivedAt, summary.departedAt) : 'Ongoing'}
                    </span>
                </div>
                <div className="fact">
                    <span className="fact__label">Zone</span>
                    <span className="fact__value">{nestSite.zoneIdentifier}{zone ? `, ${zone.name}` : ''}</span>
                </div>
                <div className="fact">
                    <span className="fact__label">Seen by</span>
                    <span className="fact__value">
                        {nestSite.seenByCameras.join(' and ')}
                        {nestSite.evidenceTier === 'single_camera' && ' (one camera)'}
                    </span>
                </div>
                {nestSite.alertRaisedAt && (
                    <div className="fact">
                        <span className="fact__label">Alert raised</span>
                        <span className="fact__value">{formatDateTime(nestSite.alertRaisedAt)}</span>
                    </div>
                )}
                <div className="fact">
                    <span className="fact__label">Patrol</span>
                    <span className="fact__value">
                        {summary.patrolVisited ? `Visited ${formatDateTime(summary.lastPatrolVisitAt)}` : 'Not out yet'}
                    </span>
                </div>
            </div>

            <div className="nest-detail__location">
                <NestLocationPreview position={nestSite.position} pinFill={protection.pinFill} nestIdentifier={nestSite.nestIdentifier} />
                <div className="fact">
                    <span className="fact__label">Location</span>
                    <span>{nestSite.locationDescription}</span>
                    {nestSite.groundPointMetres && (
                        <span className="fact__label">
                            Ground position {nestSite.groundPointMetres.x} m along shore, {nestSite.groundPointMetres.z} m across, inspection radius {nestSite.radiusMetres} m (simulated camera calibration).
                        </span>
                    )}
                    <span className="fact__label">GPS coordinates will appear here once cameras are surveyed.</span>
                </div>
            </div>

            <h3 className="nest-detail__subtitle">Site log</h3>
            <ol className="nest-timeline">
                {summary.events.map(function renderLogEntry(event)
                {
                    const eventType = nestEventTypes[event.type];
                    const isPatrol = event.source === 'patrol';

                    return (
                        <li key={event.eventIdentifier} className={isPatrol ? 'nest-timeline__entry nest-timeline__entry--patrol' : 'nest-timeline__entry'}>
                            <span className="nest-timeline__dot" aria-hidden="true" />
                            <div className="nest-timeline__body">
                                <div className="nest-timeline__heading">
                                    <span className="nest-timeline__label">{eventType ? eventType.label : event.type}</span>
                                    <span className="source-tag">{isPatrol ? 'Patrol' : 'Cameras'}</span>
                                    <time className="nest-timeline__time" dateTime={event.time}>{formatDateTime(event.time)}</time>
                                </div>
                                {event.note && <p className="nest-timeline__note">{event.note}</p>}
                                <span className="nest-timeline__author">{event.author}</span>
                            </div>
                        </li>
                    );
                })}
            </ol>

            <PatrolUpdateForm
                nestIdentifier={nestSite.nestIdentifier}
                protectionStatus={summary.protectionStatus}
                onAddPatrolEntry={onAddPatrolEntry}
            />
        </section>
    );
}
