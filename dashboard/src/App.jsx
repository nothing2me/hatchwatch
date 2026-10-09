// Top-level component: connects to the data source, keeps track of what
// the user has selected, and lays out the app bar, map, and sidebar.

import { useEffect, useMemo, useState } from 'react';
import { createSampleDataSource } from './data/dataSource.js';
import { countAllCameras, countOnlineCameras } from './utils/cameraStatus.js';
import AppBar from './components/AppBar.jsx';
import MapControls from './components/MapControls.jsx';
import BeachMap from './components/BeachMap.jsx';
import SelectedPairPanel from './components/SelectedPairPanel.jsx';
import ZoneList from './components/ZoneList.jsx';
import CameraPairList from './components/CameraPairList.jsx';

// Swap this line for the pipeline adapter data source once it exists
// (see data/dataSource.js and agent.md for the boundary rules).
const dataSource = createSampleDataSource();

export default function App()
{
    // The latest snapshot of the beach from the data source (null until the first one arrives).
    const [snapshot, setSnapshot] = useState(null);

    // Which camera pair the user is looking at. Starts on pair B (Holiday Beach).
    const [selectedPairIdentifier, setSelectedPairIdentifier] = useState('B');

    // Map controls.
    const [selectedTimeRange, setSelectedTimeRange] = useState('live');
    const [showZones, setShowZones] = useState(true);
    const [showCameras, setShowCameras] = useState(true);

    // Start listening to the data source when the page loads, and stop when it closes.
    useEffect(function connectToDataSource()
    {
        const unsubscribe = dataSource.subscribe(function handleSnapshot(newSnapshot)
        {
            setSnapshot(newSnapshot);
        });

        return unsubscribe;
    }, []);

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
                onlineCameraCount={countOnlineCameras(snapshot.cameraPairs)}
                totalCameraCount={countAllCameras(snapshot.cameraPairs)}
            />

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
                        />
                    </div>

                    <BeachMap
                        zones={snapshot.zones}
                        cameraPairs={snapshot.cameraPairs}
                        selectedPairIdentifier={selectedPairIdentifier}
                        onSelectPair={setSelectedPairIdentifier}
                        showZones={showZones}
                        showCameras={showCameras}
                    />
                </section>

                <aside className="sidebar">
                    <SelectedPairPanel cameraPair={selectedPair} zone={selectedZone} />
                    <ZoneList zones={snapshot.zones} />
                    <CameraPairList
                        cameraPairs={snapshot.cameraPairs}
                        selectedPairIdentifier={selectedPairIdentifier}
                        onSelectPair={setSelectedPairIdentifier}
                    />
                </aside>
            </main>
        </div>
    );
}
