import type { PrismaClient } from '@/generated/prisma/client';
import type { SiteEventType } from '@/lib/types';
import { addSiteEvent } from '@/lib/sites/events';
import { PERSON_EVENTS } from '@/lib/sites/summary';

// Optional simulated patrol for live demos (DEMO_PATROL=1, with LIVE_FEED=1).
//
// Each live digging site gets one outcome, picked from its id so a restart never reshuffles it:
//   protect  (40%) visits, confirms the nest, sets up protection
//   damaged  (10%) visits, finds the nest damaged, protects what is left
//   noEggs   (20%) visits, finds no egg chamber
//   forgot   (15%) visits and confirms the nest, but never logs protection
//   unseen   (15%) never visited; the site ages off the live map unprotected
// Outcomes are random demo behaviour, NOT read from the simulator's truth (the dashboard never sees it), so a
// "nest confirmed" here says nothing about whether the simulated turtle laid eggs. Every entry is signed
// DEMO_PATROL_AUTHOR, and the patrol stands down on any site a real person has already logged.

export const DEMO_PATROL_AUTHOR = 'Demo patrol (simulated)';

export type DemoOutcome = 'protect' | 'damaged' | 'noEggs' | 'forgot' | 'unseen';

export const DEMO_OUTCOME_WEIGHTS: ReadonlyArray<[DemoOutcome, number]> = [
    ['protect', 0.4],
    ['damaged', 0.1],
    ['noEggs', 0.2],
    ['forgot', 0.15],
    ['unseen', 0.15],
];

export interface DemoStep
{
    type: SiteEventType;
    /** Minutes after the site's detection time. */
    afterMinutes: number;
    note: string;
}

export interface DemoPlan
{
    outcome: DemoOutcome;
    steps: DemoStep[];
}

// Deterministic number in [0, 1) from a site id and a purpose (FNV-1a, 32-bit).
export function unitFrom(id: string, salt: string): number
{
    let hash = 0x811c9dc5;
    for (const character of `${salt}:${id}`)
    {
        hash ^= character.codePointAt(0)!;
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash / 0x1_0000_0000;
}

export function outcomeFor(alertId: string): DemoOutcome
{
    const roll = unitFrom(alertId, 'outcome');
    let total = 0;
    for (const [outcome, weight] of DEMO_OUTCOME_WEIGHTS)
    {
        total += weight;
        if (roll < total)
        {
            return outcome;
        }
    }
    return DEMO_OUTCOME_WEIGHTS[DEMO_OUTCOME_WEIGHTS.length - 1][0];
}

// The entries the demo patrol will log on a site, and when. Detection is stamped at the start of the dig in the
// recording, about a minute and a half before the chunk is published, so the first visit comes 3-6 min after it.
export function planFor(alertId: string): DemoPlan
{
    const outcome = outcomeFor(alertId);
    const visit = 3 + unitFrom(alertId, 'visit') * 3;
    const confirm = visit + 0.5 + unitFrom(alertId, 'confirm');
    const protect = confirm + 0.5 + unitFrom(alertId, 'protect') * 2;
    const arrived: DemoStep = { type: 'patrolVisit', afterMinutes: visit, note: 'Responded to the camera alert; checking the marked spot.' };

    switch (outcome)
    {
        case 'protect':
            return { outcome, steps: [
                arrived,
                { type: 'nestConfirmed', afterMinutes: confirm, note: 'Egg chamber found by careful probing.' },
                { type: 'protectionInstalled', afterMinutes: protect, note: 'Stakes, tape and a sign around the nest.' },
            ] };
        case 'damaged':
            return { outcome, steps: [
                arrived,
                { type: 'nestDamaged', afterMinutes: confirm, note: 'Nest found damaged: tire ruts across it, some eggs exposed.' },
                { type: 'protectionInstalled', afterMinutes: protect, note: 'Reburied the exposed eggs; stakes and tape around what is left.' },
            ] };
        case 'noEggs':
            return { outcome, steps: [
                arrived,
                { type: 'noNestFound', afterMinutes: confirm, note: 'Body pit only; no egg chamber found.' },
            ] };
        case 'forgot':
            return { outcome, steps: [
                arrived,
                { type: 'nestConfirmed', afterMinutes: confirm, note: 'Egg chamber found. (Protection was never logged.)' },
            ] };
        case 'unseen':
            return { outcome, steps: [] };
    }
}

// Steps that are due by `now` and not yet logged; `logged` is how many demo entries the site already has.
export function dueSteps(plan: DemoPlan, detectedAt: Date, now: Date, logged: number): DemoStep[]
{
    return plan.steps
        .slice(logged)
        // Rounded to whole milliseconds, the resolution of a Date.
        .filter(step => detectedAt.getTime() + Math.round(step.afterMinutes * 60_000) <= now.getTime());
}

// One pass: logs every due demo entry on live digging sites from the last `lookbackMinutes`.
export async function demoPatrolTick(prisma: PrismaClient, now: Date = new Date(), lookbackMinutes = 60): Promise<number>
{
    const sites = await prisma.alert.findMany({
        where: {
            kind: 'DIGGING',
            video: { liveChunkId: { not: null } },
            status: { notIn: ['ARCHIVED', 'DISMISSED', 'HATCHED', 'LOST'] },
            detectedAt: { gte: new Date(now.getTime() - lookbackMinutes * 60_000) },
        },
        select: { id: true, detectedAt: true, events: { select: { type: true, author: true } } },
    });

    let logged = 0;
    for (const site of sites)
    {
        const personEntries = site.events.filter(event => PERSON_EVENTS.includes(event.type as SiteEventType));
        const ours = personEntries.filter(event => event.author === DEMO_PATROL_AUTHOR).length;
        if (!site.detectedAt || personEntries.length > ours)
        {
            // A real person has logged this site: hand it over.
            continue;
        }
        for (const step of dueSteps(planFor(site.id), site.detectedAt, now, ours))
        {
            await addSiteEvent(prisma, { alertId: site.id, type: step.type, note: step.note, userId: null, author: DEMO_PATROL_AUTHOR, at: now });
            logged += 1;
        }
    }
    return logged;
}

const globalPatrol = globalThis as unknown as { __hatchwatchDemoPatrol?: () => void };

export function startDemoPatrol(prisma: PrismaClient, intervalMs = 5000): () => void
{
    if (globalPatrol.__hatchwatchDemoPatrol)
    {
        return globalPatrol.__hatchwatchDemoPatrol;
    }
    let running = false;
    const tick = async () =>
    {
        if (running)
        {
            return;
        }
        running = true;
        try
        {
            await demoPatrolTick(prisma);
        }
        catch (error)
        {
            console.error('[demo patrol] pass failed:', error instanceof Error ? error.message : error);
        }
        finally
        {
            running = false;
        }
    };
    const timer = setInterval(() => { void tick(); }, intervalMs);
    const stop = () =>
    {
        clearInterval(timer);
        globalPatrol.__hatchwatchDemoPatrol = undefined;
    };
    globalPatrol.__hatchwatchDemoPatrol = stop;
    console.log(`[demo patrol] on: simulated patrol entries signed "${DEMO_PATROL_AUTHOR}"`);
    return stop;
}
