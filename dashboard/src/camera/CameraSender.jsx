// The page a phone opens at /camera to act as one beach camera. It takes
// frames from the back camera, compresses them to JPEG, and sends them to
// the camera relay, which passes them on to everyone watching the dashboard.
//
// Browsers only allow camera access on HTTPS pages (or localhost).

import { useEffect, useRef, useState } from 'react';
import { sampleSnapshot } from '../data/sampleData.js';
import { AccessKeyError, loadAccessKey, saveAccessKey, sendFrame } from '../data/liveCameraClient.js';

const cameraStorageName = 'nesttrace.cameraIdentifier';

// Every camera position on the map, so the phone can take one of them over.
const cameraIdentifiers = sampleSnapshot.cameraPairs.flatMap(function listPairCameras(cameraPair)
{
    return cameraPair.cameras.map(function getIdentifier(camera)
    {
        return camera.cameraIdentifier;
    });
});

// Trade picture quality against mobile data and battery.
const qualityPresets =
{
    saver: { label: 'Data saver (2 fps)', width: 640, framesPerSecond: 2, jpegQuality: 0.6 },
    standard: { label: 'Standard (5 fps)', width: 960, framesPerSecond: 5, jpegQuality: 0.7 },
    smooth: { label: 'Smooth (10 fps)', width: 1280, framesPerSecond: 10, jpegQuality: 0.7 },
};

function loadSavedCamera()
{
    try
    {
        return localStorage.getItem(cameraStorageName) ?? cameraIdentifiers[0];
    }
    catch
    {
        return cameraIdentifiers[0];
    }
}

function wait(milliseconds)
{
    return new Promise(function resolveLater(resolve)
    {
        setTimeout(resolve, milliseconds);
    });
}

export default function CameraSender()
{
    const [cameraIdentifier, setCameraIdentifier] = useState(loadSavedCamera);
    const [accessKey, setAccessKey] = useState(loadAccessKey);
    const [qualityName, setQualityName] = useState('standard');
    const [isRunning, setIsRunning] = useState(false);
    const [framesSent, setFramesSent] = useState(0);
    const [viewerCount, setViewerCount] = useState(0);
    const [message, setMessage] = useState(null);

    const videoRef = useRef(null);
    const mediaStreamRef = useRef(null);
    const wakeLockRef = useRef(null);
    // The send loop checks this between frames; a counter so a stale loop never keeps going after a restart.
    const runIdRef = useRef(0);

    async function keepScreenOn()
    {
        try
        {
            wakeLockRef.current = await navigator.wakeLock?.request('screen');
        }
        catch
        {
            // Not supported or refused: the phone may dim, and the browser may pause the camera.
        }
    }

    function stop()
    {
        runIdRef.current += 1;
        mediaStreamRef.current?.getTracks().forEach(function stopTrack(track)
        {
            track.stop();
        });
        mediaStreamRef.current = null;
        wakeLockRef.current?.release().catch(function ignore() {});
        wakeLockRef.current = null;
        setIsRunning(false);
    }

    async function start(event)
    {
        event.preventDefault();
        setMessage(null);

        if (!window.isSecureContext || !navigator.mediaDevices)
        {
            setMessage({ tone: 'bad', text: 'The camera only works over HTTPS. Open this page with an https:// address.' });
            return;
        }

        const preset = qualityPresets[qualityName];
        let mediaStream;

        try
        {
            mediaStream = await navigator.mediaDevices.getUserMedia(
            {
                audio: false,
                video: { facingMode: { ideal: 'environment' }, width: { ideal: preset.width } },
            });
        }
        catch (error)
        {
            setMessage({ tone: 'bad', text: `Could not open the camera: ${error.message}` });
            return;
        }

        saveAccessKey(accessKey);
        try
        {
            localStorage.setItem(cameraStorageName, cameraIdentifier);
        }
        catch
        {
            // Not remembered; nothing else depends on it.
        }

        mediaStreamRef.current = mediaStream;
        const video = videoRef.current;
        video.srcObject = mediaStream;
        await video.play();
        await keepScreenOn();

        setFramesSent(0);
        setIsRunning(true);
        runIdRef.current += 1;
        sendFrames(runIdRef.current, preset);
    }

    async function sendFrames(runId, preset)
    {
        const video = videoRef.current;
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const frameInterval = 1000 / preset.framesPerSecond;

        while (runIdRef.current === runId)
        {
            const startedAt = performance.now();

            // Scale down to the preset width, keeping the camera's shape.
            const scale = Math.min(1, preset.width / (video.videoWidth || preset.width));
            canvas.width = Math.round((video.videoWidth || preset.width) * scale);
            canvas.height = Math.round((video.videoHeight || preset.width * 0.75) * scale);
            context.drawImage(video, 0, 0, canvas.width, canvas.height);

            const jpeg = await new Promise(function encode(resolve)
            {
                canvas.toBlob(resolve, 'image/jpeg', preset.jpegQuality);
            });

            try
            {
                const viewers = await sendFrame(cameraIdentifier, accessKey, jpeg);
                setViewerCount(viewers);
                setFramesSent(function increment(count)
                {
                    return count + 1;
                });
                setMessage(null);
            }
            catch (error)
            {
                if (error instanceof AccessKeyError)
                {
                    setMessage({ tone: 'bad', text: 'Wrong access key. Check it and start again.' });
                    stop();
                    return;
                }

                setMessage({ tone: 'warning', text: 'Connection lost. Retrying…' });
                await wait(2000);
                continue;
            }

            // Wait out the rest of the frame interval (sending may have used it all).
            await wait(Math.max(0, frameInterval - (performance.now() - startedAt)));
        }
    }

    // The wake lock drops whenever the page is hidden; take it back on return.
    useEffect(function reacquireWakeLock()
    {
        function handleVisibilityChange()
        {
            if (document.visibilityState === 'visible' && mediaStreamRef.current)
            {
                keepScreenOn();
            }
        }

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return function cleanUp()
        {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    // Release the camera if the page is closed while sending.
    useEffect(function stopOnClose()
    {
        return stop;
    }, []);

    return (
        <main className="camera-sender">
            <header className="camera-sender__header">
                <h1 className="panel__title">NestTrace camera</h1>
                {isRunning
                    ? <span className="status-badge status-badge--good">Live as {cameraIdentifier}</span>
                    : <span className="status-badge status-badge--neutral">Not sending</span>}
            </header>

            <video ref={videoRef} className="camera-sender__preview" hidden={!isRunning} muted playsInline />

            {isRunning ? (
                <section className="panel">
                    <p className="panel__empty">
                        {framesSent} frames sent · {viewerCount} {viewerCount === 1 ? 'person' : 'people'} watching.
                        Keep this page open with the screen on and the phone charging.
                    </p>
                    {message && <p className={`camera-sender__message camera-sender__message--${message.tone}`}>{message.text}</p>}
                    <button type="button" className="primary-button" onClick={stop}>Stop camera</button>
                </section>
            ) : (
                <form className="panel patrol-form camera-sender__form" onSubmit={start}>
                    <div className="patrol-form__fields">
                        <label className="patrol-form__field">
                            Camera position
                            <select value={cameraIdentifier} onChange={function chooseCamera(event)
                            {
                                setCameraIdentifier(event.target.value);
                            }}>
                                {cameraIdentifiers.map(function renderOption(identifier)
                                {
                                    return <option key={identifier} value={identifier}>{identifier}</option>;
                                })}
                            </select>
                        </label>
                        <label className="patrol-form__field">
                            Quality
                            <select value={qualityName} onChange={function chooseQuality(event)
                            {
                                setQualityName(event.target.value);
                            }}>
                                {Object.entries(qualityPresets).map(function renderOption([name, preset])
                                {
                                    return <option key={name} value={name}>{preset.label}</option>;
                                })}
                            </select>
                        </label>
                        <label className="patrol-form__field">
                            Access key
                            <input
                                type="password"
                                required
                                autoComplete="current-password"
                                value={accessKey}
                                onChange={function typeKey(event)
                                {
                                    setAccessKey(event.target.value);
                                }}
                            />
                        </label>
                    </div>
                    {message && <p className={`camera-sender__message camera-sender__message--${message.tone}`}>{message.text}</p>}
                    <button type="submit" className="primary-button">Start camera</button>
                </form>
            )}
        </main>
    );
}
