// Top-level component: connects to the data source, keeps track of what
// the user has selected, and lays out the app bar, map, and sidebar.

import { useEffect, useMemo, useState } from 'react';
import { createSampleDataSource } from './data/dataSource.js';
import { createLiveDataSource } from './data/liveDataSource.js';
import { countAllCameras, countOnlineCameras } from './utils/cameraStatus.js';
import { countUnprotectedSites } from './utils/nestStatus.js';
import AppBar from './components/AppBar.jsx';
import MapControls from './components/MapControls.jsx';
import BeachMap from './components/BeachMap.jsx';
import SelectedPairPanel from './components/SelectedPairPanel.jsx';
import NestSummaryPanel from './components/NestSummaryPanel.jsx';
import ZoneList from './components/ZoneList.jsx';
import CameraPairList from './components/CameraPairList.jsx';
import NestLogView from './components/NestLogView.jsx';
import AlertToasts from './components/AlertToasts.jsx';
import FeedStatusBanner from './components/FeedStatusBanner.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

// Live by default: the dashboard backend feeds it from the continuous
// simulator. Set VITE_DATA_SOURCE=sample to run on made-up data alone.
const dataSource = import.meta.env.VITE_DATA_SOURCE === 'sample'
    ? createSampleDataSource()
    : createLiveDataSource();

// Alerts stay on screen this long unless dismissed or opened.
const alertDisplayMilliseconds = 15000;
const maximumAlertsShown = 4;

export default function App()
{
    // The latest snapshot of the beach from the data source (null until the first one arrives).
    const [snapshot, setSnapshot] = useState(null);
    const [connectionState, setConnectionState] = useState('connecting');
    const [alerts, setAlerts] = useState([]);

    // Which camera pair the user is looking at. Starts on pair B (Holiday Beach).
    const [selectedPairIdentifier, setSelectedPairIdentifier] = useState('B');

    // Which page is showing ("map" or "nest-log"), and which nest site is open.
    const [currentView, setCurrentView] = useState('map');
    const [selectedNestIdentifier, setSelectedNestIdentifier] = useState(null);

    // Map controls.
    const [selectedTimeRange, setSelectedTimeRange] = useState('live');
    const [showZones, setShowZones] = useState(true);
    const [showCameras, setShowCameras] = useState(true);
    const [showNestSites, setShowNestSites] = useState(true);

    // Start listening to the data source when the page loads, and stop when it closes.
    useEffect(function connectToDataSource()
    {
        const stopSnapshots = dataSource.subscribe(setSnapshot);
        const stopConnection = dataSource.subscribeToConnection(setConnectionState);
        const stopAlerts = dataSource.subscribeToAlerts(function handleAlert(alert)
        {
            setAlerts(function addAlert(current)
            {
                return [{ ...alert, receivedAt: Date.now() }, ...current].slice(0, maximumAlertsShown);
            });
        });

        return function disconnect()
        {
            stopSnapshots();
            stopConnection();
            stopAlerts();
        };
    }, []);

    // Drop alerts once they've been on screen long enough.
    useEffect(function expireAlerts()
    {
        if (alerts.length === 0)
        {
            return undefined;
        }

        const timer = setInterval(function removeOldAlerts()
        {
            setAlerts(function keepRecent(current)
            {
                return current.filter(function isRecent(alert)
                {
                    return Date.now() - alert.receivedAt < alertDisplayMilliseconds;
                });
            });
        }, 1000);

        return function stopTimer()
        {
            clearInterval(timer);
        };
    }, [alerts.length]);

    const nestSites = snapshot ? snapshot.nestSites : [];

    // Opens a nest site's log page, from a map pin, the sidebar list, or an alert.
    function openNestSite(nestIdentifier)
    {
        setSelectedNestIdentifier(nestIdentifier);
        setCurrentView('nest-log');
    }

    function dismissAlert(nestIdentifier)
    {
        setAlerts(function removeAlert(current)
        {
            return current.filter(function isOther(alert)
            {
                return alert.nestIdentifier !== nestIdentifier;
            });
        });
    }

    // Arriving on the log page with nothing chosen: open the newest site.
    function changeView(view)
    {
        if (view === 'nest-log' && selectedNestIdentifier === null && nestSites.length > 0)
        {
            setSelectedNestIdentifier(nestSites[0].nestIdentifier);
        }

        setCurrentView(view);
    }

    // Look up the selected pair and its zone. useMemo skips the search
    // unless the snapshot or the selection actually changed.
    const selectedPair = useMemo(function findSelectedPair()
    {
        if (!snapshot)
        {
            return null;
        }

        return snapshot.cameraPairs.find(function matchesSelection(cameraPair)
        {
            return cameraPair.pairIdentifier === selectedPairIdentifier;
        }) ?? null;
    }, [snapshot, selectedPairIdentifier]);

    const selectedZone = useMemo(function findSelectedZone()
    {
        if (!snapshot || !selectedPair)
        {
            return null;
        }

        return snapshot.zones.find(function matchesPairZone(zone)
        {
            return zone.zoneIdentifier === selectedPair.zoneIdentifier;
        }) ?? null;
    }, [snapshot, selectedPair]);

    // Still waiting on the first snapshot.
    if (!snapshot)
    {
        return (
            <p className="loading-message" role="status">
                {connectionState === 'disconnected' || connectionState === 'connecting'
                    ? 'Connecting to the dashboard backend… Start it with "npm run server" in the dashboard folder.'
                    : 'Connecting to cameras…'}
            </p>
        );
    }

    const isLive = snapshot.mode === 'live';
    const dataTag = isLive ? 'Synthetic live feed' : 'Sample data';

    return (
        <div className="app">
            <AppBar
                currentView={currentView}
                onChangeView={changeView}
                unprotectedSiteCount={countUnprotectedSites(nestSites)}
                onlineCameraCount={countOnlineCameras(snapshot.cameraPairs)}
                totalCameraCount={countAllCameras(snapshot.cameraPairs)}
            />

            {/* Each area is guarded separately, so one failure can't blank the dashboard. */}
            <ErrorBoundary name="Feed status">
                <FeedStatusBanner snapshot={snapshot} connectionState={connectionState} />
            </ErrorBoundary>

            <ErrorBoundary name="Alerts">
                <AlertToasts alerts={alerts} onOpen={openNestSite} onDismiss={dismissAlert} />
            </ErrorBoundary>

            {currentView === 'nest-log' && (
                <ErrorBoundary key={selectedNestIdentifier} name="Nest log">
                    <NestLogView
                        nestSites={nestSites}
                        zones={snapshot.zones}
                        dataTag={dataTag}
                        generatedAt={snapshot.generatedAt}
                        selectedNestIdentifier={selectedNestIdentifier}
                        onSelectNest={setSelectedNestIdentifier}
                        onAddPatrolEntry={dataSource.addPatrolEntry}
                        onClearPatrolEntries={dataSource.clearPatrolEntries}
                    />
                </ErrorBoundary>
            )}

            {currentView === 'map' && (
                <ErrorBoundary name="Map">
                    <main className="layout">
                        <section className="map-panel" aria-labelledby="map-heading">
                            <div className="map-panel__header">
                                <div className="map-panel__titles">
                                    <div className="map-panel__title-row">
                                        <h1 id="map-heading" className="map-panel__title">Beach activity</h1>
                                        <span className="sample-tag">{dataTag}</span>
                                    </div>
                                    <span className="map-panel__subtitle">
                                        Along Port Aransas Beach Road, from Sand Point to Ocean View Drive
                                        {isLive && ` · sites fade after ${snapshot.settings.fadeStartMinutes} min and leave the map after ${snapshot.settings.archiveAfterMinutes} min`}
                                    </span>
                                </div>
    
                                <MapControls
                                    selectedTimeRange={selectedTimeRange}
                                    onTimeRangeChange={setSelectedTimeRange}
                                    showZones={showZones}
                                    onToggleZones={function toggleZones()
                                    {
                                        setShowZones(!showZones);
                                    }}
                                    showCameras={showCameras}
                                    onToggleCameras={function toggleCameras()
                                    {
                                        setShowCameras(!showCameras);
                                    }}
                                    showNestSites={showNestSites}
                                    onToggleNestSites={function toggleNestSites()
                                    {
                                        setShowNestSites(!showNestSites);
                                    }}
                                />
                            </div>
    
                            <BeachMap
                                zones={snapshot.zones}
                                cameraPairs={snapshot.cameraPairs}
                                nestSites={nestSites}
                                selectedPairIdentifier={selectedPairIdentifier}
                                onSelectPair={setSelectedPairIdentifier}
                                onSelectNest={openNestSite}
                                showZones={showZones}
                                showCameras={showCameras}
                                showNestSites={showNestSites}
                            />
                        </section>
    
                        <aside className="sidebar">
                            <SelectedPairPanel cameraPair={selectedPair} zone={selectedZone} />
                            <NestSummaryPanel nestSites={nestSites} onOpenNest={openNestSite} />
                            <ZoneList zones={snapshot.zones} />
                            <CameraPairList
                                cameraPairs={snapshot.cameraPairs}
                                selectedPairIdentifier={selectedPairIdentifier}
                                onSelectPair={setSelectedPairIdentifier}
                            />
                        </aside>
                    </main>
                </ErrorBoundary>
            )}
        </div>
    );
}
