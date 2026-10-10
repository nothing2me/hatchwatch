# NestTrace Dashboard — Plan C: 24 h Live Feed, Nest Lifecycle, Analytics, Roles, Camera Editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feed the dashboard continuously from William's live simulator (three files copied from `main`, no merge), give every alert a person-driven lifecycle (protected, confirmed, hatched, lost → Active/Inactive), add an Analytics menu with saved/not-saved statistics, a VOLUNTEER role with an admin Users page, one-click camera-pair placement, and a bigger/resizable camera view.

**Architecture:** Research side gains `scripts/live-runner.mjs` + `schemas/live-chunk.v1.json` + a 7-line `web/simulation.ts` change, copied verbatim from `origin/main`. Dashboard side: a watcher started from Next's `instrumentation.ts` polls a read-only mount of `artifacts/public` for `live-chunk.json`, validates it (zod mirror of the schema), imports each chunk once onto the next zone (reusing the Plan A frame), and ages sites (fade 5 min, archive 20 min). An append-only `SiteEvent` log on each `Alert` drives derived state; `Alert.status` is a cached projection. An in-process change bus feeds an SSE stream that makes map and Analytics re-fetch `/api/snapshot`. Roles get a DB-backed guard.

**Tech Stack:** Existing (Next.js 16.4.0, React 19.3.0, Prisma 7.10.0, Postgres 16, Vitest 5, zod 4.6.5, react-map-gl 8.1.3). No new runtime dependencies (charts are hand-built SVG).

**Spec:** `docs/superpowers/specs/2026-10-09-live-feed-nest-log-roles-design.md` (wherever it still says "merge" or "demo patrol", the binding decision is: no merge, no demo patrol, no toasts).

## Global Constraints

- From `origin/main` copy **only** `scripts/live-runner.mjs`, `schemas/live-chunk.v1.json`, `web/simulation.ts`. No merge; nothing else from `main`.
- Boundary: the dashboard reads simulator output only via `sim-import-v1` (CLI) and `live-chunk.v1` (watcher over the read-only `/sim-public` mount). Never `private/`, seeds, scenario names or truth. Live media copied to `MEDIA_ROOT/live/<chunk_id>/`.
- Detector alerts: exactly `Digging activity detected; nesting unresolved.` Only a person can log `nestConfirmed`, `noNestFound`, `hatched`, `lost`. `hatched` requires an earlier `nestConfirmed`.
- Roles: `VIEWER < VOLUNTEER < ADMIN`. VIEWER view-only; VOLUNTEER + site log entries; ADMIN + users, cameras, zones. Every mutation/API uses the DB-backed guard (`currentUserOrNull` / `requireCurrentUser`); disabled users (`disabledAt` set) are treated as signed out.
- Live sim frame: manifest camera with `end: 'x_min'` → `<zone>1` (north end), `x_max` → `<zone>2`; points mapped with Plan A `zoneFrame`/`simPointToLngLat`.
- Timings: watcher poll 3 s, fade 5 min (`LIVE_FADE_MINUTES`), archive 20 min (`LIVE_ARCHIVE_MINUTES`) unless a person has logged any entry, keep media of newest 40 chunks (`LIVE_KEEP`).
- Saved = `hatched` after `protectionInstalled`; Not saved = `lost`, or archived while `unprotected`; Pending = otherwise. (Danger rule arrives with Plan D.)
- Camera pair placement: new zone 120 m along × 60 m seaward, land edge centred on the click; cameras at the land-edge ends facing the zone centroid; fov 60°, range 90 m; codes continue after the highest letter (E, F, …).
- Night Watch look (dark glass, single amber accent, Inter + JetBrains Mono); the user dislikes generic UI.
- Commits: no `Co-Authored-By`/AI attribution; explicit paths only; never stage `artifacts/`, `dashboard/media/`, `.superpowers/`, `.env`.
- Ports unchanged (web 127.0.0.1:3000, db 127.0.0.1:5433). No LAN exposure.

## Review Focus

1. **Watcher restarts / two imports of the same chunk / partially written chunk folder** → each chunk imported exactly once, only after `live-chunk.json` exists and validates. Pinned in Task 3 (idempotence + missing-manifest tests).
2. **Volunteer logs `hatched` without `nestConfirmed`, or a VIEWER posts an entry** → 409 / 403, nothing written. Pinned in Task 2.
3. **Admin demotes/disables themselves; disabled user keeps an old cookie** → refused / treated as signed out on the next request. Pinned in Task 6.
4. **Camera pair clicked in the sea or with no zones existing** → land edge computed from the nearest zone (or default bearing) and the zone always extends seaward; click >2 km from any zone is refused. Pinned in Task 7.
5. **Long-running feed** (hundreds of sites) → snapshot stays bounded (all active + newest 100 inactive), counts come from count queries, old chunk media pruned. Pinned in Tasks 2 and 3.

---

## File Structure

```
scripts/live-runner.mjs, schemas/live-chunk.v1.json, web/simulation.ts   (copied from origin/main)
dashboard/
  docker-compose.yml          + read-only mount ../artifacts/public:/sim-public, LIVE_* env
  .env.example                + LIVE_FEED, LIVE_ROOT, LIVE_*_MINUTES, LIVE_KEEP
  web/
    prisma/schema.prisma      Role VOLUNTEER, User.disabledAt, AlertStatus +HATCHED/LOST/ARCHIVED,
                              SiteEvent, LiveChunk, Video.liveChunkId, Zone.createdById
    src/instrumentation.ts    starts the live watcher (LIVE_FEED=1, nodejs runtime)
    src/lib/auth/guard.ts     + currentUserOrNull, requireCurrentUser (DB-backed, disabled → null)
    src/lib/sites/summary.ts  summarizeSite(), statusFor(), SITE_EVENT_TYPES
    src/lib/sites/events.ts   addSiteEvent() (rules + cached status, one transaction)
    src/lib/sites/outcomes.ts classifyOutcome(), outcomeCounts()
    src/lib/changes.ts        in-process change bus (publishChange / onChange)
    src/lib/live/manifest.ts  zod mirror of live-chunk.v1
    src/lib/live/importChunk.ts importLiveChunk()
    src/lib/live/watcher.ts   scanOnce(), ageSites(), pruneMedia(), startLiveWatcher()
    src/lib/cameras/placePair.ts planCameraPair(), nextZoneCode()
    src/server/snapshot.ts    bounded alerts, site summaries, count queries
    src/app/api/snapshot/route.ts, src/app/api/stream/route.ts
    src/app/api/sites/[alertId]/route.ts            GET site + log
    src/app/api/sites/[alertId]/events/route.ts     POST log entry (VOLUNTEER+)
    src/app/(app)/analytics/page.tsx + src/features/analytics/*
    src/app/(app)/setup/users/page.tsx + actions.ts
    src/app/(app)/camera-actions.ts                 addCameraPair, deleteZone
    src/features/live/useLiveSnapshot.ts            SSE → re-fetch snapshot
    src/features/sites/SiteDrawer.tsx, PatrolForm.tsx
    src/features/alerts/AlertsFeed.tsx              Active/Inactive tabs, status pills
    src/features/map/*                              fade, edit mode, live snapshot
    src/features/cameras/ExpandedFeed.tsx, CameraPanel.tsx (expand + resize)
```

---

### Task 1: Copy the live simulator files from `main` and smoke-test one chunk

**Files:** `scripts/live-runner.mjs`, `schemas/live-chunk.v1.json`, `web/simulation.ts` (from `origin/main`).

- [ ] **Step 1: Copy exactly three files**

```bash
cd /Users/segfault/Documents/islanderhack2026/nesttrace
git fetch origin
git checkout origin/main -- scripts/live-runner.mjs schemas/live-chunk.v1.json web/simulation.ts
git status --short            # expect exactly these three paths staged (plus untracked .superpowers/)
git diff --cached --stat
```
Expected: `web/simulation.ts` changes ~7 lines; the other two are new files.

- [ ] **Step 2: Root tests**

Run: `npm test` (tsc + pytest). Expected: pass.

- [ ] **Step 3: Smoke one live chunk**

Vite must serve the simulator on 5173 (`lsof -ti tcp:5173` — start `npm run dev` in the background if missing). If Playwright's bundled browser is missing, `export NESTTRACE_BROWSER="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.
```bash
node scripts/live-runner.mjs --chunks 1
ls artifacts/public | grep '^live-' ; cat artifacts/public/live-*/live-chunk.json | head -40
```
Expected: one `live-NNNNNN-xxxx/` folder with `live-chunk.json`, `camera-0.mp4`, `camera-1.mp4`, `calibration-*.json`, `pins/predictions.json`. Record the manifest in the report. (If a single command would exceed 10 min, run the runner in the background and poll for the manifest.)

- [ ] **Step 4: Commit**

```bash
git commit -m "Add William's continuous live simulator feed (from main 2b25bc5)

Copies scripts/live-runner.mjs, schemas/live-chunk.v1.json and the
swarm-spread lane shuffle in web/simulation.ts. Nothing else from main."
```

---

### Task 2: Schema, DB-backed guard, site log and lifecycle

**Files:**
- Modify: `dashboard/web/prisma/schema.prisma`, `dashboard/web/src/lib/auth/guard.ts`, `dashboard/web/src/lib/types.ts`, `dashboard/web/src/server/snapshot.ts`, `dashboard/web/prisma/seed.ts` (no behaviour change; type only if needed)
- Create: `dashboard/web/src/lib/sites/summary.ts`, `dashboard/web/src/lib/sites/events.ts`, `dashboard/web/src/lib/sites/outcomes.ts`, `dashboard/web/src/lib/changes.ts`, `dashboard/web/src/app/api/sites/[alertId]/route.ts`, `dashboard/web/src/app/api/sites/[alertId]/events/route.ts`
- Test: `tests/unit/site-summary.test.ts`, `tests/unit/outcomes.test.ts`, `tests/unit/changes.test.ts`, `tests/integration/site-events.test.ts`, `tests/unit/site-routes.test.ts`

**Interfaces (produced):**
```ts
// types.ts
export type Role = 'ADMIN' | 'VOLUNTEER' | 'VIEWER';
export type AlertStatus = 'NEW' | 'REVIEWED' | 'DISMISSED' | 'FIELD_CONFIRMED' | 'HATCHED' | 'LOST' | 'ARCHIVED';
export type SiteEventType = 'detected' | 'departed' | 'archived' | 'patrolVisit' | 'nestConfirmed' | 'noNestFound' | 'protectionInstalled' | 'hatched' | 'lost' | 'note';
export type Protection = 'unprotected' | 'protected' | 'notNeeded';
export type Nesting = 'unresolved' | 'confirmed' | 'noNest';
export type Outcome = 'open' | 'hatched' | 'lost';
export interface SiteSummary { protection: Protection; nesting: Nesting; outcome: Outcome; active: boolean; personActed: boolean; patrolVisited: boolean; detectedAt: string | null; archivedAt: string | null }
// AlertView adds: site: SiteSummary
// MapSnapshot adds: inactiveCount: number; outcomes: { saved: number; notSaved: number; pending: number }
// summary.ts
export const PERSON_EVENTS: SiteEventType[];   // patrolVisit nestConfirmed noNestFound protectionInstalled hatched lost note
export function summarizeSite(events: { type: SiteEventType; at: Date | string }[]): SiteSummary;
export function statusFor(summary: SiteSummary, events: { type: SiteEventType }[]): AlertStatus;
// events.ts
export class SiteEventError extends Error { code: 'NOT_FOUND' | 'NEEDS_CONFIRMED' | 'NOT_PERSON_EVENT' }
export function addSiteEvent(prisma, input: { alertId: string; type: SiteEventType; note?: string; userId: string | null; author: string; at?: Date; system?: boolean }): Promise<SiteSummary>;
// outcomes.ts
export type OutcomeClass = 'saved' | 'notSaved' | 'pending' | 'none';
export function classifyOutcome(summary: SiteSummary): OutcomeClass;  // 'saved' | 'notSaved' | 'pending' | 'none'
export function outcomeCounts(summaries: SiteSummary[]): { saved: number; notSaved: number; pending: number };
// changes.ts
export function publishChange(reason: string): void;
export function onChange(listener: (reason: string) => void): () => void;
// guard.ts
export function currentUserOrNull(): Promise<SessionUser | null>;          // DB read; null if missing or disabled
export function requireCurrentUser(role?: Role): Promise<SessionUser>;     // redirect /login | forbidden()
```

- [ ] **Step 1: Schema + migration**

```prisma
enum Role {
  ADMIN
  VOLUNTEER
  VIEWER
}

enum AlertStatus {
  NEW
  REVIEWED
  DISMISSED
  FIELD_CONFIRMED
  HATCHED
  LOST
  ARCHIVED
}

model SiteEvent {
  id        String   @id @default(cuid())
  alertId   String
  alert     Alert    @relation(fields: [alertId], references: [id], onDelete: Cascade)
  type      String
  author    String
  userId    String?
  user      User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  note      String?
  at        DateTime @default(now())
  createdAt DateTime @default(now())

  @@index([alertId, at])
}

model LiveChunk {
  id          String   @id            // chunk_id
  sequence    Int      @unique
  zoneId      String
  zone        Zone     @relation(fields: [zoneId], references: [id])
  startedAt   DateTime
  importedAt  DateTime @default(now())
  mediaPruned Boolean  @default(false)
  videos      Video[]
}
```
Add: `User.disabledAt DateTime?`, `User.siteEvents SiteEvent[]`, `Alert.events SiteEvent[]`, `Alert.detectedAt DateTime?`, `Video.liveChunkId String?` + relation `liveChunk LiveChunk? @relation(fields: [liveChunkId], references: [id], onDelete: SetNull)`, `Zone.createdById String?` (no relation needed) and `Zone.liveChunks LiveChunk[]`. Add `@@index([status])` on Alert if missing.
Run: `npx prisma migrate dev --name live_feed_lifecycle && npm run db:test:prepare`.
In sim-import (`src/lib/sim/importRun.ts`), set `detectedAt: new Date()` on created alerts and write a `detected` SiteEvent (author "Camera", system) per alert so imported sites have a log. Update its re-import deletes to also remove `SiteEvent` rows (cascade covers it; verify).

- [ ] **Step 2: Failing summary tests**

`tests/unit/site-summary.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { statusFor, summarizeSite } from '@/lib/sites/summary';

const e = (type: string, minute: number) => ({ type: type as never, at: new Date(Date.UTC(2026, 9, 9, 20, minute)) });

describe('summarizeSite', () =>
{
    it('defaults to an unprotected, unresolved, open, active site', () =>
    {
        const s = summarizeSite([e('detected', 0)]);
        expect(s).toMatchObject({ protection: 'unprotected', nesting: 'unresolved', outcome: 'open', active: true, personActed: false, patrolVisited: false });
        expect(s.detectedAt).toBe('2026-10-09T20:00:00.000Z');
    });
    it('later entries win and sorting is by time, not insertion', () =>
    {
        const s = summarizeSite([e('nestConfirmed', 5), e('detected', 0), e('noNestFound', 3)]);
        expect(s.nesting).toBe('confirmed');
        expect(s.protection).toBe('unprotected');
    });
    it('no nest found makes protection not needed and the site inactive', () =>
    {
        const s = summarizeSite([e('detected', 0), e('noNestFound', 2)]);
        expect(s).toMatchObject({ protection: 'notNeeded', nesting: 'noNest', active: false, patrolVisited: true });
    });
    it('hatched and lost close the site', () =>
    {
        expect(summarizeSite([e('detected', 0), e('nestConfirmed', 1), e('hatched', 9)])).toMatchObject({ outcome: 'hatched', active: false });
        expect(summarizeSite([e('detected', 0), e('lost', 9)])).toMatchObject({ outcome: 'lost', active: false });
    });
    it('archived only deactivates when no person acted afterwards', () =>
    {
        expect(summarizeSite([e('detected', 0), e('archived', 20)])).toMatchObject({ active: false, archivedAt: '2026-10-09T20:20:00.000Z' });
        expect(summarizeSite([e('detected', 0), e('archived', 20), e('patrolVisit', 25)])).toMatchObject({ active: true, personActed: true });
    });
    it('maps to the cached Alert.status', () =>
    {
        const cases: [string[], string][] = [
            [['detected'], 'NEW'],
            [['detected', 'patrolVisit'], 'REVIEWED'],
            [['detected', 'nestConfirmed'], 'FIELD_CONFIRMED'],
            [['detected', 'noNestFound'], 'DISMISSED'],
            [['detected', 'nestConfirmed', 'hatched'], 'HATCHED'],
            [['detected', 'lost'], 'LOST'],
            [['detected', 'archived'], 'ARCHIVED'],
        ];
        for (const [types, status] of cases)
        {
            const events = types.map((type, i) => e(type, i));
            expect(statusFor(summarizeSite(events), events)).toBe(status);
        }
    });
});
```

- [ ] **Step 3: Implement `summary.ts`**

```ts
import type { AlertStatus, SiteEventType, SiteSummary } from '@/lib/types';

export const PERSON_EVENTS: SiteEventType[] = ['patrolVisit', 'nestConfirmed', 'noNestFound', 'protectionInstalled', 'hatched', 'lost', 'note'];
const ON_SITE: SiteEventType[] = ['patrolVisit', 'nestConfirmed', 'noNestFound', 'protectionInstalled', 'hatched', 'lost'];

type Ev = { type: SiteEventType; at: Date | string };
const time = (at: Date | string) => (at instanceof Date ? at : new Date(at));

// Reads a site's log oldest-first; later entries win so a patrol can correct an earlier finding.
export function summarizeSite(events: Ev[]): SiteSummary
{
    const ordered = [...events].sort((a, b) => time(a.at).getTime() - time(b.at).getTime());
    const summary: SiteSummary = { protection: 'unprotected', nesting: 'unresolved', outcome: 'open', active: true, personActed: false, patrolVisited: false, detectedAt: null, archivedAt: null };
    let archivedWithoutFollowUp = false;

    for (const event of ordered)
    {
        const iso = time(event.at).toISOString();
        if (PERSON_EVENTS.includes(event.type))
        {
            summary.personActed = true;
            archivedWithoutFollowUp = false;
        }
        if (ON_SITE.includes(event.type))
        {
            summary.patrolVisited = true;
        }
        switch (event.type)
        {
            case 'detected': summary.detectedAt ??= iso; break;
            case 'archived': summary.archivedAt = iso; archivedWithoutFollowUp = true; break;
            case 'nestConfirmed': summary.nesting = 'confirmed'; if (summary.protection === 'notNeeded') summary.protection = 'unprotected'; break;
            case 'noNestFound': summary.nesting = 'noNest'; summary.protection = 'notNeeded'; break;
            case 'protectionInstalled': summary.protection = 'protected'; break;
            case 'hatched': summary.outcome = 'hatched'; break;
            case 'lost': summary.outcome = 'lost'; break;
            default: break;
        }
    }

    summary.active = summary.outcome === 'open' && summary.nesting !== 'noNest' && !archivedWithoutFollowUp;
    return summary;
}

export function statusFor(summary: SiteSummary, events: { type: SiteEventType }[]): AlertStatus
{
    if (summary.outcome === 'hatched') return 'HATCHED';
    if (summary.outcome === 'lost') return 'LOST';
    if (summary.nesting === 'noNest') return 'DISMISSED';
    if (!summary.active) return 'ARCHIVED';
    if (summary.nesting === 'confirmed') return 'FIELD_CONFIRMED';
    return events.some(event => PERSON_EVENTS.includes(event.type)) ? 'REVIEWED' : 'NEW';
}
```
Run → PASS.

- [ ] **Step 4: Outcomes (test first)**

`tests/unit/outcomes.test.ts` (write first): hatched → `saved` (with or without logged protection — the hatchlings emerged); lost → `notSaved`; detected+archived with no person entry → `notSaved`; detected+protectionInstalled+archived → `pending`; detected only → `pending`; noNestFound → `none` and excluded from `outcomeCounts`. Implement:
```ts
export type OutcomeClass = 'saved' | 'notSaved' | 'pending' | 'none';
export function classifyOutcome(summary: SiteSummary): OutcomeClass
{
    if (summary.nesting === 'noNest') return 'none';
    if (summary.outcome === 'hatched') return 'saved';
    if (summary.outcome === 'lost') return 'notSaved';
    if (!summary.active && summary.protection === 'unprotected') return 'notSaved';
    return 'pending';
}
export function outcomeCounts(summaries: SiteSummary[]) { /* { saved, notSaved, pending } ignoring 'none' */ }
```
Run → PASS.

- [ ] **Step 5: Change bus (test first)**

`src/lib/changes.ts`: globalThis-singleton `EventEmitter` (`setMaxListeners(100)`); `publishChange(reason)` emits `'change'`; `onChange(listener)` returns an unsubscribe. Test: two listeners receive the reason; unsubscribe stops delivery.

- [ ] **Step 6: `addSiteEvent` (integration test first)**

`tests/integration/site-events.test.ts` (same `_test` DB guard/TRUNCATE/seed pattern as `tests/integration/sim-import.test.ts`; add `"SiteEvent","LiveChunk"` to TRUNCATE): import run fixture via `importSimRun` (copy the fixture helper from sim-import.test.ts) then:
- `addSiteEvent({ type: 'hatched' })` on a fresh site → throws `SiteEventError` code `NEEDS_CONFIRMED`, nothing written;
- `nestConfirmed` then `hatched` → summary `outcome: 'hatched'`, `Alert.status === 'HATCHED'`;
- system event `archived` via `system: true` allowed; a non-system call with `type: 'archived'` → `NOT_PERSON_EVENT`;
- `publishChange` called once per successful event (spy via `onChange`).

`src/lib/sites/events.ts`:
```ts
import type { PrismaClient } from '@/generated/prisma/client';
import { publishChange } from '@/lib/changes';
import type { SiteEventType, SiteSummary } from '@/lib/types';
import { PERSON_EVENTS, statusFor, summarizeSite } from './summary';

export class SiteEventError extends Error
{
    constructor(public code: 'NOT_FOUND' | 'NEEDS_CONFIRMED' | 'NOT_PERSON_EVENT', message: string) { super(message); }
}

export async function addSiteEvent(prisma: PrismaClient, input: { alertId: string; type: SiteEventType; note?: string; userId: string | null; author: string; at?: Date; system?: boolean }): Promise<SiteSummary>
{
    if (!input.system && !PERSON_EVENTS.includes(input.type))
    {
        throw new SiteEventError('NOT_PERSON_EVENT', `${input.type} entries come from the cameras, not people.`);
    }
    const summary = await prisma.$transaction(async tx =>
    {
        const alert = await tx.alert.findUnique({ where: { id: input.alertId }, include: { events: { select: { type: true, at: true } } } });
        if (!alert)
        {
            throw new SiteEventError('NOT_FOUND', 'Site not found.');
        }
        const before = summarizeSite(alert.events as { type: SiteEventType; at: Date }[]);
        if (input.type === 'hatched' && before.nesting !== 'confirmed')
        {
            throw new SiteEventError('NEEDS_CONFIRMED', 'Confirm the nest before marking it hatched.');
        }
        const created = await tx.siteEvent.create({ data: { alertId: alert.id, type: input.type, author: input.author, userId: input.userId, note: input.note?.slice(0, 1000) || null, at: input.at ?? new Date() } });
        const events = [...alert.events, { type: created.type, at: created.at }] as { type: SiteEventType; at: Date }[];
        const after = summarizeSite(events);
        await tx.alert.update({ where: { id: alert.id }, data: { status: statusFor(after, events) } });
        return after;
    });
    publishChange('site-event');
    return summary;
}
```

- [ ] **Step 7: DB-backed guard**

Append to `guard.ts` (it already imports `redirect`, `forbidden`, `hasRole`; add `import { prisma } from '@/lib/db'`). Update `rank` to `{ VIEWER: 1, VOLUNTEER: 2, ADMIN: 3 }`.
```ts
// Session plus a fresh database read: deleted or disabled users lose access and role changes apply immediately.
export async function currentUserOrNull(): Promise<SessionUser | null>
{
    const session = await getSession();
    if (!session) return null;
    const row = await prisma.user.findUnique({ where: { id: session.id }, select: { id: true, email: true, name: true, role: true, disabledAt: true } });
    if (!row || row.disabledAt) return null;
    return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export async function requireCurrentUser(role: Role = 'VIEWER'): Promise<SessionUser>
{
    const user = await currentUserOrNull();
    if (!user) redirect('/login');
    if (!hasRole(user, role)) forbidden();
    return user;
}
```
Switch `(app)/layout.tsx`, `(app)/page.tsx` and `(app)/setup/page.tsx` to `requireCurrentUser` (layout: VIEWER; setup: ADMIN). `authenticate()` (login) must also reject users with `disabledAt` (same generic error, still runs the dummy verify). Extend `tests/unit/guard.test.ts` rank cases for VOLUNTEER.

- [ ] **Step 8: Site routes (unit tests with mocks first)**

`GET /api/sites/[alertId]` (any signed-in user via `currentUserOrNull`, else 401): `{ site: AlertView-like fields, summary, events: [{ id, type, author, note, at }] newest first }`, 404 unknown.
`POST /api/sites/[alertId]/events` body `{ type, note? }` (zod: type ∈ PERSON_EVENTS, note ≤ 1000): 401 no user; 403 if role < VOLUNTEER; calls `addSiteEvent({ …, userId: user.id, author: user.name })`; maps `NOT_FOUND`→404, `NEEDS_CONFIRMED`→409, `NOT_PERSON_EVENT`→400; 200 `{ summary }`.
`tests/unit/site-routes.test.ts` mocks `@/lib/auth/guard` and `@/lib/sites/events` and asserts each status code.

- [ ] **Step 9: Snapshot changes (tests first)**

`snapshot.ts`:
- Alerts: all with `status in [NEW, REVIEWED, FIELD_CONFIRMED]` plus newest 100 others, each with `events: { select: { type: true, at: true } }`; map `site: summarizeSite(events)` into each `AlertView`.
- `activeAlertCount` = `prisma.alert.count({ where: { status: 'NEW' } })`; `inactiveCount` = count where status in `[DISMISSED, HATCHED, LOST, ARCHIVED]`; `outcomes` = `outcomeCounts` over all alerts' summaries (select only `events.type/at`; acceptable at demo scale — note it).
- Update `toMapSnapshot`/fixtures/tests (`snapshot.test.ts`, `mapScreen.test.tsx`, `bounds.test.ts`, `playback.test.ts`) for `site` and new snapshot fields.

- [ ] **Step 10: Run all, commit**

`npm run db:test:prepare && npx vitest run && npx tsc --noEmit`
```bash
git add dashboard/web/prisma dashboard/web/src/lib dashboard/web/src/server dashboard/web/src/app dashboard/web/tests
git commit -m "feat(dashboard): site log with derived lifecycle, volunteer role and DB-backed guard"
```

---

### Task 3: Live chunk adapter, watcher, ageing, SSE

**Files:**
- Create: `src/lib/live/manifest.ts`, `src/lib/live/importChunk.ts`, `src/lib/live/watcher.ts`, `src/instrumentation.ts`, `src/app/api/snapshot/route.ts`, `src/app/api/stream/route.ts`
- Modify: `dashboard/docker-compose.yml`, `dashboard/.env.example`, `tests/boundary.test.ts` (only if needed)
- Test: `tests/unit/live-manifest.test.ts`, `tests/integration/live-chunk.test.ts`, `tests/unit/stream-route.test.ts`

**Interfaces (produced):**
```ts
// manifest.ts
export const liveManifestSchema: z.ZodType<LiveManifest>;   // mirrors schemas/live-chunk.v1.json exactly (const schema/version, chunk_id pattern, cameras end/video/calibration enums, pins const)
export type LiveManifest = { schema: 'nesttrace.live-chunk'; version: 1; chunk_id: string; sequence: number; recording_started_at: string; published_at: string; clip_seconds: number; fps: number; rendering: 'synthetic-daylight' | 'synthetic-very-dark'; ground_bounds_m: [number, number, number, number]; cameras: { index: 0 | 1; end: 'x_min' | 'x_max'; video: 'camera-0.mp4' | 'camera-1.mp4'; calibration: 'calibration-0.json' | 'calibration-1.json' }[]; pins: 'pins/predictions.json'; note: string };
// importChunk.ts
export function importLiveChunk(prisma, options: { chunkDir: string; mediaRoot: string }): Promise<{ chunkId: string; zoneCode: string; sites: number } | null>; // null if already imported
// watcher.ts
export interface LiveSettings { root: string; mediaRoot: string; fadeMinutes: number; archiveMinutes: number; keep: number }
export function liveSettings(env?: NodeJS.ProcessEnv): LiveSettings;
export function scanOnce(prisma, settings: LiveSettings): Promise<number>;           // chunks imported this pass
export function ageSites(prisma, settings: LiveSettings, now?: Date): Promise<number>; // sites archived
export function pruneMedia(prisma, settings: LiveSettings): Promise<number>;         // chunks pruned
export function startLiveWatcher(prisma, settings: LiveSettings): () => void;        // 3 s loop, single instance
```

- [ ] **Step 1: Manifest schema (tests first)** — valid manifest parses; wrong `schema`, bad `chunk_id`, 3 cameras, `pins` other than `pins/predictions.json`, extra key → reject (`.strict()`).

- [ ] **Step 2: `importLiveChunk` (integration test first)**

Test builds a chunk folder in a temp dir (`live-000007-abc12`) with the manifest, two tiny mp4 files, two calibration files and a pins file with one `two_camera` and one `single_camera` (`source_views: [1]`) pin. Expectations:
- zone = zones ordered by code `[sequence % count]` → with seeds A–D and sequence 7 → `D`;
- `LiveChunk` row created; two `Video` rows (`source SIMULATION`, `simRunId = chunk_id`, `liveChunkId`, `pureMotionPath null`, paths `live/<chunk>/camera-N.mp4`); camera with `end: 'x_min'` → `D1`, `x_max` → `D2`;
- two alerts with exact message, `detectedAt = recording_started_at + startT`, each with `detected` and `departed` SiteEvents (author "Camera"); single-camera pin attached to the camera that saw it (Plan A rule);
- importing the same folder again returns `null` and creates nothing;
- a folder without `live-chunk.json` is ignored by `scanOnce`; a folder whose path contains a `private` segment is refused.
Implementation reuses `zoneFrame`, `simPointToLngLat`, `pinsFileSchema`, `calibrationSchema` and the Plan A single-camera attribution; all validation before copying; DB writes in one transaction; `publishChange('live-chunk')` after commit.

- [ ] **Step 3: Ageing and pruning (integration tests with fake `now`)**

- `ageSites`: active sites with `detectedAt` older than `archiveMinutes` and **no person event** get a system `archived` event (author "Live feed", note "Older than 20 min; removed from the live map. The log is kept.") via `addSiteEvent(..., system: true)`; sites with a person event are untouched; returns count.
- `pruneMedia`: keeps media folders of the newest `keep` chunks by sequence; deletes older `MEDIA_ROOT/live/<chunk>/` folders, sets `mediaPruned = true`, and deletes those chunks' `Video` rows only if they have no alerts — otherwise keeps rows and sets `Video.path` unchanged (the media route then 404s, the UI shows the status card). Simplest rule to implement and test: never delete DB rows; only files + `mediaPruned`.
- Snapshot camera video selection: newest video per camera whose chunk is not pruned (`liveChunk: { mediaPruned: false }` OR `liveChunkId: null`).

- [ ] **Step 4: Watcher loop + instrumentation**

`startLiveWatcher` runs `scanOnce` → `ageSites` → `pruneMedia` every 3 s with a re-entrancy guard and error logging (never throws out of the loop); returns a stop function; guarded by `globalThis.__nesttraceLiveWatcher` so hot reload doesn't start two.
`src/instrumentation.ts`:
```ts
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
```
`liveSettings`: `root = resolve(process.cwd(), env.LIVE_ROOT || '../../artifacts/public')`, `mediaRoot = mediaRoot()`, minutes/keep from env with defaults 5/20/40.

- [ ] **Step 5: Snapshot + stream routes**

`GET /api/snapshot` → `currentUserOrNull` (401) → `getMapSnapshot()` JSON, `Cache-Control: no-store`.
`GET /api/stream` → 401 without user; SSE that writes `data: {"type":"snapshot"}\n\n` on every `onChange` (coalesced: at most one per 500 ms), `: keepalive` every 15 s, unsubscribes on abort/cancel. Unit test with mocked guard + `publishChange`: reading the first chunk after `publishChange('x')` yields a snapshot event; 401 path.

- [ ] **Step 6: Compose + env**

`docker-compose.yml` `web`: add volume `- ../artifacts/public:/sim-public:ro` and env `LIVE_FEED: ${LIVE_FEED:-1}`, `LIVE_ROOT: /sim-public`. `.env.example`: `LIVE_FEED=1`, `LIVE_ROOT=../../artifacts/public` (host dev), `LIVE_FADE_MINUTES=5`, `LIVE_ARCHIVE_MINUTES=20`, `LIVE_KEEP=40`.
Rebuild (`docker compose up -d --build web`) and confirm the container log shows the watcher importing the Task 1 smoke chunk (one `live-…` import line), and `curl -s localhost:3000/api/snapshot` → 401.

- [ ] **Step 7: Run all, commit**

```bash
git add dashboard/docker-compose.yml dashboard/.env.example dashboard/web/src dashboard/web/tests
git commit -m "feat(dashboard): watch live simulator chunks, import, age and stream changes"
```

---

### Task 4: Map UI — live refresh, Active/Inactive, site drawer, fade

**Files:** Create `src/features/live/useLiveSnapshot.ts`, `src/features/sites/SiteDrawer.tsx`, `src/features/sites/PatrolForm.tsx`, `src/features/sites/labels.ts`; modify `MapScreen.tsx`, `MapView.tsx`, `AlertsFeed.tsx`, `Legend.tsx`, `src/app/(app)/page.tsx`. Tests: `tests/unit/useLiveSnapshot.test.tsx`, `tests/unit/alertsFeed.test.tsx`, `tests/unit/siteDrawer.test.tsx`, extend `mapScreen.test.tsx`.

Behaviour (implement all; Ruling: UI given as behaviour list):
- `useLiveSnapshot(initial)`: opens `EventSource('/api/stream')`; on `snapshot` fetches `/api/snapshot` (debounced 300 ms, ignores out-of-order responses) and returns the latest `MapSnapshot`; reconnects automatically (EventSource default); closes on unmount. `MapScreen` uses it instead of the static prop.
- `labels.ts`: display text + tone for protection (`Unprotected` red `#E2581F`, `Protected` green `#4ADE80`, `No protection needed` grey `#8A9BA6`), nesting (`Nesting unresolved`, `Nest confirmed by patrol`, `No nest found`), outcome (`Hatched`, `Lost`), and event types (Arrived, Left, Faded from live map, Patrol visited, Nest confirmed, No nest found, Protection set up, Hatched, Lost, Note).
- `AlertsFeed`: tabs **Active (n)** / **Inactive (n)** (radiogroup, keyboard arrows). Active = `alert.site.active`. Card adds protection pill + nesting text; inactive cards show the outcome/“Archived” and are dimmed. Clicking a card opens the drawer (and keeps the Plan A fly/seek behaviour).
- Map: inactive sites are not drawn; active sites older than `LIVE_FADE_MINUTES` (use 5; pass from server as `snapshot.fadeMinutes`) and with no person action render at 40 % opacity. Pins coloured by protection status when not time-gated (unprotected red ring, protected green ring); evidence tier keeps ring style (solid two-camera, dashed single-camera via `circle-stroke-dasharray`-free alternative: thinner stroke for single camera). Update Legend rows accordingly.
- `SiteDrawer` (right side sheet; bottom sheet on phones; Escape closes; focus trapped): header (zone, camera, simulated/live label), evidence (tier, score, times), a small static map close-up (reuse MapLibre at zoom 19 with the pin, no interaction), the log from `GET /api/sites/:id` newest first (type label, author, relative + absolute time, note), and `PatrolForm` for VOLUNTEER/ADMIN.
- `PatrolForm`: select of person actions; `hatched` disabled with hint "Confirm the nest first" unless `summary.nesting === 'confirmed'`; optional note (≤1000); submit → `POST /api/sites/:id/events`; shows server errors inline (409 text); on success reloads the log (the SSE refresh updates the map).
- Tests cover: tab counts and filtering; drawer hides the form for VIEWER; hatched disabled until confirmed; posting calls the endpoint and shows a 409 message.

Run `npx vitest run && npx tsc --noEmit && npx next build`; Playwright visual check (scratchpad) of feed tabs, drawer and a faded pin; commit:
```bash
git commit -m "feat(dashboard): live map refresh, active/inactive sites and patrol log drawer"
```

---

### Task 5: Analytics menu

**Files:** Create `src/app/(app)/analytics/page.tsx`, `src/features/analytics/AnalyticsScreen.tsx`, `src/features/analytics/charts.tsx`, `src/features/analytics/metrics.ts`; modify `src/features/shell/TopBar.tsx` (nav: **Map**, **Analytics**, Setup/Users for admin). Tests: `tests/unit/analytics-metrics.test.ts`, `tests/unit/analyticsScreen.test.tsx`.

- `metrics.ts` (pure, tested): from `AlertView[]` and scope (`map` = active only; `all` = everything in the snapshot) compute: total sites, unprotected (+%), patrol visited, seen by both cameras (% of sites with `evidenceTier === 'TWO_CAMERA'`), archived count, protection counts, nesting counts, sites by zone (all zones listed, zero allowed), and outcomes `{saved, notSaved, pending}` (from `snapshot.outcomes` for `all`, recomputed from active alerts for `map`).
- `AnalyticsScreen`: uses `useLiveSnapshot`; header "Tonight at a glance" + scope segmented control; tile row (tiles: Sites, Unprotected — red tone when > 0, Patrol visited, Seen by both cameras, Archived); **Outcomes** card with a stacked horizontal bar (Saved green, Not saved red, Pending grey) and numbers + percentages; three bar charts (protection, nesting, by zone) as hand-built SVG with labelled axes, values at bar ends, `role="img"` + `aria-label` summaries; empty state "No sites yet — waiting for the live feed".
- Works on phones (single column).
- Tests: metrics for a fixture set; screen renders tiles/outcomes; scope toggle changes totals.
Commit: `feat(dashboard): analytics menu with outcomes and site charts`.

---

### Task 6: Users page and roles

**Files:** Create `src/app/(app)/setup/users/page.tsx`, `src/app/(app)/setup/users/actions.ts`, `src/features/users/UsersScreen.tsx`, `src/lib/users/manage.ts`; modify `src/app/(app)/setup/page.tsx` (link to Users), TopBar (Users for admin). Tests: `tests/integration/users.test.ts`, `tests/unit/usersScreen.test.tsx`.

- `manage.ts` (DB functions, integration-tested): `createUser(prisma, actorId, { name, email, role })` → `{ user, temporaryPassword }` (password = 12 url-safe random chars, argon2-hashed; email lowercased/trimmed; duplicate email → `UserError('EMAIL_TAKEN')`); `setRole(prisma, actorId, userId, role)` (actor cannot change own role → `UserError('SELF')`); `setDisabled(prisma, actorId, userId, disabled)` (cannot disable self; sets/clears `disabledAt`); each writes `AuditLog` (`user.create`, `user.role`, `user.disable`/`user.enable`) and `publishChange('users')`.
- Server actions in `actions.ts` call `requireCurrentUser('ADMIN')` first and map `UserError` to `{ ok: false, error }`.
- `UsersScreen`: table (name, email, role select, status, actions); **Add person** form (name, email, role default VOLUNTEER); after creation a one-time panel shows the temporary password with Copy and the note "Shown once — share it privately"; disabled users dimmed with **Enable**.
- Integration tests: create volunteer → can be found, password verifies; duplicate email rejected; self role change / self disable rejected; disabled user → `currentUserOrNull` returns null (mock session cookie via a direct call with the user id is fine: test `currentUserOrNull` path by mocking `getSession`).
Commit: `feat(dashboard): admin users page with volunteer role`.

---

### Task 7: Camera editing — one-click pair facing the ocean

**Files:** Create `src/lib/cameras/placePair.ts`, `src/app/(app)/camera-actions.ts`; modify `MapControls.tsx` (Edit cameras toggle, admin only), `MapView.tsx` (click handler + crosshair in edit mode, delete buttons on admin-created zones), `MapScreen.tsx`. Tests: `tests/unit/placePair.test.ts`, `tests/integration/camera-actions.test.ts`.

- `placePair.ts` (pure):
```ts
export interface PairPlan { code: string; ring: LngLat[]; cameras: { code: string; position: LngLat; headingDeg: number }[] }
export function nextZoneCode(codes: string[]): string;                 // after the highest single letter; 'Z' taken → throws
export function planCameraPair(click: LngLat, zones: ZoneView[], codes: string[]): PairPlan;
```
  Rules: nearest zone by centroid distance (refuse if > 2000 m: throw `'Click closer to the beach'`); `along = bearingBetween(ring[1], ring[0])` of that zone (land-south→land-north); seaward = whichever of `along ± 90` brings a 30 m step closer to that zone's sea-edge midpoint; with no zones use along 39°, seaward 129°. Land edge: `landSouth = destinationPoint(click, along + 180, 60)`, `landNorth = destinationPoint(click, along, 60)`; sea corners = land corners moved 60 m seaward; `ring = [landNorth, landSouth, seaSouth, seaNorth, landNorth]`. Cameras: `<code>1` at `landNorth`, `<code>2` at `landSouth`, each heading = `bearingBetween(position, centroid)`. Tests: ring order and dimensions (±1 m), both headings within 45° of seaward, codes E after D, `Z` overflow throws, far click throws, no-zone default.
- `camera-actions.ts` (`'use server'`, `requireCurrentUser('ADMIN')`): `addCameraPair(click: LngLat)` → plan → one transaction creating Zone (`activityLevel LOW`, `createdById`), two Cameras (fov 60, range 90, ONLINE) + AuditLog `zone.create`; `publishChange('cameras')`; returns `{ ok, code }`. `deleteZone(code)` → only zones with `createdById` set and with no videos/alerts on their cameras; else `{ ok: false, error: 'This zone has footage or alerts; it cannot be removed.' }`.
- UI: **Edit cameras** button (pencil) in MapControls for admins; edit mode shows a banner "Click the dune line to add a camera pair · Esc to finish", crosshair cursor, map click → `addCameraPair` → toast-like inline confirmation "Zone E added"; admin-created zones show a small × on their label in edit mode → confirm → `deleteZone`.
- Live rotation automatically includes new zones (zones ordered by code).
Commit: `feat(dashboard): one-click camera pair placement facing the ocean`.

---

### Task 8: Bigger and resizable camera view

**Files:** Create `src/features/cameras/ExpandedFeed.tsx`, `src/features/cameras/usePanelWidth.ts`; modify `CameraPanel.tsx`, `MapScreen.tsx`. Tests: `tests/unit/expandedFeed.test.tsx`, `tests/unit/panelWidth.test.ts`.

- **Expand** button (lucide `Maximize2`) in the panel header for cameras with footage. Opens `ExpandedFeed`: centred overlay `min(1100px, 92vw)` 16:9, dark backdrop, Escape/close button, focus moved in and restored on close. The expanded overlay renders the `CameraVideo` (same `onTime`/`seekTo`); while expanded, the panel shows "Playing in expanded view" instead of a second player, so only one clock publishes.
- `usePanelWidth()`: width state 304–720 px (clamped), persisted in guarded localStorage (`nesttrace.panel.width`), default 304; a 6 px drag handle on the panel's left edge (desktop only, `cursor-col-resize`, keyboard: focusable, ←/→ change by 24 px) updates it. Tests: clamping, persistence fallback when storage throws, keyboard steps; expanded view keeps a single `camera-video` element.
Commit: `feat(dashboard): expandable and resizable camera view`.

---

### Task 9: End-to-end with the live runner, docs

- [ ] Start live runner for 2 chunks in the background (`node scripts/live-runner.mjs --chunks 2`), Compose stack with `LIVE_FEED=1`, Playwright (scratchpad, system Chrome) as admin and as a volunteer (create one through the Users page): new pins/alerts appear without reload; Analytics totals change; volunteer logs `nestConfirmed` then `hatched` on one site → it moves to Inactive and Saved increments; viewer cannot see the form; admin adds a camera pair (Zone E) and it renders; expand + resize the camera panel. Screenshots to `<scratchpad>/plan-c/`; look at each.
- [ ] Docs: `dashboard/README.md` sections "24-hour live feed" (run `npm run dev` at repo root + `node scripts/live-runner.mjs`; the dashboard watches `artifacts/public/live-*/live-chunk.json` read-only; fade/archive timings; env vars), "People and roles" (viewer/volunteer/admin, Users page), "Nest lifecycle and statistics" (events, Active/Inactive, saved/not saved definitions), "Editing cameras". `agent.md`: dashboard also reads `live-chunk.v1` through the watcher (public files only). `CLAUDE.md`: live feed command and `LIVE_FEED`.
- [ ] Full verification: root `npm test`; dashboard `npm run db:test:prepare && npx vitest run && npx tsc --noEmit && npx next build`.
- [ ] Commit: `docs(dashboard): live feed, roles, lifecycle and camera editing`.

---

## Self-review notes

- Spec §2 → Task 1; §3 → Task 3 (+ realtime client in Task 4); §4 → Tasks 2 + 4; §5 → Task 5; §6 → Tasks 2 (role, guard) + 6 (Users); §7 → Task 7; §8 → Task 8; §9 → tests in each task + Task 9.
- Spec corrections recorded here: no merge (copy three files); no demo patrol or toasts; `noNestFound` sites are excluded from saved/not-saved; hatched counts as saved even without logged protection (hatchlings emerged); pruned chunk media keeps DB rows (UI falls back to the status card).
- Carry-overs folded in: DB-backed guard for every mutation/route (Task 2), count queries for alert counts (Task 2), bounded snapshot (Task 2).
- Tasks 4–8 UI is given as behaviour lists (ruling, as in earlier plans); the reviewer checks every listed behaviour.
