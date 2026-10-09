// The map: the beach image with an SVG layer on top that draws the
// activity zones, each camera's field of view, and the camera icons.
//
// The SVG uses the image's pixel size as its viewBox, so every coordinate
// in the data lines up with the image at any screen size.

import { mapConfig } from '../config/mapConfig.js';
import { activityLevels } from '../config/activityLevels.js';
import { protectionStatuses } from '../config/nestStatuses.js';
import { buildFieldOfViewPath, buildPolygonPointsText } from '../utils/geometry.js';
import { summarizeNestSite } from '../utils/nestStatus.js';
import MapLegend from './MapLegend.jsx';

export default function BeachMap(
{
    zones,
    cameraPairs,
    nestSites,
    selectedPairIdentifier,
    onSelectPair,
    onSelectNest,
    showZones,
    showCameras,
    showNestSites,
})
{
    return (
        <div className="beach-map" style={{ aspectRatio: `${mapConfig.imageWidth} / ${mapConfig.imageHeight}` }}>
            <img className="beach-map__image" src={mapConfig.imageSource} alt={mapConfig.imageDescription} />

            <svg
                className="beach-map__overlay"
                viewBox={`0 0 ${mapConfig.imageWidth} ${mapConfig.imageHeight}`}
                role="group"
                aria-label="Activity zones and camera pairs along the beach"
            >
                {showZones && <ZoneLayer zones={zones} />}

                {showCameras && (
                    <CameraLayer
                        cameraPairs={cameraPairs}
                        selectedPairIdentifier={selectedPairIdentifier}
                        onSelectPair={onSelectPair}
                    />
                )}

                {/* Drawn last so nest pins sit on top and stay clickable. */}
                {showNestSites && <NestSiteLayer nestSites={nestSites} onSelectNest={onSelectNest} />}
            </svg>

            <MapLegend />
            <span className="beach-map__attribution">{mapConfig.attribution}</span>
        </div>
    );
}

// Draws every zone as a see-through colored shape with its letter in the middle.
function ZoneLayer({ zones })
{
    return (
        <g aria-hidden="true">
            {zones.map(function renderZone(zone)
            {
                const level = activityLevels[zone.activityLevel];

                return (
                    <g key={zone.zoneIdentifier}>
                        <polygon
                            points={buildPolygonPointsText(zone.outlinePoints)}
                            fill={level.mapFill}
                            fillOpacity="0.5"
                            stroke={level.mapStroke}
                            strokeWidth="2"
                        />
                        <circle cx={zone.labelPosition.x} cy={zone.labelPosition.y} r="13" fill="#FFFFFF" stroke={level.mapStroke} strokeWidth="2" />
                        <text x={zone.labelPosition.x} y={zone.labelPosition.y + 5} className="beach-map__zone-letter">
                            {zone.zoneIdentifier}
                        </text>
                    </g>
                );
            })}
        </g>
    );
}

// Draws every camera pair: the two viewing cones first (so they sit under
// the icons), then the two camera icons with their labels.
function CameraLayer({ cameraPairs, selectedPairIdentifier, onSelectPair })
{
    return (
        <g>
            {cameraPairs.map(function renderCameraPair(cameraPair)
            {
                const isSelected = cameraPair.pairIdentifier === selectedPairIdentifier;

                return (
                    <g key={cameraPair.pairIdentifier}>
                        {cameraPair.cameras.map(function renderFieldOfView(camera)
                        {
                            return (
                                <path
                                    key={`${camera.cameraIdentifier}-view`}
                                    d={buildFieldOfViewPath(camera)}
                                    className={isSelected ? 'field-of-view field-of-view--selected' : 'field-of-view'}
                                    aria-hidden="true"
                                />
                            );
                        })}

                        {cameraPair.cameras.map(function renderCameraIcon(camera)
                        {
                            return (
                                <CameraMarker
                                    key={camera.cameraIdentifier}
                                    camera={camera}
                                    pairName={cameraPair.name}
                                    isSelected={isSelected}
                                    onSelect={function handleSelect()
                                    {
                                        onSelectPair(cameraPair.pairIdentifier);
                                    }}
                                />
                            );
                        })}
                    </g>
                );
            })}
        </g>
    );
}

// Draws a pin at every nest site still on the live map, colored by its
// protection status and fading as it ages (visibility comes from the
// backend; sample sites have none and stay solid). Sites where activity is
// still going on get an extra ring. Clicking a pin opens that site's log.
function NestSiteLayer({ nestSites, onSelectNest })
{
    // Oldest first, so the newest pins are drawn on top.
    const visibleSites = nestSites
        .filter(function isOnMap(nestSite)
        {
            return nestSite.visibility !== 0 && !summarizeNestSite(nestSite).isArchived;
        })
        .reverse();

    return (
        <g>
            {visibleSites.map(function renderNestPin(nestSite)
            {
                const summary = summarizeNestSite(nestSite);
                const protection = protectionStatuses[summary.protectionStatus];
                const opacity = nestSite.visibility ?? 1;

                function handleKeyDown(keyboardEvent)
                {
                    if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ')
                    {
                        keyboardEvent.preventDefault();
                        onSelectNest(nestSite.nestIdentifier);
                    }
                }

                return (
                    <g
                        key={nestSite.nestIdentifier}
                        className="nest-pin"
                        opacity={opacity}
                        transform={`translate(${nestSite.position.x} ${nestSite.position.y})`}
                        role="button"
                        tabIndex={0}
                        aria-label={`Nest site ${nestSite.nestIdentifier}, ${protection.label}${summary.isOnSite ? ', activity on site now' : ''}`}
                        onClick={function handleClick()
                        {
                            onSelectNest(nestSite.nestIdentifier);
                        }}
                        onKeyDown={handleKeyDown}
                    >
                        <title>{`${nestSite.nestIdentifier} · ${protection.label}`}</title>
                        {summary.isOnSite && <circle r="15" className="nest-pin__on-site-ring" stroke={protection.pinFill} />}
                        {/* Single-camera sites get a dashed outline: they need review. */}
                        <circle
                            r="7"
                            fill={protection.pinFill}
                            stroke="#FFFFFF"
                            strokeWidth="2"
                            strokeDasharray={nestSite.evidenceTier === 'single_camera' ? '3 2' : undefined}
                        />
                    </g>
                );
            })}
        </g>
    );
}

// One camera icon. Clicking it (or pressing Enter / Space when focused)
// selects the camera's whole pair.
function CameraMarker({ camera, pairName, isSelected, onSelect })
{
    const isOnline = camera.status === 'online';

    function handleKeyDown(keyboardEvent)
    {
        if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ')
        {
            // Stop the page from scrolling when Space is pressed.
            keyboardEvent.preventDefault();
            onSelect();
        }
    }

    return (
        <g
            className="camera-marker"
            transform={`translate(${camera.position.x} ${camera.position.y})`}
            role="button"
            tabIndex={0}
            aria-label={`Camera ${camera.cameraIdentifier}, ${pairName}, ${camera.facingDescription}, ${camera.status}`}
            aria-pressed={isSelected}
            onClick={onSelect}
            onKeyDown={handleKeyDown}
        >
            {/* Orange ring shows which pair is selected */}
            {isSelected && <circle r="21" fill="none" stroke="#E2581F" strokeWidth="3" />}

            <circle r="14" fill={isOnline ? '#0F2C3F' : '#7D8A92'} stroke="#FFFFFF" strokeWidth="2.5" />

            {/* Video camera glyph; a slash is added when the camera is offline */}
            <g fill="none" stroke="#FFFFFF" strokeWidth="1.6" strokeLinejoin="round">
                <rect x="-8" y="-5" width="10" height="10" rx="2" />
                <path d="M2,-2 L7,-5 L7,5 L2,2" />
                {!isOnline && <path d="M-9,-9 L9,9" />}
            </g>

            <text x="-22" y="5" className={isOnline ? 'camera-marker__label' : 'camera-marker__label camera-marker__label--offline'}>
                {camera.cameraIdentifier}
            </text>
        </g>
    );
}
