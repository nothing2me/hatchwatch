// Small key in the corner of the map explaining the colors and icons.

import { activityLevels, activityLevelOrder } from '../config/activityLevels.js';
import { protectionStatuses } from '../config/nestStatuses.js';

export default function MapLegend()
{
    return (
        <div className="map-legend">
            <span className="map-legend__title">Activity level</span>

            {activityLevelOrder.map(function renderLegendRow(levelKey)
            {
                const level = activityLevels[levelKey];

                return (
                    <span key={levelKey} className="map-legend__row">
                        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                            <rect width="14" height="14" rx="3" fill={level.mapFill} />
                        </svg>
                        {level.label}
                    </span>
                );
            })}

            <span className="map-legend__row">
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                    <circle cx="7" cy="7" r="7" fill="#0F2C3F" />
                </svg>
                Camera (pairs face each other)
            </span>

            <span className="map-legend__title">Nest sites</span>

            {Object.entries(protectionStatuses).map(function renderNestLegendRow([statusKey, status])
            {
                return (
                    <span key={statusKey} className="map-legend__row">
                        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                            <circle cx="7" cy="7" r="6" fill={status.pinFill} />
                        </svg>
                        {status.label}
                    </span>
                );
            })}
        </div>
    );
}
