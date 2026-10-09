// A thin bar under the app bar that says whether live data is flowing:
// backend unreachable, waiting for the first chunk, or how long since the
// last chunk arrived. Hidden in sample mode.

import { formatDateTime } from '../utils/formatTime.js';

// A chunk normally lands every couple of minutes; after this, warn.
const staleFeedMinutes = 8;

// "daylight" or "very dark", from the most recent footage on the beach.
function renderingLabel(snapshot)
{
    const feeds = snapshot.cameraPairs
        .map(function getFeed(cameraPair)
        {
            return cameraPair.feed;
        })
        .filter(Boolean)
        .sort(function newestFirst(first, second)
        {
            return second.sequence - first.sequence;
        });

    return feeds.length > 0 && feeds[0].rendering === 'synthetic-very-dark' ? 'very dark' : 'daylight';
}

export default function FeedStatusBanner({ snapshot, connectionState })
{
    if (snapshot.mode !== 'live')
    {
        return null;
    }

    if (connectionState !== 'connected')
    {
        return (
            <p className="feed-banner feed-banner--bad" role="status">
                Lost contact with the dashboard backend. Reconnecting… (showing the last data received)
            </p>
        );
    }

    const { chunksProcessed, lastChunkPublishedAt } = snapshot.feed;

    if (chunksProcessed === 0)
    {
        return (
            <p className="feed-banner feed-banner--warning" role="status">
                Connected. Waiting for the first chunk from the live simulator (node scripts/live-runner.mjs).
            </p>
        );
    }

    const minutesSince = (Date.parse(snapshot.generatedAt) - Date.parse(lastChunkPublishedAt)) / 60000;
    const isStale = minutesSince > staleFeedMinutes;

    return (
        <p className={isStale ? 'feed-banner feed-banner--warning' : 'feed-banner'} role="status">
            <span className={isStale ? 'status-dot status-dot--warning' : 'status-dot status-dot--good'} aria-hidden="true" />
            <span className="feed-banner__text">
                {isStale
                    ? `No new footage for ${Math.round(minutesSince)} min. Is the live simulator still running?`
                    : `Live simulator feed: ${chunksProcessed} chunks received, latest ${formatDateTime(lastChunkPublishedAt)}.`}
                {' '}Synthetic {renderingLabel(snapshot)} rendering; detections say "digging activity", never a confirmed nest.
            </span>
        </p>
    );
}
