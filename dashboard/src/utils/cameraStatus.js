// Helpers that summarize camera health for the UI.

// Counts how many cameras across all pairs are currently online.
export function countOnlineCameras(cameraPairs)
{
    let onlineCount = 0;

    for (const cameraPair of cameraPairs)
    {
        for (const camera of cameraPair.cameras)
        {
            if (camera.status === 'online')
            {
                onlineCount += 1;
            }
        }
    }

    return onlineCount;
}

// Counts every camera across all pairs, online or not.
export function countAllCameras(cameraPairs)
{
    let totalCount = 0;

    for (const cameraPair of cameraPairs)
    {
        totalCount += cameraPair.cameras.length;
    }

    return totalCount;
}

// Describes a pair's health in a few words, plus a tone the UI uses to
// pick a color: "good" (both online), "warning" (one down), "bad" (both down).
export function describePairStatus(cameraPair)
{
    const offlineCameras = cameraPair.cameras.filter(function isOffline(camera)
    {
        return camera.status !== 'online';
    });

    if (offlineCameras.length === 0)
    {
        return { text: 'Both online', tone: 'good' };
    }

    if (offlineCameras.length === cameraPair.cameras.length)
    {
        return { text: 'Both offline', tone: 'bad' };
    }

    // Exactly one camera is down, so name it.
    return { text: `${offlineCameras[0].cameraIdentifier} offline`, tone: 'warning' };
}
