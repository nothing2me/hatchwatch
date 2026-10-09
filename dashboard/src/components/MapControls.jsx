// The buttons above the map: time range and which layers are visible.

// Time ranges the user can pick. Only "live" does anything until we have
// stored history from the pipeline adapter.
const timeRangeOptions =
[
    { value: 'live', label: 'Live' },
    { value: 'today', label: 'Today' },
    { value: 'week', label: '7 days' },
];

export default function MapControls(
{
    selectedTimeRange,
    onTimeRangeChange,
    showZones,
    onToggleZones,
    showCameras,
    onToggleCameras,
    showNestSites,
    onToggleNestSites,
})
{
    return (
        <div className="map-controls">
            <div role="group" aria-label="Time range" className="segmented-control">
                {timeRangeOptions.map(function renderTimeRangeButton(option)
                {
                    const isSelected = option.value === selectedTimeRange;

                    return (
                        <button
                            key={option.value}
                            type="button"
                            aria-pressed={isSelected}
                            className={isSelected ? 'segmented-control__button segmented-control__button--selected' : 'segmented-control__button'}
                            onClick={function handleTimeRangeClick()
                            {
                                onTimeRangeChange(option.value);
                            }}
                        >
                            {option.label}
                        </button>
                    );
                })}
            </div>

            <button type="button" aria-pressed={showZones} className="toggle-button" onClick={onToggleZones}>
                Activity zones
            </button>
            <button type="button" aria-pressed={showCameras} className="toggle-button" onClick={onToggleCameras}>
                Cameras
            </button>
            <button type="button" aria-pressed={showNestSites} className="toggle-button" onClick={onToggleNestSites}>
                Nest sites
            </button>
        </div>
    );
}
