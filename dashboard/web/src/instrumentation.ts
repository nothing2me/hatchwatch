export async function register()
{
    if (process.env.NEXT_RUNTIME !== 'nodejs')
    {
        return;
    }
    if (process.env.LIVE_FEED === '1')
    {
        const { prisma } = await import('@/lib/db');
        const { liveSettings, startLiveWatcher } = await import('@/lib/live/watcher');
        startLiveWatcher(prisma, liveSettings());
    }
    const { recorderSettings, startRecorder } = await import('@/lib/phones/recorder');
    const settings = recorderSettings();
    if (settings)
    {
        // A recordings-folder problem must never stop the dashboard booting; live view works without it.
        try
        {
            await startRecorder(settings);
        }
        catch (error)
        {
            console.error(`Phone recording disabled: could not start the recorder at ${settings.root}:`, (error as Error).message);
        }
    }
}
