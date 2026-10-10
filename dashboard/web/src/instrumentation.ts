export async function register()
{
    if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.LIVE_FEED !== '1')
    {
        return;
    }
    const { prisma } = await import('@/lib/db');
    const { liveSettings, startLiveWatcher } = await import('@/lib/live/watcher');
    startLiveWatcher(prisma, liveSettings());
    if (process.env.DEMO_PATROL === '1')
    {
        // Simulated patrol for demos: visits, protects, finds no eggs, forgets, or never comes (lib/live/demoPatrol.ts).
        const { startDemoPatrol } = await import('@/lib/live/demoPatrol');
        startDemoPatrol(prisma);
    }
}
