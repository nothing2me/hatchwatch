// Top-level component: connects to the data source, keeps track of what
// the user has selected, and lays out the app bar, map, and sidebar.

import { useEffect, useMemo, useState } from 'react';
import { createSampleDataSource } from './data/dataSource.js';
import { createLocalNestLogStore } from './data/nestLogStore.js';
import { sampleNestSites } from './data/sampleNestLog.js';
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
import CamerasView from './components/CamerasView.jsx';

// Swap this line for the pipeline adapter data source once it exists
// (see data/dataSource.js and agent.md for the boundary rules).
const dataSource = createSampleDataSource();

// Nest sites and their logs. Swap for a backend store with the same
// methods so every patrol shares one log (see data/nestLogStore.js).
const nestLogStore = createLocalNestLogStore(sampleNestSites);

export default function App()
{
    // The latest snapshot of the beach from the data source (null until the first one arrives).
    const [snapshot, setSnapshot] = useState(null);

    // Which camera pair the user is looking at. Starts on pair B (Holiday Beach).
    const [selectedPairIdentifier, setSelectedPairIdentifier] = useState('B');

    // Which page is showing ("map", "nest-log", or "cameras"), and which nest site is open.
    const [currentView, setCurrentView] = useState('map');
    const [nestSites, setNestSites] = useState([]);
    const [selectedNestIdentifier, setSelectedNestIdentifier] = useState(null);

    // Map controls.
    const [selectedTimeRange, setSelectedTimeRange] = useState('live');
    const [showZones, setShowZones] = useState(true);
    const [showCameras, setShowCameras] = useState(true);
    const [showNestSites, setShowNestSites] = useState(true);

    // Start listening to the data source when the page loads, and stop when it closes.
    useEffect(function connectToDataSource()
    {
        const unsubscribe = dataSource.subscribe(function handleSnapshot(newSnapshot)
        {
            setSnapshot(newSnapshot);
        });

        return unsubscribe;
    }, []);

    // Same for the nest log, which updates whenever a patrol adds an entry.
    useEffect(function connectToNestLog()
    {
        return nestLogStore.subscribe(setNestSites);
    }, []);

    // Opens a nest site's log page, from a map pin or the sidebar list.
    function openNestSite(nestIdentifier)
    {
        setSelectedNestIdentifier(nestIdentifier);
        setCurrentView('nest-log');
    }

    // Arriving on the log page with nothing chosen: open the first site.
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
        return <p className="loading-message">Connecting to cameras…</p>;
    }

    return (
        <div className="app">
            <AppBar
                currentView={currentView}
                onChangeView={changeView}
                unprotectedSiteCount={countUnprotectedSites(nestSites)}
                onlineCameraCount={countOnlineCameras(snapshot.cameraPairs)}
                totalCameraCount={countAllCameras(snapshot.cameraPairs)}
            />

            {currentView === 'nest-log' && (
                <NestLogView
                    nestSites={nestSites}
                    zones={snapshot.zones}
                    selectedNestIdentifier={selectedNestIdentifier}
                    onSelectNest={setSelectedNestIdentifier}
                    onAddPatrolEntry={nestLogStore.addPatrolEntry}
                    onClearPatrolEntries={nestLogStore.clearPatrolEntries}
                />
            )}

            {currentView === 'cameras' && (
                <CamerasView cameraPairs={snapshot.cameraPairs} />
            )}

            {currentView === 'map' && (
                <main className="layout">
                    <section className="map-panel" aria-labelledby="map-heading">
                        <div className="map-panel__header">
                            <div className="map-panel__titles">
                                <div className="map-panel__title-row">
                                    <h1 id="map-heading" className="map-panel__title">Beach activity</h1>
                                    <span className="sample-tag">Sample data</span>
                                </div>
                                <span className="map-panel__subtitle">
                                    Along Port Aransas Beach Road, from Sand Point to Ocean View Drive
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
            )}
        </div>
    );
}
