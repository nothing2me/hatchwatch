// Sidebar list of every zone and its current activity level.

import { activityLevels } from '../config/activityLevels.js';

export default function ZoneList({ zones })
{
    return (
        <section className="panel">
            <h2 className="panel__title">Activity zones</h2>

            <ul className="zone-list">
                {zones.map(function renderZoneRow(zone)
                {
                    const level = activityLevels[zone.activityLevel];

                    return (
                        <li key={zone.zoneIdentifier} className="zone-list__row">
                            <span className="zone-list__letter" style={{ borderColor: level.mapStroke }}>
                                {zone.zoneIdentifier}
                            </span>
                            <span className="zone-list__name">{zone.name}</span>
                            <span className="level-badge" style={{ background: level.badgeBackground, color: level.badgeText }}>
                                {level.label}
                            </span>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
