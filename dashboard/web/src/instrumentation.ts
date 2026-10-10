export async function register()
{
    if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.LIVE_FEED !== '1')
    {
        return;
    }
    const { prisma } = await import('@/lib/db');
    const { liveSettings, startLiveWatcher } = await import('@/lib/live/watcher');
    startLiveWatcher(prisma, liveSettings());
}
