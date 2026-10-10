// Live mode: connects to the dashboard backend (server/server.js) through
// the Vite proxy. Snapshots and alerts arrive as server-sent events.
// Follows the same contract as dataSource.js.
//
// EventSource alone can't be trusted to reconnect: it gives up for good on
// an error response, and a proxy can keep a dead connection open silently.
// The backend sends a heartbeat every 15 s, so if nothing at all arrives for
// this long, the stream is reopened.
const silentConnectionMilliseconds = 40000;
const reconnectDelayMilliseconds = 3000;

export function createLiveDataSource({ baseUrl = '' } = {})
{
    const snapshotListeners = new Set();
    const alertListeners = new Set();
    const connectionListeners = new Set();

    let latestSnapshot = null;
    let connectionState = 'connecting';
    let eventSource = null;
    let watchdog = null;
    let reconnectTimer = null;

    function setConnectionState(state)
    {
        connectionState = state;
        connectionListeners.forEach(function notify(listener)
        {
            listener(state);
        });
    }

    function hasListeners()
    {
        return snapshotListeners.size > 0 || alertListeners.size > 0;
    }

    // Restarts the "heard nothing" countdown; called on every message.
    function resetWatchdog()
    {
        clearTimeout(watchdog);
        watchdog = setTimeout(function reconnectSilentStream()
        {
            reopenStream();
        }, silentConnectionMilliseconds);
    }

    function closeStream()
    {
        clearTimeout(watchdog);
        clearTimeout(reconnectTimer);
        if (eventSource)
        {
            eventSource.close();
            eventSource = null;
        }
    }

    function reopenStream()
    {
        closeStream();
        setConnectionState('connecting');
        reconnectTimer = setTimeout(openStreamIfNeeded, reconnectDelayMilliseconds);
    }

    // Opens the stream when the first listener arrives, closes it after the last leaves.
    function openStreamIfNeeded()
    {
        if (eventSource || !hasListeners())
        {
            return;
        }

        eventSource = new EventSource(`${baseUrl}/api/stream`);
        resetWatchdog();

        eventSource.addEventListener('open', function handleOpen()
        {
            setConnectionState('connected');
            resetWatchdog();
        });

        eventSource.addEventListener('error', function handleError()
        {
            // CLOSED means the browser gave up (for example a 502 from the proxy); retry ourselves.
            if (eventSource && eventSource.readyState === EventSource.CLOSED)
            {
                reopenStream();
            }
            else
            {
                setConnectionState('connecting');
            }
        });

        eventSource.addEventListener('heartbeat', function handleHeartbeat()
        {
            setConnectionState('connected');
            resetWatchdog();
        });

        eventSource.addEventListener('snapshot', function handleSnapshot(message)
        {
            resetWatchdog();
            latestSnapshot = JSON.parse(message.data);
            setConnectionState('connected');
            snapshotListeners.forEach(function notify(listener)
            {
                listener(latestSnapshot);
            });
        });

        eventSource.addEventListener('alert', function handleAlert(message)
        {
            resetWatchdog();
            const alert = JSON.parse(message.data);
            alertListeners.forEach(function notify(listener)
            {
                listener(alert);
            });
        });
    }

    function closeStreamIfUnused()
    {
        if (!hasListeners())
        {
            closeStream();
        }
    }

    function addListener(listeners, listener)
    {
        listeners.add(listener);
        openStreamIfNeeded();

        return function unsubscribe()
        {
            listeners.delete(listener);
            closeStreamIfUnused();
        };
    }

    return {
        mode: 'live',

        subscribe(onSnapshot)
        {
            if (latestSnapshot)
            {
                onSnapshot(latestSnapshot);
            }
            return addListener(snapshotListeners, onSnapshot);
        },

        subscribeToAlerts(onAlert)
        {
            return addListener(alertListeners, onAlert);
        },

        subscribeToConnection(onState)
        {
            connectionListeners.add(onState);
            onState(connectionState);

            return function unsubscribe()
            {
                connectionListeners.delete(onState);
            };
        },

        // The new snapshot arrives through the stream; this only reports success or failure.
        async addPatrolEntry(nestIdentifier, entry)
        {
            let response;
            try
            {
                response = await fetch(`${baseUrl}/api/nest-sites/${encodeURIComponent(nestIdentifier)}/patrol-entries`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(entry),
                });
            }
            catch
            {
                throw new Error("Couldn't reach the dashboard backend. Check that it's running and try again.");
            }

            if (!response.ok)
            {
                const body = await response.json().catch(function noBody()
                {
                    return {};
                });
                throw new Error(body.error || `The backend refused the update (${response.status}).`);
            }
        },
    };
}
