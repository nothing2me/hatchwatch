// Recorded footage from the camera relay: a list of video segments per
// camera, with an inline player for .mp4 files and downloads for all.
// Browsers can't play the .avi files saved when the server has no ffmpeg.

import { useEffect, useState } from 'react';
import { fetchRecordings, recordingUrl } from '../data/liveCameraClient.js';
import { formatDateTime } from '../utils/formatTime.js';

const refreshMilliseconds = 30_000;

// "4 min 12 s" or "38 s".
function formatLength(seconds)
{
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round(seconds % 60);
    return minutes > 0 ? `${minutes} min ${remainder} s` : `${remainder} s`;
}

function formatSize(bytes)
{
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

export default function RecordingsPanel({ accessKey, cameraIdentifiers })
{
    // '' means every camera.
    const [cameraFilter, setCameraFilter] = useState('');
    const [result, setResult] = useState(null);
    const [problem, setProblem] = useState(null);
    const [playingPath, setPlayingPath] = useState(null);

    useEffect(function loadRecordings()
    {
        let isActive = true;

        async function refresh()
        {
            try
            {
                const newResult = await fetchRecordings(accessKey, cameraFilter);

                if (isActive)
                {
                    setResult(newResult);
                    setProblem(null);
                }
            }
            catch
            {
                if (isActive)
                {
                    setProblem('Could not load recordings.');
                }
            }
        }

        refresh();
        const timer = setInterval(refresh, refreshMilliseconds);

        return function stopRefreshing()
        {
            isActive = false;
            clearInterval(timer);
        };
    }, [accessKey, cameraFilter]);

    const recordings = result?.recordings ?? [];

    return (
        <section className="panel recordings-panel">
            <div className="panel__header">
                <h2 className="panel__title">Recordings</h2>
                <label>
                    <span className="visually-hidden">Camera</span>
                    <select
                        className="recordings-panel__filter"
                        value={cameraFilter}
                        onChange={function chooseCamera(event)
                        {
                            setCameraFilter(event.target.value);
                            setPlayingPath(null);
                        }}
                    >
                        <option value="">All cameras</option>
                        {cameraIdentifiers.map(function renderOption(identifier)
                        {
                            return <option key={identifier} value={identifier}>{identifier}</option>;
                        })}
                    </select>
                </label>
            </div>

            {problem && <p className="patrol-form__error">{problem}</p>}
            {result && !result.enabled && <p className="panel__empty">Recording is turned off on the server.</p>}
            {result?.enabled && recordings.length === 0 && (
                <p className="panel__empty">No recordings yet. Video shows up here a few seconds after a camera's current segment ends.</p>
            )}

            {playingPath && (
                <video
                    key={playingPath}
                    className="recordings-panel__player"
                    src={recordingUrl(playingPath, accessKey)}
                    controls
                    autoPlay
                    playsInline
                />
            )}

            {recordings.length > 0 && (
                <ul className="recordings-panel__list">
                    {recordings.map(function renderRecording(recording)
                    {
                        const canPlay = recording.path.endsWith('.mp4');
                        const isPlaying = recording.path === playingPath;

                        return (
                            <li
                                key={recording.path}
                                className={isPlaying ? 'recordings-panel__row recordings-panel__row--playing' : 'recordings-panel__row'}
                            >
                                <span className="recordings-panel__camera">{recording.cameraIdentifier}</span>
                                <span className="recordings-panel__meta">
                                    {formatDateTime(recording.startedAt)} · {formatLength(recording.durationSeconds)} · {formatSize(recording.sizeBytes)}
                                </span>
                                <span className="recordings-panel__actions">
                                    {canPlay && (
                                        <button
                                            type="button"
                                            className="text-button"
                                            onClick={function togglePlayer()
                                            {
                                                setPlayingPath(isPlaying ? null : recording.path);
                                            }}
                                        >
                                            {isPlaying ? 'Close' : 'Play'}
                                        </button>
                                    )}
                                    <a className="text-button" href={recordingUrl(recording.path, accessKey, { download: true })}>
                                        Download
                                    </a>
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}

            {result?.enabled && !result.convertsToMp4 && recordings.length > 0 && (
                <p className="patrol-form__hint">
                    Saved as .avi, which browsers can't play; download to watch. Install ffmpeg on the server for playable .mp4 files.
                </p>
            )}
        </section>
    );
}
