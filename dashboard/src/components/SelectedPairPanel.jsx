// Sidebar card for the currently selected camera pair: both feeds side by
// side (one per angle) and a few key facts about the zone.

import { activityLevels } from '../config/activityLevels.js';
import { describePairStatus } from '../utils/cameraStatus.js';

export default function SelectedPairPanel({ cameraPair, zone })
{
    // Nothing selected yet: tell the user how to pick one.
    if (!cameraPair)
    {
        return (
            <section className="panel">
                <h2 className="panel__title">Camera pair</h2>
                <p className="panel__empty">Select a camera on the map or in the list to see both of its angles.</p>
            </section>
        );
    }

    const pairStatus = describePairStatus(cameraPair);
    const level = zone ? activityLevels[zone.activityLevel] : null;

    return (
        <section className="panel">
            <div className="panel__header">
                <h2 className="panel__title">Pair {cameraPair.pairIdentifier}: {cameraPair.name}</h2>
                <span className={`status-badge status-badge--${pairStatus.tone}`}>{pairStatus.text}</span>
            </div>

            {/* One feed per camera, so judges can see the two angles */}
            <div className="camera-feeds">
                {cameraPair.cameras.map(function renderFeed(camera)
                {
                    const isOnline = camera.status === 'online';

                    return (
                        <div key={camera.cameraIdentifier} className="camera-feed">
                            <div className="camera-feed__screen">
                                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
                                    <rect x="2" y="6" width="14" height="12" rx="2" />
                                    <path d="M16 10l6-3v10l-6-3" />
                                </svg>
                                {/* TODO: replace with the real or simulated camera frame */}
                                {isOnline ? 'Live feed' : 'No signal'}
                            </div>
                            <span className="camera-feed__caption">
                                {camera.cameraIdentifier}, {camera.facingDescription}
                            </span>
                        </div>
                    );
                })}
            </div>

            <div className="fact-grid">
                <div className="fact">
                    <span className="fact__label">Zone</span>
                    <span className="fact__value">{zone ? zone.zoneIdentifier : 'None'}</span>
                </div>
                <div className="fact">
                    <span className="fact__label">Activity</span>
                    <span className="fact__value" style={level ? { color: level.badgeBackground } : undefined}>
                        {level ? level.label : 'Unknown'}
                    </span>
                </div>
                <div className="fact">
                    <span className="fact__label">Last frame</span>
                    <span className="fact__value">Not connected</span>
                </div>
            </div>
        </section>
    );
}
