// The dark bar across the top of the page: logo, navigation, live status,
// and account controls.

// The pages that exist so far. Cameras and Reports are still placeholders.
const views =
[
    { value: 'map', label: 'Map' },
    { value: 'nest-log', label: 'Nest log' },
];

export default function AppBar(
{
    currentView,
    onChangeView,
    unprotectedSiteCount,
    onlineCameraCount,
    totalCameraCount,
})
{
    return (
        <header className="app-bar">
            <div className="app-bar__brand">
                {/* Simple logo: two waves */}
                <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
                    <rect width="36" height="36" rx="9" fill="#1E4A66" />
                    <path d="M6 22c3 0 3-3 6-3s3 3 6 3 3-3 6-3 3 3 6 3" fill="none" stroke="#7CC4E8" strokeWidth="2.4" strokeLinecap="round" />
                    <path d="M6 15c3 0 3-3 6-3s3 3 6 3 3-3 6-3 3 3 6 3" fill="none" stroke="#F0A63A" strokeWidth="2.4" strokeLinecap="round" />
                </svg>
                <div className="app-bar__titles">
                    <span className="app-bar__name">NestTrace</span>
                    <span className="app-bar__place">Port Aransas, Holiday Beach</span>
                </div>
            </div>

            <nav aria-label="Main" className="app-bar__navigation">
                {views.map(function renderViewLink(view)
                {
                    const isCurrent = view.value === currentView;

                    return (
                        <button
                            key={view.value}
                            type="button"
                            aria-current={isCurrent ? 'page' : undefined}
                            className={isCurrent ? 'app-bar__link app-bar__link--active' : 'app-bar__link'}
                            onClick={function handleViewClick()
                            {
                                onChangeView(view.value);
                            }}
                        >
                            {view.label}
                            {/* Unprotected sites need the patrol, so count them on the tab. */}
                            {view.value === 'nest-log' && unprotectedSiteCount > 0 && (
                                <>
                                    <span className="app-bar__count" aria-hidden="true">{unprotectedSiteCount}</span>
                                    <span className="visually-hidden">, {unprotectedSiteCount} unprotected</span>
                                </>
                            )}
                        </button>
                    );
                })}
                <a href="#" className="app-bar__link">Cameras</a>
                <a href="#" className="app-bar__link">Reports</a>
            </nav>

            <div className="app-bar__spacer" />

            <div className="app-bar__actions">
                <span className="app-bar__status">
                    <span className="status-dot status-dot--good" aria-hidden="true" />
                    Live: {onlineCameraCount} of {totalCameraCount} cameras online
                </span>
                <button type="button" className="app-bar__button">Export</button>
                <button type="button" className="app-bar__account" aria-label="Account">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <circle cx="12" cy="8" r="4" />
                        <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
                    </svg>
                </button>
            </div>
        </header>
    );
}
