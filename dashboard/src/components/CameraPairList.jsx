// Sidebar list of camera pairs. Clicking a row selects that pair, which
// highlights it on the map and shows its feeds.

import { describePairStatus } from '../utils/cameraStatus.js';

export default function CameraPairList({ cameraPairs, selectedPairIdentifier, onSelectPair })
{
    return (
        <section className="panel">
            <h2 className="panel__title">Camera pairs</h2>

            <div className="pair-list">
                {cameraPairs.map(function renderPairRow(cameraPair)
                {
                    const isSelected = cameraPair.pairIdentifier === selectedPairIdentifier;
                    const pairStatus = describePairStatus(cameraPair);

                    return (
                        <button
                            key={cameraPair.pairIdentifier}
                            type="button"
                            aria-pressed={isSelected}
                            className={isSelected ? 'pair-list__row pair-list__row--selected' : 'pair-list__row'}
                            onClick={function handlePairClick()
                            {
                                onSelectPair(cameraPair.pairIdentifier);
                            }}
                        >
                            <span className={`status-dot status-dot--${pairStatus.tone}`} aria-hidden="true" />
                            <span className="pair-list__name">Pair {cameraPair.pairIdentifier}: {cameraPair.name}</span>
                            <span className="pair-list__status">{pairStatus.text}</span>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
