// The Cameras page: a live tile for every camera position on the map.
// Feeds come from the camera relay (server/server.mjs); any phone that
// opens /camera and picks a position shows up here within a few seconds.

import { useEffect, useState } from 'react';
import { AccessKeyError, fetchLiveCameras, loadAccessKey, saveAccessKey, streamUrl } from '../data/liveCameraClient.js';
import { formatDateTime } from '../utils/formatTime.js';
import RecordingsPanel from './RecordingsPanel.jsx';

const refreshMilliseconds = 3000;

export default function CamerasView({ cameraPairs })
{
    const [accessKey, setAccessKey] = useState(loadAccessKey);
    const [draftKey, setDraftKey] = useState('');
    // cameraIdentifier -> status from the relay, or null before the first answer.
    const [liveCameras, setLiveCameras] = useState(null);
    const [problem, setProblem] = useState(null);

    // Ask the relay which cameras are sending, every few seconds.
    useEffect(function pollRelay()
    {
        if (!accessKey)
        {
            return undefined;
        }

        let isActive = true;

        async function refresh()
        {
            try
            {
                const cameras = await fetchLiveCameras(accessKey);

                if (isActive)
                {
                    setLiveCameras(new Map(cameras.map(function byIdentifier(camera)
                    {
                        return [camera.cameraIdentifier, camera];
                    })));
                    setProblem(null);
                }
            }
            catch (error)
            {
                if (!isActive)
                {
                    return;
                }

                if (error instanceof AccessKeyError)
                {
                    setAccessKey('');
                    setProblem('That access key was not accepted.');
                }
                else
                {
                    setProblem('Cannot reach the camera relay. Is the server running?');
                }
            }
        }

        refresh();
        const timer = setInterval(refresh, refreshMilliseconds);

        return function stopPolling()
        {
            isActive = false;
            clearInterval(timer);
        };
    }, [accessKey]);

    function submitKey(event)
    {
        event.preventDefault();
        saveAccessKey(draftKey);
        setAccessKey(draftKey);
        setDraftKey('');
        setProblem(null);
    }

    if (!accessKey)
    {
        return (
            <main className="cameras-view">
                <form className="panel patrol-form cameras-view__key-form" onSubmit={submitKey}>
                    <h1 className="panel__title">Live cameras</h1>
                    <p className="patrol-form__hint">Enter the team access key to watch the camera feeds.</p>
                    {problem && <p className="patrol-form__error">{problem}</p>}
                    <label className="patrol-form__field">
                        Access key
                        <input
                            type="password"
                            required
                            autoComplete="current-password"
                            value={draftKey}
                            onChange={function typeKey(event)
                            {
                                setDraftKey(event.target.value);
                            }}
                        />
                    </label>
                    <button type="submit" className="primary-button">Show cameras</button>
                </form>
            </main>
        );
    }

    return (
        <main className="cameras-view">
            <div className="cameras-view__header">
                <h1 className="map-panel__title">Live cameras</h1>
                <span className="map-panel__subtitle">
                    To add a phone, open <strong>{window.location.origin}/camera</strong> on it and pick a position.
                </span>
                {problem && <p className="patrol-form__error">{problem}</p>}
            </div>

            {cameraPairs.map(function renderPair(cameraPair)
            {
                return (
                    <section key={cameraPair.pairIdentifier} className="panel">
                        <h2 className="panel__title">Pair {cameraPair.pairIdentifier}: {cameraPair.name}</h2>
                        <div className="camera-feeds">
                            {cameraPair.cameras.map(function renderCamera(camera)
                            {
                                const live = liveCameras?.get(camera.cameraIdentifier);

                                return (
                                    <div key={camera.cameraIdentifier} className="camera-feed">
                                        {live?.online ? (
                                            <div className="camera-feed__live">
                                                {live.recording && <span className="camera-feed__recording">REC</span>}
                                                <img
                                                    className="camera-feed__screen camera-feed__video"
                                                    src={streamUrl(camera.cameraIdentifier, accessKey)}
                                                    alt={`Live feed from camera ${camera.cameraIdentifier}`}
                                                />
                                            </div>
                                        ) : (
                                            <div className="camera-feed__screen">
                                                {liveCameras === null ? 'Connecting…' : 'No signal'}
                                            </div>
                                        )}
                                        <span className="camera-feed__caption">
                                            <span className={`status-dot status-dot--${live?.online ? 'good' : 'bad'}`} aria-hidden="true" />
                                            {' '}{camera.cameraIdentifier}, {camera.facingDescription}
                                            {live && !live.online && ` · last frame ${formatDateTime(live.lastFrameTime)}`}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                );
            })}

            <RecordingsPanel
                accessKey={accessKey}
                cameraIdentifiers={cameraPairs.flatMap(function listPairCameras(cameraPair)
                {
                    return cameraPair.cameras.map(function getIdentifier(camera)
                    {
                        return camera.cameraIdentifier;
                    });
                })}
            />

            <button
                type="button"
                className="text-button"
                onClick={function forgetKey()
                {
                    saveAccessKey('');
                    setAccessKey('');
                }}
            >
                Forget access key on this device
            </button>
        </main>
    );
}
