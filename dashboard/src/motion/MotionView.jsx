// The motion page (motion.html, served at /motion?camera=B1): one camera's
// live feed next to the motion difference worked out from that feed.
//
// The difference is computed here in the browser from the same frames the
// live feed shows. Two ways to compare:
//   - "Since last frame": what changed between consecutive frames.
//   - "Against background": what differs from a slowly updated picture of
//     the empty scene, so something that stops moving stays visible a while.

import { useEffect, useRef, useState } from 'react';
import { sampleSnapshot } from '../data/sampleData.js';
import { AccessKeyError, fetchLiveCameras, loadAccessKey, saveAccessKey } from '../data/liveCameraClient.js';
import { useLiveFrame } from '../data/useLiveFrame.js';
import { isSameFrame, paintDifference, toBlurredGray, updateBackground } from './motionDifference.js';

// Width the difference is computed at; height follows the camera's shape.
const analysisWidth = 320;
const analysisMilliseconds = 100;
// Fetch frames at least as fast as the fastest phone setting sends them.
const liveFramesPerSecond = 10;
const statusRefreshMilliseconds = 3000;
// How quickly the background adopts the current picture, per new frame.
const backgroundLearningRate = 0.03;

const cameraIdentifiers = sampleSnapshot.cameraPairs.flatMap(function listPairCameras(cameraPair)
{
    return cameraPair.cameras.map(function getIdentifier(camera)
    {
        return camera.cameraIdentifier;
    });
});

function cameraFromAddress()
{
    const requested = new URLSearchParams(window.location.search).get('camera');
    return cameraIdentifiers.includes(requested) ? requested : cameraIdentifiers[0];
}

export default function MotionView()
{
    const [accessKey, setAccessKey] = useState(loadAccessKey);
    const [draftKey, setDraftKey] = useState('');
    const [cameraIdentifier, setCameraIdentifier] = useState(cameraFromAddress);
    // null until the relay answers, then true or false.
    const [isOnline, setIsOnline] = useState(null);
    const [problem, setProblem] = useState(null);

    const [mode, setMode] = useState('background');
    const [threshold, setThreshold] = useState(20);
    const [motionShare, setMotionShare] = useState(0);

    const frameUrl = useLiveFrame(cameraIdentifier, accessKey, { framesPerSecond: liveFramesPerSecond, enabled: Boolean(isOnline) });
    const liveImageRef = useRef(null);
    const differenceCanvasRef = useRef(null);
    // The analysis loop reads settings through refs so it never restarts.
    const settingsRef = useRef({ mode, threshold });
    settingsRef.current = { mode, threshold };
    // Previous frame and background, reset when the camera or picture size changes.
    const historyRef = useRef({ previous: null, background: null, width: 0, height: 0 });

    // Ask the relay whether the chosen camera is sending.
    useEffect(function pollCameraStatus()
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
                    const camera = cameras.find(function matches(candidate)
                    {
                        return candidate.cameraIdentifier === cameraIdentifier;
                    });
                    setIsOnline(Boolean(camera?.online));
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
        const timer = setInterval(refresh, statusRefreshMilliseconds);

        return function stopPolling()
        {
            isActive = false;
            clearInterval(timer);
        };
    }, [accessKey, cameraIdentifier]);

    // Start fresh whenever the camera changes.
    useEffect(function resetHistory()
    {
        historyRef.current = { previous: null, background: null, width: 0, height: 0 };
        setMotionShare(0);
    }, [cameraIdentifier]);

    // Copy the live picture into a small canvas several times a second and
    // paint its difference. Skips checks where no new frame has arrived.
    useEffect(function analyzeFeed()
    {
        if (!isOnline)
        {
            return undefined;
        }

        const sampleCanvas = document.createElement('canvas');
        const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });

        const timer = setInterval(function analyzeFrame()
        {
            const image = liveImageRef.current;
            const differenceCanvas = differenceCanvasRef.current;

            if (!image || !differenceCanvas || !image.naturalWidth)
            {
                return;
            }

            const width = analysisWidth;
            const height = Math.round(analysisWidth * image.naturalHeight / image.naturalWidth);
            const history = historyRef.current;

            // A new picture size, or a canvas re-created after the camera dropped out.
            if (history.width !== width || history.height !== height || differenceCanvas.width !== width || differenceCanvas.height !== height)
            {
                sampleCanvas.width = differenceCanvas.width = width;
                sampleCanvas.height = differenceCanvas.height = height;
                historyRef.current = { previous: null, background: null, width, height };
            }

            sampleContext.drawImage(image, 0, 0, width, height);
            const frame = toBlurredGray(sampleContext.getImageData(0, 0, width, height).data, width, height);
            const current = historyRef.current;

            if (isSameFrame(current.previous, frame))
            {
                return;
            }

            if (!current.previous)
            {
                current.previous = frame;
                current.background = frame.slice();
                return;
            }

            const { mode: currentMode, threshold: currentThreshold } = settingsRef.current;
            const reference = currentMode === 'previous' ? current.previous : current.background;
            const differenceContext = differenceCanvas.getContext('2d');
            const output = differenceContext.createImageData(width, height);
            const share = paintDifference(frame, reference, output.data, currentThreshold);
            differenceContext.putImageData(output, 0, 0);

            // Keep the background learning in both modes, so switching is instant.
            updateBackground(current.background, frame, backgroundLearningRate);
            current.previous = frame;
            setMotionShare(share);
        }, analysisMilliseconds);

        return function stopAnalyzing()
        {
            clearInterval(timer);
        };
    }, [isOnline, cameraIdentifier]);

    function chooseCamera(event)
    {
        const chosen = event.target.value;
        setCameraIdentifier(chosen);
        setIsOnline(null);
        window.history.replaceState(null, '', `?camera=${encodeURIComponent(chosen)}`);
    }

    function resetBackground()
    {
        const history = historyRef.current;
        history.background = history.previous ? history.previous.slice() : null;
    }

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
            <main className="motion-view">
                <form className="panel patrol-form motion-view__key-form" onSubmit={submitKey}>
                    <h1 className="panel__title">Motion view</h1>
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
                    <button type="submit" className="primary-button">Show camera</button>
                </form>
            </main>
        );
    }

    const motionPercent = (motionShare * 100).toFixed(1);
    const placeholder = isOnline === false ? 'No signal' : 'Connecting…';

    return (
        <main className="motion-view">
            <header className="motion-view__header">
                <a className="text-button" href="/">← Dashboard</a>
                <h1 className="map-panel__title">Motion view</h1>
                <label className="motion-view__control">
                    Camera
                    <select value={cameraIdentifier} onChange={chooseCamera}>
                        {cameraIdentifiers.map(function renderOption(identifier)
                        {
                            return <option key={identifier} value={identifier}>{identifier}</option>;
                        })}
                    </select>
                </label>
                {problem && <p className="patrol-form__error">{problem}</p>}
            </header>

            <div className="motion-view__screens">
                <section className="motion-view__screen" aria-labelledby="live-heading">
                    <h2 id="live-heading" className="motion-view__screen-title">
                        <span className={`status-dot status-dot--${isOnline ? 'good' : 'bad'}`} aria-hidden="true" />
                        Live feed · {cameraIdentifier}
                    </h2>
                    {isOnline && frameUrl ? (
                        <img
                            ref={liveImageRef}
                            className="motion-view__picture"
                            src={frameUrl}
                            alt={`Live feed from camera ${cameraIdentifier}`}
                        />
                    ) : (
                        <div className="motion-view__picture motion-view__placeholder">{placeholder}</div>
                    )}
                </section>

                <section className="motion-view__screen" aria-labelledby="motion-heading">
                    <h2 id="motion-heading" className="motion-view__screen-title">
                        Motion difference · {mode === 'previous' ? 'since last frame' : 'against background'}
                    </h2>
                    {isOnline ? (
                        <canvas
                            ref={differenceCanvasRef}
                            className="motion-view__picture"
                            role="img"
                            aria-label={`Motion in ${motionPercent}% of the picture`}
                        />
                    ) : (
                        <div className="motion-view__picture motion-view__placeholder">{placeholder}</div>
                    )}
                </section>
            </div>

            <section className="panel motion-view__controls">
                <div className="motion-view__meter">
                    <span>Motion: <strong>{motionPercent}%</strong> of the picture</span>
                    <span className="motion-view__meter-track" aria-hidden="true">
                        <span className="motion-view__meter-fill" style={{ width: `${Math.min(100, motionShare * 400)}%` }} />
                    </span>
                </div>

                <div className="segmented-control" role="group" aria-label="Compare with">
                    {[['background', 'Against background'], ['previous', 'Since last frame']].map(function renderMode([value, label])
                    {
                        return (
                            <button
                                key={value}
                                type="button"
                                aria-pressed={mode === value}
                                className={mode === value ? 'segmented-control__button segmented-control__button--selected' : 'segmented-control__button'}
                                onClick={function chooseMode()
                                {
                                    setMode(value);
                                }}
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>

                <label className="motion-view__control motion-view__slider">
                    Sensitivity threshold: {threshold}
                    <input
                        type="range"
                        min="5"
                        max="80"
                        value={threshold}
                        onChange={function changeThreshold(event)
                        {
                            setThreshold(Number(event.target.value));
                        }}
                    />
                    <span className="patrol-form__hint">Lower shows smaller changes, and more noise.</span>
                </label>

                {mode === 'background' && (
                    <button type="button" className="text-button" onClick={resetBackground}>
                        Reset background to the current picture
                    </button>
                )}
            </section>
        </main>
    );
}
