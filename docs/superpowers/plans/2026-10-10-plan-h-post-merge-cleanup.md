# HatchWatch Dashboard: Plan H, Post-merge Cleanup (Cameras page, per-camera masks, Settings routes, rename): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up after merging `origin/main` (9a97558) into `feat/dashboard-fullstack`:
- delete the dead prototype;
- move `/setup` to `/settings`;
- restore the "Simulated" labels and label demo-patrol numbers;
- merge `/cameras` and `/live` into one **Cameras** page;
- make watch masks **per camera** so a person outside the mask never raises or appends to a camera alert;
- rename NestTrace to **HatchWatch** everywhere, keeping data and contracts safe;
- update the docs and the four Mermaid diagrams.

**Architecture:**
- **Masks:** stored on `Camera.maskPolygon` (normalised 0–1). The mask rule lives in **web**: `raiseCameraDanger` already loads the linked camera, so it also reads its mask and filters people by the bottom-centre of their box. The worker and the internal API do not change.
- **Grey boxes:** drawn client-side by `DetectionOverlay` using the same pure helper (`feetInMask` in `src/lib/cameras/masks.ts`). The overlay gets the mask from `CameraView.mask` in the snapshot, so there is no `inMask` flag on the wire.
- **Research mask file:** the dashboard rewrites `camera-masks.json` from the database after every mask change. It has a new `by_code` map plus derived per-slot `cameras[]` entries that the existing runner and `pipeline/extract.py` keep reading unchanged.
- **Routes:** old routes become permanent redirects in `next.config.ts` (one list in `src/lib/legacyRoutes.ts`).
- **Rename order:** first add old-name compatibility to every reader (motion header, schema ids, recording sidecar, storage keys, env vars). Rebuild the containers. Only then switch writers and firmware, and re-flash the live ESP32.

**Tech Stack:** Next.js 16.4.0 App Router, React 19.3.0, TypeScript, Prisma 7.10.0 + Postgres 16, zod 4.6.5, Vitest 5.0.3. Python 3.12 worker (pytest 9.1.1). Root research suite (`npm test`: tsc + pytest). Arduino ESP32 core 3.x through `firmware/esp32s3-cam/tools/board.py`. Playwright from the repo-root `node_modules/playwright` for screenshots. Mermaid CLI `@mermaid-js/mermaid-cli@11.4.2` with system Chrome. No new npm or pip packages.

**Spec:** `docs/superpowers/specs/2026-10-10-post-main-merge-cleanup-design.md` (binding). Boundaries: `agent.md`, `CLAUDE.md`. Background: `<scratchpad>/main-compare.md` (what main added). Builds on Plans E, F and G on `feat/dashboard-fullstack` at c510911.

## Global Constraints

- **Simulated labels (spec §1), exact strings, simulated footage only:**
  - the video badge `Simulated` when `video.source === 'SIMULATION'`;
  - the camera panel note `Simulated footage · pins placed approximately`;
  - the alert card note `Simulated · approximate position` + tier note when `alert.simulated`;
  - the site drawer source line `Live simulator feed` (simRunId starts with `live-`), `Simulated run` (`alert.simulated`), `Recorded clip` (other `simRunId`), else `Camera footage`.
  Real phone and board footage keep their `LIVE` labels.
- **Demo data (spec §2):** keep `DEMO_PATROL=1`. Every place that counts outcomes or patrol actions shows exactly `Includes demo patrol (simulated)` whenever any counted entry was written by `DEMO_PATROL_AUTHOR` (`'Demo patrol (simulated)'`). No number is hidden or changed.
- **Cameras page (spec §3):**
  - **Route:** one page at `/cameras`. `/live` redirects to `/cameras` and `/live/motion` to `/cameras/motion`, keeping the query.
  - **Layout:** map cameras grouped by zone, plus a **Devices** section and the header actions (Detections, Connect phone, Add board camera). Admins also get the Recordings list.
  - **Linked device:** online → live picture with `LIVE`, the detections overlay and (boards) the motion badge. Offline → `Phone offline` / `Board offline` over the recorded clip.
  - **Unlinked camera:** the recorded clip with `Simulated`.
  - **Navigation:** one top-bar item `Cameras`.
- **Masks (spec §4):**
  - **Storage:** `Camera.maskPolygon` holds normalised 0–1 picture coordinates as a closed polygon of **3–64 points**. It is edited from **Settings → Cameras** (admin) over the camera's current picture: the live device picture if linked, else the latest clip. The editor says the mask applies to that camera only.
  - **No mask** means the whole picture counts.
  - **Alert rule:** a person counts toward the camera danger alert only if the **bottom-centre of its box** is inside the linked camera's mask. People outside it are drawn in **grey**, labelled `outside watch area`, and **never raise or append to** an alert.
  - **Research file:** the dashboard keeps writing `camera-masks.json` in `artifacts/operator` (`MASKS_ROOT`), keyed per camera code, with the old per-slot `cameras[]` keys derived so existing runner versions keep working. No registered experiment code path changes.
- **Routes (spec §5):** `/setup` → `/settings`, `/setup/users` → `/settings/users`, `/setup/cameras` → `/settings/cameras`. The old paths redirect **permanently** (308), and every link, test and doc is updated.
- **Rename (spec §6):**
  - **Rename** every user-visible string, code identifier, package name, living doc, firmware text, page title, log prefix and localStorage key. Old localStorage keys are read once and migrated.
  - **Kept:** the Postgres database and user names (`nesttrace`, `nesttrace_test`), the Compose project `nesttrace-dashboard`, its container names and the volumes `pgdata`/`caddy_data`.
  - **Dual-accept:**
    - the dashboard accepts `X-HatchWatch-Motion` **and** `X-NestTrace-Motion`;
    - importers accept `hatchwatch.*` **and** `nesttrace.*` for `live-chunk`, `tracks`, `people`, `recording` and `camera_masks`;
    - new files are written with the new names only where the research code is not frozen.
- **Frozen research files** (`pipeline/*`, `config/*`, `results/*`, `*RESULTS.md`) are **not edited**. `config/camera-masks.json` keeps `nesttrace.camera_masks`.
- **Alert wording** stays exactly `Digging activity detected; nesting unresolved.`. Scores are not probabilities, and an alert never says "confirmed nest".
- **Live ESP32:** the board `ESP32-S3 GC0308`, linked to **E1**, must keep uploading at every commit. The header dual-accept ships and is deployed (Task 7) **before** the firmware sends the new header (Task 8, re-flash with `board.py flash`).
- **Commits:** only the user as author, with **no `Co-Authored-By` and no AI attribution** in any message. Stage **explicit paths** only.
  - Never stage `artifacts/`, `dashboard/media/`, `dashboard/recordings/`, `.superpowers/`, any `.env`, `firmware/**/secrets.h`, `*.onnx`, `.venv`, `dashboard/worker/models/`, `.DS_Store`.
  - Run `git status --short` before every commit. Do not push.
- **Code style:** follow the existing files: Allman braces, 4-space indent, single quotes, `@/` imports, one-line comments only where the reason is not obvious. Python: 4-space indent, single quotes, type hints.

## Review Focus

1. **The rename breaks a contract or loses data.** Examples:
   - the running ESP32 sends `X-NestTrace-Motion` and its motion badge goes blank;
   - an old live chunk or recording sidecar (`nesttrace.*`) is refused;
   - an old localStorage value is dropped;
   - the Compose project, volume or DB name changes and Postgres comes up empty;
   - the seed creates a second viewer because `viewer@nesttrace.local` was renamed.
   Pinned in **Task 7** (`motionHeader.test.ts` both headers, `live-phones.test.ts` board POST with each header, `live-manifest.test.ts`/`danger.test.ts`/`recorder.test.ts` both ids, `storageKeys.test.ts` migration) and **Task 8** (`naming.test.ts` allowlist, `compose-names.test.ts` keeps DB/project/volume names). Also **Task 9** Step 4: `docker volume ls` still lists `nesttrace-dashboard_pgdata`, and the alert count is unchanged after the rebuild.
2. **The mask rule lets an outside person raise or append to an alert.** Examples:
   - the head instead of the feet is tested;
   - the mask is normalised against CSS pixels instead of picture pixels;
   - an outside person consumes the throttle slot and hides an inside one;
   - repeat sightings outside still append;
   - an empty or invalid stored mask blocks every alert or allows every person.
   Pinned in **Task 6** `tests/unit/cameraDanger.test.ts` (inside, outside, edge, no mask) and `tests/integration/live-detection.test.ts` (outside never raises; outside never appends to an open alert; no mask = whole picture; mask cleared restores alerts), and `tests/unit/masks.test.ts` (`pointInMask`, `feetPoint`).
3. **Redirects loop or 404.** Examples:
   - a destination is also a source;
   - the query (`?device=`) is dropped;
   - the old page file still exists and shadows the redirect;
   - a link still points to `/setup` or `/live`.
   Pinned in **Task 2/4** `tests/unit/redirects.test.ts` (permanent, loop-free, destination page exists, source page gone), the `curl` checks in Task 4 Step 6 and Task 9 Step 4, and the `git grep` gate in Task 9 Step 1.
4. **Deleting the prototype removes something still used.** Examples:
   - a test fixture, `.gitignore` entry or doc path that the live app or the research suite reads;
   - a file that the Next app imports.
   Pinned in **Task 1** (reference grep, full dashboard and root suites, `next build`) and the boundary scan.
5. **The combined Cameras page regresses Plan E/F/G features.** Examples:
   - the Detections toggle not remembered;
   - "Detection off" / "Too dark to detect" missing;
   - the board motion box gone;
   - Rotate token / Remove / Add board / Connect phone lost;
   - recordings hidden from admins or shown to viewers;
   - viewers seeing admin controls;
   - a linked online device still looping the clip.
   Pinned in **Task 4** `tests/unit/allCamerasScreen.test.tsx`, which carries every case from the old `liveScreen.test.tsx` plus the new card states, and in **Task 9** Step 5 (Playwright on the real stack with the ESP32).

## Spec ambiguities resolved in this plan

1. **Where the mask check lives: web, not the worker.** `raiseCameraDanger` already queries the device's linked camera, so it also selects `maskPolygon`. The worker would otherwise need masks through `/api/internal/devices`, which is a contract change for no gain. The detections payload (`parseDetections`, strict zod) is unchanged.
2. **Grey rendering is client-side.** `CameraView` gains `mask`, and `DetectionOverlay` takes a `mask` prop and calls the same `feetInMask` the server uses. Unlinked devices pass `null`, so everything counts. No `inMask` field is added to the wire format.
3. **Feet point** = `[(x + w/2) / width, (y + h) / height]`, using the detection result's own `width`/`height` (picture pixels). A point exactly on a mask edge counts as **inside**.
4. **Valid mask:**
   - 3–64 points, each finite and in `[0, 1]`;
   - a repeated closing point is dropped;
   - shoelace area ≥ `0.0001` of the picture;
   - points are rounded to 4 decimals on save;
   - self-intersecting outlines are allowed and tested with the even-odd rule.
   A stored value that fails validation is treated as **no mask** (whole picture) and logged once. Writes are validated, so this happens only after manual DB edits.
5. **Cheap pre-check, then mask:** `raiseCameraDanger` first runs `qualifyingPerson(detections)` with no mask, so a frame with no qualifying person skips the DB entirely as before. It then loads the camera and re-runs it with the mask. It calls `throttle.take` only when a person inside the mask qualifies, so outside people never use up the 5 s slot.
6. **Research file layout (no frozen file touched).** `pipeline/extract.py` `load_mask` iterates `cameras[]` and calls `int(entry.get('camera'))`, so every `cameras[]` entry must keep a numeric `camera`. Per-camera masks therefore go in a new top-level `by_code` map. The existing `importChunk` `maskFileSchema` ignores unknown top-level keys.
7. **Deriving the old per-slot keys.**
   - **Slot of a camera code:** live chunks put manifest camera 0 (`x_min`) on odd-numbered cameras (`<zone>1/3/5/7`) and camera 1 on even ones (`importChunk.ts` lines 85–100). So slot = 0 for odd codes and 1 for even codes.
   - **Slot polygon:** the most recently saved mask among cameras of that parity (`Camera.maskUpdatedAt`), converted to 1280×720 pixels.
   - **No masked camera of that parity:** use the repo default entry from `config/camera-masks.json` (read only).
   - **What the editor says:** the mask applies to the camera only for alerts. For simulated clips it shows the slot sharing in one sentence.
8. **Legacy operator file.** If `<MASKS_ROOT>/camera-masks.json` exists without `by_code` (written by main's editor), the first sync copies it once to `camera-masks.legacy.json`. No legacy per-slot polygon is imported into `Camera` rows: cameras start with **no mask** (whole picture), which matches today's alert behaviour. `artifacts/operator` does not exist on this machine today.
9. **Masks API.**
   - `PUT /api/cameras/masks` now takes `{ code, polygon }`, where `polygon` is normalised or `null` to clear. It is ADMIN only, writes an audit row `camera.mask`, publishes `cameras`, then syncs the research file.
   - The old `{ camera: <int> }` body gets **400** with a message.
   - `GET` stays for any signed-in user and also returns `byCode`.
   - A failed research-file write never fails the save. The response says `researchFile: 'failed'` and the editor shows a warning.
   - Renaming or deleting a camera re-syncs the file.
10. **`MAX_MASK_POINTS` becomes 64** for both normalised and pixel helpers, so `Video.maskPolygon` from runner chunks (now up to 64 points) still draws in `CameraVideo`.
11. **Demo-patrol detection.**
    - `AlertView.demoPatrol` is true when any loaded event on that site has author `DEMO_PATROL_AUTHOR`.
    - `MapSnapshot.outcomesIncludeDemoPatrol` is true when any `SiteEvent` in the database has that author, because outcomes cover the whole log.
    - `/api/analytics/history` returns `demoPatrolEntries` for the window.
    - "Patrol response times" exists only in the dead prototype (`dashboard/src/components/ResponseTimes.jsx`), so the live app has no such view to label.
12. **Offline label kind.** Viewers only receive online devices from `/api/live/devices`, so the card gets the device kind from the snapshot. `CameraView.liveDevice` gains `kind`. A linked device is "offline" when the devices list has loaded and has no online entry with that id. `useLiveDevices` gains `loaded` so the first render does not flash "offline".
13. **Redirect mechanism:** `next.config.ts` `redirects()` with `permanent: true` (308; Next keeps the query string). The page files at the old paths are removed, so nothing can shadow a redirect.
14. **Kept names beyond the spec's list, for data safety.** The seeded account emails `viewer@nesttrace.local` (`DEMO_VIEWER`) and `admin@nesttrace.local` (`.env.example`) stay. `seed.ts` runs on every container start and looks users up by email, so renaming them would create second accounts. Test-only emails in `users.test.ts`/`usersScreen.test.tsx` are renamed.
15. **Historical docs are not rewritten.** Dated plans and specs under `docs/superpowers/` (146 occurrences) describe what was built under the old name and cite old paths. Living docs (README, dashboard README, CLAUDE.md, agent.md, firmware README, `GOAL_TODOS.md`, `schemas/*`) are renamed. `docs/BRANCH_INTEGRATION.md`'s `codex/nesttrace` is a git branch name and stays.
16. **Env vars:** `HATCHWATCH_BROWSER` and `HATCHWATCH_SIM_CHECK` are read first, with `NESTTRACE_*` as fallback. These are research scripts (not frozen), and the lookup does not change any output.
17. **The optional runner change** (prefer `by_code`) is **not** done. `scripts/live-runner.mjs` only changes its written `schema` id and the `NESTTRACE_*` fallbacks, so no registered experiment code path changes.

---

## Rename survey (`git grep -n -i nesttrace | wc -l` = 310 at c510911)

| Class | Count | Action |
|---|---|---|
| Historical docs (`docs/superpowers/plans|specs`) | 146 | kept (ambiguity 15) |
| Code identifiers (`nesttrace_worker` package + imports + logger, `__nesttrace*` globals, temp-dir prefixes) | 42 | renamed (Task 8) |
| Contract schema ids (`nesttrace.live-chunk/tracks/people/recording/camera_masks`, schema `$id`/titles, fixtures) | 29 | dual-accept readers (Task 7), new writers (Task 8); `config/camera-masks.json` frozen |
| Dead prototype (`dashboard/src|server|test`) | 23 | deleted (Task 1) |
| User-visible text (`/cam` title, CamSender, boardSecrets comment, firmware page/banner/comments, `board.py` text, `web/main.ts` footer, esp32 contract prose, firmware README) | 15 | renamed (Task 8); 1 of them (`docs/BRANCH_INTEGRATION.md` branch name) kept |
| Env vars (`NESTTRACE_BROWSER`, `NESTTRACE_SIM_CHECK`) | 13 | new name first, old fallback (Task 7) |
| DB / Docker / seeded data (compose project + Postgres user/db/healthcheck, `.env.example` URLs + admin email, `nesttrace_test`, `viewer@nesttrace.local`) | 13 | kept (spec §6 + ambiguity 14) |
| Motion header (`X-NestTrace-Motion` in code, firmware, docs, tests) | 12 | dual-accept (Task 7), firmware sends new (Task 8) |
| localStorage keys (5 in src, 5 in tests) | 10 | `hatchwatch.*` with one-time migration (Task 7) |
| Test-only emails (`@nesttrace.local` in user tests) | 6 | renamed (Task 8) |
| Frozen research (`config/camera-masks.json`) | 1 | kept |

After Plan H, `git grep -n -i nesttrace` may only match the kept rows: historical docs, DB/Docker/seed names, `config/camera-masks.json`, `docs/BRANCH_INTEGRATION.md`, and the legacy-name constants in `dashboard/web/src/lib/legacyNames.ts`, the scripts' env fallbacks, the schemas' `enum`s, the README rename note and the compatibility tests.

---

## File Structure

```
dashboard/src/, dashboard/server/, dashboard/test/                  T1  deleted (22 files)
dashboard/.gitignore                                                T1  drop server-data/
dashboard/web/
  next.config.ts                                                    T2  redirects() from LEGACY_ROUTES
  src/lib/legacyRoutes.ts                                           T2  setup→settings; T4 live→cameras
  src/app/(app)/settings/{page.tsx,users/page.tsx,users/actions.ts,cameras/page.tsx}   T2  git mv from setup/
  src/features/shell/TopBar.tsx                                     T2  Page 'settings'; T4 drop 'live'
  src/app/(app)/camera-actions.ts                                   T2  revalidate /settings/cameras; T5 mask sync on code change/delete
  src/features/cameras/CameraVideo.tsx                              T3  Simulated badge back
  src/features/cameras/CameraPanel.tsx                              T3  simulated note; T4 motion link, Board offline; T6 mask to overlay
  src/features/alerts/AlertsFeed.tsx, src/features/sites/SiteDrawer.tsx   T3  labels back
  src/server/snapshot.ts, src/lib/types.ts                          T3  demoPatrol flags; T4 liveDevice.kind; T5 CameraView.mask
  src/app/api/analytics/history/route.ts                            T3  demoPatrolEntries
  src/features/analytics/{AnalyticsScreen.tsx,HistorySheet.tsx,DemoPatrolNote.tsx}   T3
  src/app/(app)/cameras/{page.tsx,actions.ts,motion/page.tsx}       T4  (actions + motion git mv from live/)
  src/app/(app)/live/                                               T4  deleted
  src/features/cameras/AllCamerasScreen.tsx                         T4  combined page
  src/features/phones/{DeviceTile.tsx,DevicesPanel.tsx}             T4  split out of LiveScreen.tsx (deleted)
  src/features/phones/{useLiveDevices.ts,MotionScreen.tsx}          T4  loaded flag; links
  prisma/schema.prisma + migrations/20261010170000_camera_mask_polygon   T5
  src/lib/cameras/masks.ts                                          T5  normalised helpers; T6 pointInMask/feet
  src/lib/cameras/researchMasks.ts                                  T5  build + sync camera-masks.json
  src/lib/cameras/maskStore.ts                                      T5  read only (writeMask removed)
  src/lib/cameras/cameraMask.ts                                     T5  setCameraMask (DB + audit)
  src/app/api/cameras/masks/route.ts                                T5  { code, polygon }
  src/features/cameras/{MaskEditor.tsx,CamerasScreen.tsx}           T5
  src/lib/cameras/manage.ts                                         T5  CameraRow.mask
  src/lib/detections/cameraDanger.ts                                T6  mask rule
  src/features/phones/DetectionOverlay.tsx                          T6  grey + outline
  src/lib/legacyNames.ts, src/lib/storageKeys.ts                    T7
  src/lib/phones/{motionHeader.ts,http.ts,recorder.ts}              T7  dual-accept
  src/lib/live/manifest.ts, src/lib/sim/schema.ts                   T7  dual-accept
  src/features/map/{useStoredBoolean.ts,Legend.tsx}, src/features/alerts/AlertsFeed.tsx,
  src/features/cameras/usePanelWidth.ts, src/features/phones/{camMessages.ts,CamSender.tsx,useDetectionsToggle.ts}   T7 keys
  src/app/cam/page.tsx, src/lib/phones/boardSecrets.ts, src/lib/{changes.ts,live/watcher.ts,phones/frameStore.ts}   T8
  tests/unit/{redirects,storageKeys,naming,compose-names,researchMasks,maskEditor,allCamerasScreen}.test.ts(x)   new
  tests/integration/{camera-mask,analytics-history}.test.ts         new
dashboard/worker/hatchwatch_worker/ (git mv from nesttrace_worker/), Dockerfile, tests/*   T8
schemas/camera-masks.v1.json, schemas/examples/camera-masks.v1.example.json   T5
schemas/{live-chunk,tracks,people}.v1.json, schemas/esp32-frame.v1.md         T7
tests/test_camera_masks_contract.py                                 T5  runner reads dashboard-written file
scripts/{record,browser-check,multi-check,pin-browser-check,swarm-check,sim-frame-hash}.mjs, tests/test_sim_defaults.py   T7 env fallback
scripts/{live-runner.mjs,track_paths.py,people_detect.py,analyze.py,lowlight_probe.py,lowlight_threshold_grid.py}, tests/test_{track_paths,people_detect}.py, web/main.ts   T8
firmware/esp32s3-cam/{uplink.cpp,uplink.h,esp32s3-cam.ino,web_page.h,README.md,tools/board.py}   T8 (+ re-flash)
README.md, dashboard/README.md, CLAUDE.md, agent.md, GOAL_TODOS.md  T9
```

---

### Task 1: Delete the dead prototype

The prototype comes from main (`dashboard/src/`, `dashboard/server/`, `dashboard/test/`; 22 tracked files; no `package.json`, broken imports). Nothing outside it imports it. It is mentioned only in historical docs and in `dashboard/.gitignore` (`server-data/`).

**Files:**
- Delete: `dashboard/src/**`, `dashboard/server/**`, `dashboard/test/**` (including `test/fixtures/live-000001-fixture/camera-{0,1}.mp4`)
- Modify: `dashboard/.gitignore` (remove the `server-data/` line)

- [ ] **Step 1: Prove nothing else uses it** (expected output: only historical docs under `docs/superpowers/` and `docs/BRANCH_INTEGRATION.md`):

```bash
git grep -n -E "dashboard/(src|server|test)\b|liveChunkAdapter|nestStore|NestCharts|beachLayout|liveDataSource|responseTimes|AlertToasts|FeedStatusBanner|ResponseTimes|demoPatrol\.js|server-data|:5182" -- ':!dashboard/src' ':!dashboard/server' ':!dashboard/test'
grep -rn "\.\./src\|\.\./server\|\.\./test" dashboard/web/src dashboard/web/tests dashboard/web/*.ts dashboard/web/Dockerfile dashboard/docker-compose.yml   # expect nothing
```

If anything outside docs matches, stop and report it instead of deleting.

- [ ] **Step 2: Delete**

```bash
git rm -r -q dashboard/src dashboard/server dashboard/test
```
Remove the `server-data/` line from `dashboard/.gitignore`.

- [ ] **Step 3: Verify every suite** (Docker `db` running; `TEST_DATABASE_URL` from `dashboard/web/.env`):

```bash
cd dashboard/web && npx tsc --noEmit && npx vitest run && npx next build
cd ../worker && .venv/bin/pytest -q
cd ../.. && npm test
```
Expected: all green, with the same test counts as before the deletion (the prototype had no runner, so no Vitest/pytest count changes).

- [ ] **Step 4: Commit**

```bash
git status --short
git add -A dashboard/src dashboard/server dashboard/test dashboard/.gitignore
git commit -m "chore(dashboard): delete the dead React/Vite prototype resurrected by the main merge"
```

---

### Task 2: Settings routes and permanent redirects

**Files:**
- Create: `dashboard/web/src/lib/legacyRoutes.ts`, `dashboard/web/tests/unit/redirects.test.ts`
- Move (`git mv`): `src/app/(app)/setup` → `src/app/(app)/settings`
- Modify: `next.config.ts`, `src/app/(app)/settings/page.tsx` (links, `SettingsPage`, `current="settings"`), `src/app/(app)/settings/users/actions.ts` (`revalidatePath('/settings/users')`), `src/app/(app)/camera-actions.ts` (`revalidatePath('/settings/cameras')`), `src/features/shell/TopBar.tsx`, `src/features/cameras/CamerasScreen.tsx` (`current="settings"`), `src/features/users/UsersScreen.tsx` (import path `@/app/(app)/settings/users/actions`), `src/features/phones/LiveScreen.tsx` (devices hint "Link one to a map camera from Settings → Cameras or the camera panel."), tests `analyticsScreen.test.tsx`, `usersScreen.test.tsx` (mock path)

**Interfaces:**
```ts
// src/lib/legacyRoutes.ts
// Old paths kept working for bookmarks and QR codes; served as permanent (308) redirects from next.config.ts.
export const LEGACY_ROUTES: { source: string; destination: string }[] = [
    { source: '/setup', destination: '/settings' },
    { source: '/setup/users', destination: '/settings/users' },
    { source: '/setup/cameras', destination: '/settings/cameras' },
];

// next.config.ts (added)
import { LEGACY_ROUTES } from './src/lib/legacyRoutes';
    async redirects()
    {
        return LEGACY_ROUTES.map(route => ({ ...route, permanent: true }));
    },

// TopBar.tsx
export type Page = 'map' | 'cameras' | 'analytics' | 'live' | 'settings' | 'users';   // 'live' goes in Task 4
{ page: 'settings', href: '/settings', label: 'Settings', adminOnly: true },
const here = item.page === current || (item.page === 'settings' && current === 'users');
```

- [ ] **Step 1: Failing tests.** `tests/unit/redirects.test.ts`:

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';

const appDir = join(import.meta.dirname, '..', '..', 'src', 'app', '(app)');

describe('legacy routes', () =>
{
    it('redirect permanently to pages that exist, without loops', async () =>
    {
        const redirects = await nextConfig.redirects!();
        expect(redirects.map(r => [r.source, r.destination, 'permanent' in r && r.permanent])).toEqual([
            ['/setup', '/settings', true],
            ['/setup/users', '/settings/users', true],
            ['/setup/cameras', '/settings/cameras', true],
        ]);
        const sources = new Set(redirects.map(r => r.source));
        for (const r of redirects)
        {
            expect(sources.has(r.destination), r.destination).toBe(false);
            expect(existsSync(join(appDir, r.destination, 'page.tsx')), r.destination).toBe(true);
            expect(existsSync(join(appDir, r.source, 'page.tsx')), r.source).toBe(false);
        }
    });
});
```
In `analyticsScreen.test.tsx`, change both `.toBe('/setup')` to `.toBe('/settings')`. Run `npx vitest run tests/unit/redirects.test.ts tests/unit/analyticsScreen.test.tsx`: it fails.

- [ ] **Step 2: Implement** the move, `legacyRoutes.ts`, `next.config.ts`, the TopBar, and the paths listed above. Then:
```bash
grep -rn "/setup\|'setup'\|\"setup\"" dashboard/web/src dashboard/web/tests   # only legacyRoutes.ts and redirects.test.ts
```

- [ ] **Step 3: Verify**
```bash
cd dashboard/web && npx tsc --noEmit && npx vitest run && npx next build
```
Then the runtime check: run `npx next start -p 3100 &`, then:
```bash
for p in /setup /setup/users /setup/cameras; do curl -s -o /dev/null -w "$p %{http_code} %{redirect_url}\n" http://127.0.0.1:3100$p; done
```
Expected: `308 http://127.0.0.1:3100/settings…` for each. `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:3100/settings` redirects to `/login` (signed out), not back to `/setup`. Stop the server afterwards.

- [ ] **Step 4: Commit**
```bash
git status --short
git add dashboard/web/next.config.ts dashboard/web/src/lib/legacyRoutes.ts "dashboard/web/src/app/(app)/settings" "dashboard/web/src/app/(app)/setup" "dashboard/web/src/app/(app)/camera-actions.ts" dashboard/web/src/features/shell/TopBar.tsx dashboard/web/src/features/cameras/CamerasScreen.tsx dashboard/web/src/features/users/UsersScreen.tsx dashboard/web/src/features/phones/LiveScreen.tsx dashboard/web/tests/unit/redirects.test.ts dashboard/web/tests/unit/analyticsScreen.test.tsx dashboard/web/tests/unit/usersScreen.test.tsx
git commit -m "feat(dashboard): move Setup to /settings with permanent redirects from /setup"
```

---

### Task 3: Restore the Simulated labels; label demo-patrol numbers

**Files:**
- Modify: `src/features/cameras/CameraVideo.tsx`, `src/features/cameras/CameraPanel.tsx`, `src/features/alerts/AlertsFeed.tsx`, `src/features/sites/SiteDrawer.tsx`
- Modify: `src/lib/types.ts`, `src/server/snapshot.ts`, `src/app/api/analytics/history/route.ts`, `src/features/analytics/AnalyticsScreen.tsx`, `src/features/analytics/HistorySheet.tsx`
- Create: `src/features/analytics/DemoPatrolNote.tsx`, `tests/integration/analytics-history.test.ts`
- Tests: `tests/unit/cameraVideo.test.tsx`, `tests/unit/mapScreen.test.tsx`, `tests/unit/alertsFeed.test.tsx`, `tests/unit/siteDrawer.test.tsx`, `tests/unit/analyticsScreen.test.tsx`, `tests/unit/snapshot.test.ts`, `tests/integration/snapshot.test.ts`

**Interfaces:**
```ts
// types.ts
export interface AlertView { /* … */ demoPatrol?: boolean }               // any entry on this site by DEMO_PATROL_AUTHOR
export interface MapSnapshot { /* … */ outcomesIncludeDemoPatrol?: boolean } // any SiteEvent in the log by DEMO_PATROL_AUTHOR

// DemoPatrolNote.tsx
export const DEMO_PATROL_NOTE = 'Includes demo patrol (simulated)';
export function DemoPatrolNote({ className }: { className?: string }): JSX.Element   // <p role="note"> with the exact text

// history route JSON gains:
demoPatrolEntries: number   // SiteEvent rows by DEMO_PATROL_AUTHOR with createdAt in [from, now]
```

**Behaviour (exact):**
1. **CameraVideo:** when `video.source === 'SIMULATION'`, render `<span className="absolute top-2 left-2 rounded-md bg-night-950/80 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.14em] text-amber uppercase ring-1 ring-amber/40">Simulated</span>` (the pre-merge markup). Main's "Watch mask" label stays at top right.
2. **CameraPanel:** `const simulated = camera.video?.source === 'SIMULATION' && !showLive;`. Keep main's motion-map RMSE line. The info block shows when `simulated || (!camera.calibrated && !camera.video?.motionMap)`, with the text `simulated ? 'Simulated footage · pins placed approximately' : 'Calibrate this camera in Settings to place its tracks on the map.'`.
3. **AlertsFeed:** `alert.simulated` → `Simulated · approximate position{tier}`. Otherwise, if `alert.evidenceTier` is set → `Approximate position{tier}` (main's line).
4. **SiteDrawer `sourceLabel`:** `live-` prefix → `Live simulator feed`, `alert.simulated` → `Simulated run`, `alert.simRunId` → `Recorded clip`, else `Camera footage`.
5. **snapshot.ts:**
   - in `toMapSnapshot`, set `demoPatrol: alert.events.some(event => event.author === DEMO_PATROL_AUTHOR)` on each alert;
   - in `getMapSnapshot`, add `prisma.siteEvent.findFirst({ where: { author: DEMO_PATROL_AUTHOR }, select: { id: true } })` to the `Promise.all` and pass `outcomesIncludeDemoPatrol: Boolean(row)` through `toMapSnapshot`;
   - import `DEMO_PATROL_AUTHOR` from `@/lib/live/demoPatrol` (snapshot.ts is server-only).
6. **AnalyticsScreen (map scope):**
   - show `<DemoPatrolNote/>` under the tiles row when `snapshot.outcomesIncludeDemoPatrol || charted alerts some(a => a.demoPatrol)`;
   - inside `Outcomes` when `outcomesIncludeDemoPatrol` (the outcomes cover the whole log).
7. **HistorySheet:** when `history.demoPatrolEntries > 0`, show `<DemoPatrolNote/>` next to the window line. Its Patrol, Protected and No nest columns include those rows.

- [ ] **Step 1: Failing tests**
  - `cameraVideo.test.tsx`: the first case becomes `'loops the camera feed muted with the Simulated badge'`, expecting `getByText('Simulated')` for `source: 'SIMULATION'`. Add a case for `source: 'UPLOAD'` with `queryByText('Simulated')` null.
  - `mapScreen.test.tsx:132`: `expect(screen.getByText('Simulated footage · pins placed approximately')).toBeTruthy()`.
  - `alertsFeed.test.tsx`: a `simulated: true, evidenceTier: 'TWO_CAMERA'` alert shows `Simulated · approximate position · both cameras`; a non-simulated one with a tier shows `Approximate position · one camera`.
  - `siteDrawer.test.tsx`: the four `sourceLabel` cases.
  - `snapshot.test.ts` (`toMapSnapshot`): an alert with an event authored `'Demo patrol (simulated)'` → `demoPatrol: true`, otherwise `false`. `outcomesIncludeDemoPatrol` passes through.
  - `analyticsScreen.test.tsx`: the note is absent by default and present (once under the tiles, once in Outcomes) when `outcomesIncludeDemoPatrol: true`. History: mock fetch with `demoPatrolEntries: 2` → note present; `0` → absent.
  - `tests/integration/analytics-history.test.ts`: seed, then create one demo-authored `patrolVisit` and one person-authored `protectionInstalled`. `GET` (call the route's `GET` with a signed-in `currentUserOrNull` mock, as in `site-routes.test.ts`) returns `demoPatrolEntries: 1`, and the `patrol`/`protected` counts are unchanged (1 each).
  - `tests/integration/snapshot.test.ts`: `outcomesIncludeDemoPatrol` is false on a fresh seed and true after one demo-authored event.

- [ ] **Step 2: Implement** behaviours 1–7. History SQL addition (one more query in the same handler):
```ts
const [{ count: demoPatrolEntries }] = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM "SiteEvent" WHERE author = ${DEMO_PATROL_AUTHOR} AND "createdAt" >= ${from} AND "createdAt" <= ${now}`;
```

- [ ] **Step 3: Verify:** `cd dashboard/web && npx tsc --noEmit && npx vitest run`.

- [ ] **Step 4: Commit**
```bash
git add dashboard/web/src/features/cameras/CameraVideo.tsx dashboard/web/src/features/cameras/CameraPanel.tsx dashboard/web/src/features/alerts/AlertsFeed.tsx dashboard/web/src/features/sites/SiteDrawer.tsx dashboard/web/src/lib/types.ts dashboard/web/src/server/snapshot.ts dashboard/web/src/app/api/analytics/history/route.ts dashboard/web/src/features/analytics/AnalyticsScreen.tsx dashboard/web/src/features/analytics/HistorySheet.tsx dashboard/web/src/features/analytics/DemoPatrolNote.tsx dashboard/web/tests/unit/cameraVideo.test.tsx dashboard/web/tests/unit/mapScreen.test.tsx dashboard/web/tests/unit/alertsFeed.test.tsx dashboard/web/tests/unit/siteDrawer.test.tsx dashboard/web/tests/unit/analyticsScreen.test.tsx dashboard/web/tests/unit/snapshot.test.ts dashboard/web/tests/integration/snapshot.test.ts dashboard/web/tests/integration/analytics-history.test.ts
git commit -m "feat(dashboard): restore Simulated labels and mark demo-patrol numbers in analytics"
```

---

### Task 4: One Cameras page; `/live` redirects

**Files:**
- Move (`git mv`): `src/app/(app)/live/actions.ts` → `src/app/(app)/cameras/actions.ts` (every `revalidatePath('/live')` becomes `revalidatePath('/cameras')`). `src/app/(app)/live/motion/page.tsx` → `src/app/(app)/cameras/motion/page.tsx`.
- Delete: `src/app/(app)/live/page.tsx`, `src/features/phones/LiveScreen.tsx`
- Create: `src/features/phones/DeviceTile.tsx` (moved from LiveScreen: `RecBadge`, `MotionBox`, `MotionBadge`, `LivePicture`, `Expanded`, `Tile` exported as `DeviceTile`). `src/features/phones/DevicesPanel.tsx` (moved: `lastSeen`, `DeviceRow`, and a `DevicesPanel({ devices, onRemoved })` wrapping the `Devices` section).
- Modify: `src/app/(app)/cameras/page.tsx` (adds the admin `connect` QR exactly as the old live page), `src/features/cameras/AllCamerasScreen.tsx`, `src/features/shell/TopBar.tsx`, `src/features/phones/MotionScreen.tsx` (`current="cameras"`, back links `/cameras`), `src/features/cameras/CameraPanel.tsx` (Motion view → `/cameras/motion?device=…`; `Board offline · {name}` when `phone.kind === 'BOARD'`), `src/features/phones/useLiveDevices.ts` (`loaded`), `src/features/phones/BoardToken.tsx` (import path), `src/lib/legacyRoutes.ts`, `src/lib/types.ts` + `src/server/snapshot.ts` (`liveDevice.kind`)
- Tests: `git mv tests/unit/liveScreen.test.tsx tests/unit/allCamerasScreen.test.tsx` and adapt. Also `redirects.test.ts`, `analyticsScreen.test.tsx` (TopBar), `cameraPanelLive.test.tsx`, `safeNext.test.ts` (`/cameras/motion?device=ck1`), `tests/integration/board-devices.test.ts` and `remove-phone.test.ts` (import `@/app/(app)/cameras/actions`), `tests/unit/snapshot.test.ts` (kind)

**Interfaces:**
```ts
// legacyRoutes.ts additions
{ source: '/live', destination: '/cameras' },
{ source: '/live/motion', destination: '/cameras/motion' },

// TopBar.tsx
export type Page = 'map' | 'cameras' | 'analytics' | 'settings' | 'users';
const NAV = [{ page: 'map', href: '/', label: 'Map' }, { page: 'cameras', href: '/cameras', label: 'Cameras' },
             { page: 'analytics', href: '/analytics', label: 'Analytics' }, { page: 'settings', href: '/settings', label: 'Settings', adminOnly: true }];
// the 'live' special label/aria-label branches are removed

// types.ts
liveDevice: { id: string; name: string; kind?: LiveDeviceKind } | null;   // kind defaults to PHONE when absent

// useLiveDevices.ts
export function useLiveDevices(intervalMs?: number | null): { devices: LiveDeviceView[]; loaded: boolean; error: string | null; refresh(): void }

// DeviceTile.tsx
export function LivePicture(props: { url; state; name; kind?: LiveDeviceKind; className?; onNaturalSize?; children? })  // offline text: kind === 'BOARD' ? 'Board offline' : 'Phone offline'
export function DeviceTile({ device, detectionsOn, mask = null, live = false }: { device: LiveDeviceView; detectionsOn: boolean; mask?: [number, number][] | null; live?: boolean })
// mask is passed through to DetectionOverlay in Task 6 (prop is added now and unused until then); live adds the red LIVE badge

// AllCamerasScreen.tsx
export function AllCamerasScreen({ user, initialSnapshot, connect }: { user: SessionUser; initialSnapshot: MapSnapshot; connect: { url: string | null; qrSvg: string | null } | null })
```

**Behaviour list (AllCamerasScreen):**
1. `TopBar current="cameras"`. The heading is `Cameras`. The sub line is `{camerasOnline} of {camerasTotal} map cameras online · {n} {n === 1 ? 'device' : 'devices'} sending`.
2. **Header actions** (moved verbatim from LiveScreen):
   - `Detections` toggle (`aria-pressed`, `useDetectionsToggle`);
   - admins also get `Add board camera` (opens `AddBoardDialog`) and `Connect phone` (opens `ConnectPhone`).
   Devices are polled with `useLiveDevices(detectionsOn ? 1000 : 3000)`, and the snapshot with `useLiveSnapshot`.
3. **Zones:** for each zone with cameras, a section `Zone {code}` (`aria-labelledby`) with a grid of `CameraCard`. For each camera, `device = devices.find(d => d.id === camera.liveDevice?.id && d.online) ?? null`.
   - **a. Live:** `device` is set. Show `<DeviceTile device={device} detectionsOn={detectionsOn} mask={camera.mask ?? null} live />` with the title `Camera {code}` above it. It keeps the device name, REC, the board motion badge and box, Motion view (`/cameras/motion?device=`), Expand, and the detection status and note.
   - **b. Linked but offline:** `camera.liveDevice` is set, `loaded` is true and `device` is null. Show the recorded clip (`camera.status === 'ONLINE' && camera.video` → `CameraVideo`) with a badge (`data-testid="device-offline"`): `Board offline` when `camera.liveDevice.kind === 'BOARD'`, else `Phone offline`. With no clip, show the placeholder card with the same text.
   - **c. Unlinked:** `CameraVideo` (with `Simulated` from Task 3), or `No footage yet` / `Camera offline` as now. A linked camera before `loaded` also uses this, without the offline badge.
4. **Devices section** (heading `Devices`):
   - **Live tiles:** online devices with `cameraCode === null`, as `DeviceTile` (mask null). If there are none: `No unlinked phones or boards are sending.` plus the old connect help paragraph (admin vs viewer wording kept).
   - **Admins:** below the tiles, `DevicesPanel` (every device, kind pill, Rotate token, Remove, last seen). The hint becomes `Every phone and camera board that can send. Link one to a map camera from Settings → Cameras or the camera panel.`.
5. **Admins:** `RecordingsPanel` last. **Viewers:** no Devices list, no Recordings, no admin buttons.
6. **Error line** `role="alert"` when `useLiveDevices` fails (unchanged text `Could not load phones.`).

- [ ] **Step 1: Failing tests.** In `allCamerasScreen.test.tsx`:
  - render `AllCamerasScreen` with a snapshot fixture: zone A with A1 linked to `ck1`, A2 unlinked with a SIMULATION video, and zone B with B1 linked to the board `cb1` (kind BOARD), where `cb1` is offline.
  - Keep **every** old `LiveScreen` case, adapted to the new place of each element:
    - connect help;
    - tile owner, camera, REC and actions;
    - admin Connect phone QR and Recordings;
    - remove with inline confirm;
    - Devices list hidden from viewers;
    - board motion badge, box geometry, box only while moving;
    - add board and token shown once; add error;
    - kinds and rotate token; board remove wording;
    - detections overlay, counts and note; Detection off; Too dark; toggle remembered; overlay in the expanded view;
    - RecordingsPanel cases.
  - New cases:
    - A1 shows `LIVE` and `img[alt="Live picture from Dune phone"]`, and no `camera-video`;
    - B1 shows `device-offline` with `Board offline` over the `camera-video`;
    - A2 shows `camera-video` and `Simulated`;
    - an unlinked online phone `cx9` is a tile under `Devices` and not in a zone;
    - before the first devices response, A1 shows no `device-offline`;
    - the nav has exactly `Map, Cameras, Analytics, Settings` for admins and `Map, Cameras, Analytics` for viewers.
  - `redirects.test.ts` expects the 5 entries. `cameraPanelLive.test.tsx` expects `/cameras/motion?device=ck1`.

- [ ] **Step 2: Implement** (move code, do not rewrite it). Run `grep -rn "'/live\|\"/live\|/live/motion\|current=\"live\"\|'live'" dashboard/web/src`: it may only match `legacyRoutes.ts`, `/api/live/*` and frame states.

- [ ] **Step 3: Verify:** `cd dashboard/web && npx tsc --noEmit && npx vitest run && npx next build`.

- [ ] **Step 4: Runtime redirect check** (as in Task 2 Step 3): `curl … /live` → `308 …/cameras`. `curl … '/live/motion?device=abc'` → `308 …/cameras/motion?device=abc`.

- [ ] **Step 5: Commit**
```bash
git add "dashboard/web/src/app/(app)/cameras" "dashboard/web/src/app/(app)/live" dashboard/web/src/features/cameras/AllCamerasScreen.tsx dashboard/web/src/features/cameras/CameraPanel.tsx dashboard/web/src/features/phones/DeviceTile.tsx dashboard/web/src/features/phones/DevicesPanel.tsx dashboard/web/src/features/phones/LiveScreen.tsx dashboard/web/src/features/phones/MotionScreen.tsx dashboard/web/src/features/phones/useLiveDevices.ts dashboard/web/src/features/phones/BoardToken.tsx dashboard/web/src/features/shell/TopBar.tsx dashboard/web/src/lib/legacyRoutes.ts dashboard/web/src/lib/types.ts dashboard/web/src/server/snapshot.ts dashboard/web/tests/unit/allCamerasScreen.test.tsx dashboard/web/tests/unit/liveScreen.test.tsx dashboard/web/tests/unit/redirects.test.ts dashboard/web/tests/unit/analyticsScreen.test.tsx dashboard/web/tests/unit/cameraPanelLive.test.tsx dashboard/web/tests/unit/safeNext.test.ts dashboard/web/tests/unit/snapshot.test.ts dashboard/web/tests/integration/board-devices.test.ts dashboard/web/tests/integration/remove-phone.test.ts
git status --short
git commit -m "feat(dashboard): one Cameras page for map cameras, phones and boards; /live redirects"
```

- [ ] **Step 6: Rebuild and smoke** (the ESP32 must stay live):
```bash
cd dashboard && docker compose up -d --build web
```
Sign in at `https://localhost:3443/cameras`: E1 shows the board live with `LIVE` and the motion badge. `https://localhost:3443/live` lands on `/cameras`.

---

### Task 5: Per-camera masks: schema, API, editor, research file

**Files:**
- Modify: `dashboard/web/prisma/schema.prisma`. Create: `prisma/migrations/20261010170000_camera_mask_polygon/migration.sql`
- Modify: `src/lib/cameras/masks.ts`, `src/lib/cameras/maskStore.ts`, `src/app/api/cameras/masks/route.ts`, `src/features/cameras/MaskEditor.tsx`, `src/features/cameras/CamerasScreen.tsx`, `src/lib/cameras/manage.ts`, `src/app/(app)/camera-actions.ts`, `src/lib/types.ts`, `src/server/snapshot.ts`
- Create: `src/lib/cameras/researchMasks.ts`, `src/lib/cameras/cameraMask.ts`, `schemas/camera-masks.v1.json`, `schemas/examples/camera-masks.v1.example.json`, `tests/test_camera_masks_contract.py`
- Tests: `tests/unit/masks.test.ts`, `tests/unit/researchMasks.test.ts` (replaces `maskStore.test.ts`, via `git mv` then adapt), `tests/unit/maskEditor.test.tsx`, `tests/unit/camerasScreen.test.tsx`, `tests/integration/camera-mask.test.ts`

**Schema and migration:**
```prisma
model Camera {
  // …
  /// Watch area in normalised 0–1 picture coordinates [[x, y], …], 3–64 points, implicitly closed. Null: the whole picture counts.
  maskPolygon   Json?
  maskUpdatedAt DateTime?
}
```
```sql
-- Per-camera watch area (normalised); null = whole picture.
ALTER TABLE "Camera" ADD COLUMN "maskPolygon" JSONB;
ALTER TABLE "Camera" ADD COLUMN "maskUpdatedAt" TIMESTAMP(3);
```
Create the folder by hand (same naming as the others), then run `npx prisma generate`, `npx prisma migrate deploy` (dev DB) and `npx prisma migrate status`. The status must say "Database schema is up to date". Then run `npm run db:test:prepare`.

**Interfaces:**
```ts
// masks.ts (pure, client-safe)
export type MaskPoint = [number, number];
export const MAX_MASK_POINTS = 64;                  // was 32; pixel helpers share it
export const MIN_MASK_AREA = 0.0001;
export function openRing(points: readonly MaskPoint[]): MaskPoint[];            // drops a repeated closing point
export function polygonArea(points: readonly MaskPoint[]): number;             // shoelace, absolute
export function validCameraMask(value: unknown): value is MaskPoint[];         // ambiguity 4
export function cleanCameraMask(points: readonly MaskPoint[]): MaskPoint[];    // openRing + round to 4 decimals
export function asCameraMask(value: unknown): MaskPoint[] | null;              // stored JSON → mask or null
export const DEFAULT_CAMERA_MASK: MaskPoint[];                                  // toNormalized(DEFAULT_MASK)

// researchMasks.ts (server-only)
export const RESEARCH_MASKS_SCHEMA = 'hatchwatch.camera_masks';
export function researchSlot(code: string): 0 | 1 | null;                      // /^[A-Z]+(\d+)$/: odd → 0, even → 1
export interface MaskedCamera { code: string; mask: MaskPoint[]; updatedAt: Date }
export interface ResearchMasksFile
{
    schema: string; version: 1; note: string;
    cameras: { camera: 0 | 1; label: string; polygon: [number, number][] }[];   // pixels, 1280×720
    by_code: Record<string, { polygon: [number, number][]; updated_at: string }>; // pixels, 1280×720
}
export function buildResearchMasks(cameras: MaskedCamera[], defaults: MaskEntry[]): ResearchMasksFile;
export async function syncResearchMasks(prisma: PrismaClient, liveRoot: string, root?: string): Promise<'written' | 'failed'>;

// maskStore.ts keeps masksRoot, publicMasksPath and readMasks (now also returns byCode). It adds readDefaultMasks(): MaskEntry[] (config/camera-masks.json). writeMask is removed.

// cameraMask.ts
export async function setCameraMask(prisma: PrismaClient, actorId: string, code: string, polygon: MaskPoint[] | null, now?: Date): Promise<{ code: string; mask: MaskPoint[] | null }>;
// throws CameraEditError('No camera <code>.') when missing; writes AuditLog action 'camera.mask' { code, points: n | null }; publishChange('cameras')

// types.ts / snapshot.ts / manage.ts
CameraView.mask?: MaskPoint[] | null;    // from Camera.maskPolygon via asCameraMask
CameraRow.mask: MaskPoint[] | null;
```

`buildResearchMasks` (full):
```ts
export function buildResearchMasks(cameras: MaskedCamera[], defaults: MaskEntry[]): ResearchMasksFile
{
    const sorted = [...cameras].sort((a, b) => a.code.localeCompare(b.code));
    const slots = ([0, 1] as const).flatMap(slot =>
    {
        const newest = sorted.filter(camera => researchSlot(camera.code) === slot)
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
        if (newest)
        {
            return [{ camera: slot, label: `From camera ${newest.code} (newest ${slot === 0 ? 'odd' : 'even'}-numbered camera mask)`, polygon: toPixels(newest.mask) }];
        }
        const fallback = defaults.find(entry => entry.camera === slot);
        return fallback ? [{ camera: slot, label: fallback.label ?? `Repository default for camera ${slot}`, polygon: fallback.polygon }] : [];
    });
    return {
        schema: RESEARCH_MASKS_SCHEMA,
        version: 1,
        note: 'Written by the HatchWatch dashboard from per-camera watch areas. by_code: each dashboard camera\'s mask in 1280x720 source-frame pixels. cameras[]: the per-slot masks older runners read (slot 0 = newest odd-numbered camera mask, slot 1 = newest even-numbered one, else the repository default). Operator configuration, never simulator truth. Changing a mask changes the video-to-signal distribution: registered experiments must be re-validated after any mask change.',
        cameras: slots,
        by_code: Object.fromEntries(sorted.map(camera => [camera.code, { polygon: toPixels(camera.mask), updated_at: camera.updatedAt.toISOString() }])),
    };
}
```
`syncResearchMasks`:
1. Query `camera.findMany({ where: { maskPolygon: { not: Prisma.DbNull } }, select: { code, maskPolygon, maskUpdatedAt } })` and keep the rows that pass `asCameraMask`.
2. Build the file with `readDefaultMasks()`.
3. `mkdirSync(root, { recursive: true })`.
4. If `<root>/camera-masks.json` exists, has no `by_code`, and `<root>/camera-masks.legacy.json` does not exist, copy it there once.
5. Write `<root>/camera-masks.json.tmp-<pid>` and rename it into place.
6. Return `'written'`. On any error, `console.error('[masks] could not write the research mask file:', code)` and return `'failed'`.

**Route `PUT /api/cameras/masks`:**
- 401 signed out, 403 non-admin, 400 invalid JSON.
- 400 when `typeof body.code !== 'string'`, with the text `Masks are per camera now: send { code, polygon } with 0–1 points, or polygon null to clear.`.
- 400 when `polygon` is neither `null` nor `validCameraMask`, with the text `polygon must be 3–64 points inside 0–1 with a non-zero area, or null.`.
- 404 on `CameraEditError`.
- On success: `setCameraMask`, then `syncResearchMasks(prisma, liveSettings().root)`, then `{ ok: true, code, polygon, researchFile }`.

`GET` returns `{ frame, source, cameras, byCode }`.

**`camera-actions.ts`:** after a successful `updateCamera` that changed the code, or after `deleteCamera`, call `await syncResearchMasks(prisma, liveSettings().root)`. The result is ignored here; the save already succeeded.

**Editor (`MaskEditor`):**
- **Props:** `{ code: string; liveDeviceId: string | null; videoId: string | null; initial: MaskPoint[] | null; onSaved(mask: MaskPoint[] | null): void }`.
- **Background:** `useLiveFrame(liveDeviceId)` `<img>` when `liveDeviceId` is set. Otherwise `<video src="/api/media/video/{videoId}?variant=raw" muted loop autoPlay playsInline>`. With neither, a grey 16:9 box reading `No picture yet; you can still draw the area.`.
- **Picture box:** `object-fill`. Its `aspect-ratio` is set from `naturalWidth/naturalHeight` (img) or `videoWidth/videoHeight` (video), defaulting to 16/9. The SVG over it uses `viewBox="0 0 1 1" preserveAspectRatio="none"`, so normalised points line up with the picture's own pixels.
- **Editing:** click to add, drag to move, double-click to delete (hit radius 14 CSS px, converted per axis). Starting points are `initial ?? DEFAULT_CAMERA_MASK`.
- **Buttons:**
  - `Save` (disabled unless `validCameraMask`);
  - `Use whole picture` (PUT `polygon: null`);
  - `Start over` (restores `DEFAULT_CAMERA_MASK`).
- **Text (exact):**
  - `This mask applies to camera {code} only. People whose feet are outside it are drawn in grey and never raise a camera alert. With no mask, the whole picture counts.`
  - `Simulated clips: the simulator uses one watch area for all odd-numbered cameras and one for all even-numbered cameras, taken from the most recently saved mask of each kind.`
- **After a save:** `Saved.`, or `Saved. The simulator's mask file could not be written (check MASKS_ROOT).` when `researchFile === 'failed'`.

**CamerasScreen:** remove `runnerCameraIndex`. Every row gets the `Mask` button, labelled `Mask` / `Mask · set` when `camera.mask`. The editor gets `liveDeviceId={camera.liveDeviceId}`, `videoId={camera.video?.id ?? null}` and `initial={camera.mask}`.

**Contract files:**
- `schemas/camera-masks.v1.json`: a JSON Schema draft 2020-12 with:
  - `schema`: enum `['hatchwatch.camera_masks', 'nesttrace.camera_masks']`;
  - `version`: const 1;
  - `cameras`: items `{ camera: integer ≥ 0, label?: string, polygon: array ≥3 of [number, number] }`;
  - optional `by_code`: object of `{ polygon, updated_at }`;
  - prose saying `pipeline/extract.py` reads only `cameras[]`.
- `schemas/examples/camera-masks.v1.example.json`: the exact output of `buildResearchMasks` for A1 (`[[0.1,0.5],[0.9,0.5],[0.9,0.95],[0.1,0.95]]`, 2026-10-10T12:00Z), B1 (`[[0.2,0.4],[0.8,0.4],[0.5,0.9]]`, 12:05Z) and B2 (`[[0,0.6],[1,0.6],[1,1],[0,1]]`, 12:01Z), with the defaults from `config/camera-masks.json`.

- [ ] **Step 1: Failing tests**
  - `masks.test.ts`:
    - `validCameraMask` accepts a triangle, 64 points and a closing repeat;
    - it refuses 2 or 65 points, `1.0001`, `NaN`, a zero-area collinear triple and a non-array;
    - `cleanCameraMask` rounds to 4 decimals;
    - `asCameraMask('x')` is null;
    - the old pixel tests change their 32 to `MAX_MASK_POINTS`.
  - `researchMasks.test.ts`:
    - `researchSlot('A1')===0`, `('A2')===1`, `('C7')===0`, `('E10')===1`, `('X')===null`;
    - with the example inputs, `buildResearchMasks` deep-equals `JSON.parse(readFileSync('../../schemas/examples/camera-masks.v1.example.json'))`, with slot 0 from B1 (newer odd) and slot 1 from B2;
    - with no even mask, slot 1 comes from the default;
    - `syncResearchMasks` writes to a temp `root` and never to `liveRoot`, makes the legacy copy once, and returns `'failed'` on a read-only root (`chmodSync(root, 0o500)`, as in the old maskStore test).
  - `tests/integration/camera-mask.test.ts`, using the route handlers with a mocked `currentUserOrNull` like `site-routes.test.ts`, with `MASKS_ROOT` = temp dir:
    - viewer → 403;
    - `{ camera: 0, polygon }` → 400 with the per-camera message;
    - 65 points → 400;
    - unknown code → 404;
    - a valid save stores `Camera.maskPolygon` rounded and sets `maskUpdatedAt`;
    - it writes the audit row `camera.mask`;
    - the file has `by_code.A1` and a `cameras[0].label` starting `From camera A1`;
    - `polygon: null` clears it and slot 0 falls back to the default;
    - renaming A1 to A9 through `updateCameraAction` moves `by_code` to `A9`.
  - `maskEditor.test.tsx`: the exact texts; Save disabled for 2 points; Save PUTs `{ code: 'E1', polygon }` normalised; `Use whole picture` PUTs `polygon: null`; with `liveDeviceId`, the `img` is the background.
  - `camerasScreen.test.tsx`: every camera has a Mask button, including `E1` and `C3`.
  - Root `tests/test_camera_masks_contract.py`:
```python
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'pipeline'))
from extract import load_mask  # noqa: E402

EXAMPLE = ROOT / 'schemas' / 'examples' / 'camera-masks.v1.example.json'


def test_runner_reads_the_dashboard_written_mask_file():
    # pipeline/extract.py is frozen; the dashboard's file must stay readable by it unchanged.
    for slot in (0, 1):
        polygon, digest = load_mask(str(EXAMPLE), slot)
        assert polygon is not None and len(polygon) >= 3 and digest
        assert all(0 <= x <= 1280 and 0 <= y <= 720 for x, y in polygon)
    assert load_mask(str(EXAMPLE), 2) == (None, None)
```
  Run the tests: they fail.

- [ ] **Step 2: Implement** the migration, helpers, store, route, editor, screen, snapshot `mask`, and the camera-actions sync.

- [ ] **Step 3: Verify**
```bash
cd dashboard/web && npx prisma migrate status && npm run db:test:prepare && npx tsc --noEmit && npx vitest run && npx next build
cd ../.. && npm test          # includes test_camera_masks_contract.py
git diff --stat -- pipeline config results '*RESULTS.md'   # must be empty
```

- [ ] **Step 4: Commit**
```bash
git add dashboard/web/prisma/schema.prisma dashboard/web/prisma/migrations/20261010170000_camera_mask_polygon dashboard/web/src/lib/cameras/masks.ts dashboard/web/src/lib/cameras/maskStore.ts dashboard/web/src/lib/cameras/researchMasks.ts dashboard/web/src/lib/cameras/cameraMask.ts dashboard/web/src/lib/cameras/manage.ts dashboard/web/src/app/api/cameras/masks/route.ts "dashboard/web/src/app/(app)/camera-actions.ts" dashboard/web/src/features/cameras/MaskEditor.tsx dashboard/web/src/features/cameras/CamerasScreen.tsx dashboard/web/src/lib/types.ts dashboard/web/src/server/snapshot.ts dashboard/web/tests/unit/masks.test.ts dashboard/web/tests/unit/maskStore.test.ts dashboard/web/tests/unit/researchMasks.test.ts dashboard/web/tests/unit/maskEditor.test.tsx dashboard/web/tests/unit/camerasScreen.test.tsx dashboard/web/tests/integration/camera-mask.test.ts schemas/camera-masks.v1.json schemas/examples/camera-masks.v1.example.json tests/test_camera_masks_contract.py
git status --short
git commit -m "feat(dashboard): per-camera watch masks in the database, editor over the live picture, research mask file kept compatible"
```

---

### Task 6: Mask rule for the camera alert; grey people outside the watch area

**Files:**
- Modify: `src/lib/cameras/masks.ts`, `src/lib/detections/cameraDanger.ts`, `src/features/phones/DetectionOverlay.tsx`, `src/features/phones/DeviceTile.tsx` (pass `mask`), `src/features/cameras/CameraPanel.tsx` (`mask={camera.mask ?? null}`)
- Tests: `tests/unit/masks.test.ts`, `tests/unit/cameraDanger.test.ts`, `tests/integration/live-detection.test.ts`, `tests/unit/detectionOverlay.test.tsx`, `tests/unit/cameraPanelLive.test.tsx`, `tests/unit/allCamerasScreen.test.tsx`

**Interfaces and code:**
```ts
// masks.ts
/** Even-odd test; a point on an edge counts as inside. */
export function pointInMask([x, y]: MaskPoint, mask: readonly MaskPoint[]): boolean
{
    let inside = false;
    for (let i = 0, j = mask.length - 1; i < mask.length; j = i++)
    {
        const [xi, yi] = mask[i];
        const [xj, yj] = mask[j];
        const cross = (xj - xi) * (y - yi) - (yj - yi) * (x - xi);
        if (Math.abs(cross) < 1e-12 && Math.min(xi, xj) <= x && x <= Math.max(xi, xj) && Math.min(yi, yj) <= y && y <= Math.max(yi, yj))
        {
            return true;
        }
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi)
        {
            inside = !inside;
        }
    }
    return inside;
}

/** Bottom-centre of a box (the person's feet), as 0–1 picture coordinates. */
export function feetPoint([x, y, w, h]: readonly [number, number, number, number], width: number, height: number): MaskPoint
{
    return [(x + w / 2) / width, (y + h) / height];
}

/** No mask: the whole picture counts. */
export function feetInMask(box: readonly [number, number, number, number], width: number, height: number, mask: readonly MaskPoint[] | null): boolean
{
    return mask === null || pointInMask(feetPoint(box, width, height), mask);
}

// cameraDanger.ts
export function qualifyingPerson(detections: DetectionsView, mask: readonly MaskPoint[] | null = null): { track: string; score: number } | null
// … inside the loop, after the score check:
//     if (!feetInMask(object.box, detections.width, detections.height, mask)) continue;

// raiseCameraDanger, new head:
if (!qualifyingPerson(detections))
{
    return 'none';                       // nothing anywhere in the picture: no database work
}
const device = await prisma.liveDevice.findUnique({
    where: { id: deviceId },
    select: { disabledAt: true, camera: { select: { id: true, code: true, zoneId: true, lng: true, lat: true, maskPolygon: true, zone: { select: { code: true } } } } },
});
const camera = device && !device.disabledAt ? device.camera : null;
if (!camera)
{
    return 'none';
}
// Only people whose feet are inside this camera's watch area count; outside ones never raise or append (spec §4).
const person = qualifyingPerson(detections, asCameraMask(camera.maskPolygon));
if (!person || !throttle.take(camera.id, now.getTime()))
{
    return 'none';
}
// … the transaction is unchanged and uses `person`

// DetectionOverlay.tsx
export const OUTSIDE_LABEL = 'outside watch area';
export const OUTSIDE_COLOR = '#8A9BA6';
export function DetectionOverlay({ detections, mask = null }: { detections: DetectionsView; mask?: readonly MaskPoint[] | null })
```

**Overlay behaviour:**
- Every `person` object with `!feetInMask(box, width, height, mask)` gets:
  - stroke and label fill `OUTSIDE_COLOR`;
  - label `${objectLabel(object)} · ${OUTSIDE_LABEL}`;
  - `data-outside="true"` on its `rect`;
  - its trail drawn in `OUTSIDE_COLOR`.
- Possible turtles keep their colours: the mask rule is about people and alerts.
- When `mask` is set, draw `<polygon data-testid="watch-area" points={mask scaled by width/height} fill="none" stroke="#FFB547" strokeOpacity={0.35} strokeDasharray="6 6" vectorEffect="non-scaling-stroke" />` under the boxes.
- The counts line and status strings stay exactly as in Plan G.

- [ ] **Step 1: Failing tests**
  - `masks.test.ts`:
    - `pointInMask` inside, outside, on an edge, on a vertex, a concave L-shape notch, and a self-intersecting bow-tie (even-odd);
    - `feetPoint([194,104,31,86], 320, 240)` ≈ `[0.6547, 0.7917]`;
    - `feetInMask(..., null)` is true.
  - `cameraDanger.test.ts`:
    - `INSIDE = [[0.5,0.5],[1,0.5],[1,1],[0.5,1]]` and `OUTSIDE = [[0,0],[0.4,0],[0.4,0.4],[0,0.4]]` with person box `[194,104,31,86]` in 320×240;
    - qualifies with `INSIDE` and with `null`, and is null with `OUTSIDE`;
    - a person whose head is inside but whose feet are outside (`mask = [[0,0],[1,0],[1,0.6],[0,0.6]]`) → null;
    - two people, the longer-seen one outside → the inside one wins.
  - `tests/integration/live-detection.test.ts`: new `describe('watch mask')`, where the test sets the mask directly with `prisma.camera.update({ where: { code: 'A1' }, data: { maskPolygon: …, maskUpdatedAt: new Date() } })`:
    1. `INSIDE` mask + site → `'raised'`.
    2. `OUTSIDE` mask + site → `'none'`, and `cameraDangers()` is empty, also after 3 more results 70 s apart.
    3. Raised with no mask, then the mask is set to `OUTSIDE`, then results 70 s later → `'none'`, and the alert's log still has exactly 1 `danger` entry (outside never appends).
    4. No mask → `'raised'` (whole picture).
    5. `OUTSIDE` → `'none'`. Then clear to `null`, advance 6 s → `'raised'` (an outside person used no throttle slot).
    6. A stored invalid mask (`[[0,0],[1,1]]`) behaves like no mask → `'raised'`.
  - `detectionOverlay.test.tsx`:
    - with `OUTSIDE`, the person rect has `data-outside="true"`, stroke `#8A9BA6`, text `person 0.82 · outside watch area`, and `[data-testid="watch-area"]` present;
    - with `INSIDE`, none of the outside markers;
    - with `null`, no watch-area polygon.
  - `cameraPanelLive.test.tsx` and `allCamerasScreen.test.tsx`: a linked live camera with `mask: OUTSIDE` renders the outside label. An unlinked device tile never does.

- [ ] **Step 2: Implement.**

- [ ] **Step 3: Verify:** `cd dashboard/web && npx tsc --noEmit && npx vitest run`. The worker is unchanged: `cd ../worker && .venv/bin/pytest -q`.

- [ ] **Step 4: Commit**
```bash
git add dashboard/web/src/lib/cameras/masks.ts dashboard/web/src/lib/detections/cameraDanger.ts dashboard/web/src/features/phones/DetectionOverlay.tsx dashboard/web/src/features/phones/DeviceTile.tsx dashboard/web/src/features/cameras/CameraPanel.tsx dashboard/web/tests/unit/masks.test.ts dashboard/web/tests/unit/cameraDanger.test.ts dashboard/web/tests/integration/live-detection.test.ts dashboard/web/tests/unit/detectionOverlay.test.tsx dashboard/web/tests/unit/cameraPanelLive.test.tsx dashboard/web/tests/unit/allCamerasScreen.test.tsx
git status --short
git commit -m "feat(dashboard): camera alerts count only people whose feet are inside the camera's watch area; others drawn grey"
```

- [ ] **Step 5: Rebuild.** First `mkdir -p artifacts/operator` (repo root, so the bind mount is owned by the user, not created by Docker), then `cd dashboard && docker compose up -d --build web`. Check that E1 still shows live.

---

### Task 7: Rename compatibility layer (readers accept both names; deploy before any writer changes)

**Files:**
- Create: `dashboard/web/src/lib/legacyNames.ts`, `dashboard/web/src/lib/storageKeys.ts`, `dashboard/web/tests/unit/storageKeys.test.ts`
- Modify: `src/lib/phones/motionHeader.ts`, `src/lib/phones/http.ts`, `src/lib/live/manifest.ts`, `src/lib/sim/schema.ts`, `src/lib/phones/recorder.ts`, `src/lib/cameras/maskStore.ts`, `src/features/map/useStoredBoolean.ts`, `src/features/map/Legend.tsx`, `src/features/alerts/AlertsFeed.tsx`, `src/features/cameras/usePanelWidth.ts`, `src/features/phones/camMessages.ts`, `src/features/phones/CamSender.tsx`, `src/features/phones/useDetectionsToggle.ts`
- Modify (contracts): `schemas/esp32-frame.v1.md`, `schemas/live-chunk.v1.json`, `schemas/tracks.v1.json`, `schemas/people.v1.json`
- Modify (env fallback): `scripts/record.mjs`, `scripts/browser-check.mjs`, `scripts/multi-check.mjs`, `scripts/pin-browser-check.mjs`, `scripts/swarm-check.mjs`, `scripts/sim-frame-hash.mjs`, `tests/test_sim_defaults.py`
- Tests: `tests/unit/motionHeader.test.ts`, `tests/integration/live-phones.test.ts`, `tests/unit/live-manifest.test.ts`, `tests/unit/danger.test.ts`, `tests/integration/danger.test.ts`, `tests/unit/recorder.test.ts`, `tests/unit/camSender.test.tsx`, `tests/unit/cameraPanelLive.test.tsx`, `tests/unit/expandedFeed.test.tsx`, `tests/unit/allCamerasScreen.test.tsx`, `tests/unit/panelWidth.test.tsx`, `tests/unit/legend.test.tsx`, `tests/unit/alertsFeed.test.tsx`

**Interfaces:**
```ts
// legacyNames.ts: the only dashboard source file allowed to contain the old name (Task 8 naming test)
// Names from before the HatchWatch rename (spec §6). Read for compatibility; never written.
export const LEGACY_MOTION_HEADER = 'x-nesttrace-motion';
export const LEGACY_LIVE_CHUNK_SCHEMA = 'nesttrace.live-chunk';
export const LEGACY_TRACKS_SCHEMA = 'nesttrace.tracks';
export const LEGACY_PEOPLE_SCHEMA = 'nesttrace.people';
export const LEGACY_RECORDING_SCHEMA = 'nesttrace.recording';
export const LEGACY_CAMERA_MASKS_SCHEMA = 'nesttrace.camera_masks';
export const LEGACY_STORAGE_KEYS = {
    alertsOpen: 'nesttrace.alerts.open', legendOpen: 'nesttrace.legend.open', panelWidth: 'nesttrace.panel.width',
    phoneName: 'nesttrace.phoneName', detections: 'nesttrace.detections',
} as const;

// storageKeys.ts
export const STORAGE_KEYS = {
    alertsOpen: 'hatchwatch.alerts.open', legendOpen: 'hatchwatch.legend.open', panelWidth: 'hatchwatch.panel.width',
    phoneName: 'hatchwatch.phoneName', detections: 'hatchwatch.detections',
} as const;
export type StorageKeyName = keyof typeof STORAGE_KEYS;
/** Reads a HatchWatch key; the first read moves an old NestTrace value across and removes the old key. Callers keep their try/catch. */
export function readStored(storage: Storage, name: StorageKeyName): string | null
{
    const key = STORAGE_KEYS[name];
    const value = storage.getItem(key);
    if (value !== null)
    {
        return value;
    }
    const old = storage.getItem(LEGACY_STORAGE_KEYS[name]);
    if (old !== null)
    {
        storage.setItem(key, old);
        storage.removeItem(LEGACY_STORAGE_KEYS[name]);
    }
    return old;
}

// motionHeader.ts
export const MOTION_HEADER = 'x-hatchwatch-motion';
/** The new header wins; boards flashed before the rename keep sending the old one (schemas/esp32-frame.v1.md). */
export function motionHeaderValue(headers: Headers): string | null
{
    return headers.get(MOTION_HEADER) ?? headers.get(LEGACY_MOTION_HEADER);
}
// http.ts: motion = parseMotionHeader(motionHeaderValue(request.headers));

// manifest.ts
schema: z.union([z.literal('hatchwatch.live-chunk'), z.literal(LEGACY_LIVE_CHUNK_SCHEMA)]),
// sim/schema.ts: the same for tracks/people. recorder.ts: RECORDING_SCHEMA = 'hatchwatch.recording' is written; the sidecar reader accepts both.
// maskStore.ts parse: accepts either schema id or none (config/camera-masks.json stays 'nesttrace.camera_masks').

// useStoredBoolean(name: StorageKeyName, initial: boolean); Legend → 'legendOpen', AlertsFeed → 'alertsOpen'
// usePanelWidth: readStored(localStorage, 'panelWidth') / setItem(STORAGE_KEYS.panelWidth, …)
// camMessages: PHONE_NAME_KEY removed; CamSender uses readStored(localStorage, 'phoneName') / STORAGE_KEYS.phoneName
// useDetectionsToggle: DETECTIONS_KEY = STORAGE_KEYS.detections; read() uses readStored(window.localStorage, 'detections')
```
- **Scripts:** `process.env.HATCHWATCH_BROWSER || process.env.NESTTRACE_BROWSER || …` in the 6 `.mjs` files.
- **`tests/test_sim_defaults.py`:** `os.environ.get('HATCHWATCH_SIM_CHECK', os.environ.get('NESTTRACE_SIM_CHECK'))`, with the reason text updated.
- **Schemas:**
  - `schemas/live-chunk.v1.json` `"schema": { "enum": ["hatchwatch.live-chunk", "nesttrace.live-chunk"] }`, title `HatchWatch live chunk manifest, version 1`, `$id` `https://github.com/nothing2me/hatchwatch/schemas/live-chunk.v1.json`;
  - tracks and people follow the same pattern;
  - `schemas/esp32-frame.v1.md`: the header table lists `X-HatchWatch-Motion` (sent by current firmware) and `X-NestTrace-Motion` (accepted for boards flashed before the rename; when both are present the new one wins).

- [ ] **Step 1: Failing tests**
  - `motionHeader.test.ts`: `MOTION_HEADER === 'x-hatchwatch-motion'`; `motionHeaderValue` returns the new header, falls back to the old one, and prefers the new one when both are present.
  - `live-phones.test.ts`: a board POST with only `x-nesttrace-motion` and one with only `x-hatchwatch-motion` both store the reading.
  - `live-manifest.test.ts`: both ids parse; `'other.live-chunk'` fails.
  - `danger.test.ts` (unit): `tracksFileSchema`/`peopleFileSchema` accept both ids and refuse a cross id.
  - `tests/integration/danger.test.ts`: one fixture written with `hatchwatch.tracks` imports.
  - `recorder.test.ts`: an old `nesttrace.recording` sidecar is listed; new sidecars say `hatchwatch.recording`; the `__nesttraceRecorder` cleanup stays until Task 8.
  - `storageKeys.test.ts`:
    - the old value moves to the new key and the old key is removed;
    - a new value wins over an old one and leaves the old one alone;
    - it returns null when both are absent.
  - Component tests that seeded `nesttrace.*` keys keep seeding the old key and assert that it is read and moved: `camSender`, `cameraPanelLive` (`nesttrace.detections`=off → toggle off, then `localStorage.getItem('hatchwatch.detections') === 'off'`), `expandedFeed`, `panelWidth`. The other component tests use the new keys.

- [ ] **Step 2: Implement.**

- [ ] **Step 3: Verify**
```bash
cd dashboard/web && npx tsc --noEmit && npx vitest run && npx next build
cd ../.. && npm test
```

- [ ] **Step 4: Commit**
```bash
git add dashboard/web/src/lib/legacyNames.ts dashboard/web/src/lib/storageKeys.ts dashboard/web/src/lib/phones/motionHeader.ts dashboard/web/src/lib/phones/http.ts dashboard/web/src/lib/live/manifest.ts dashboard/web/src/lib/sim/schema.ts dashboard/web/src/lib/phones/recorder.ts dashboard/web/src/lib/cameras/maskStore.ts dashboard/web/src/features/map/useStoredBoolean.ts dashboard/web/src/features/map/Legend.tsx dashboard/web/src/features/alerts/AlertsFeed.tsx dashboard/web/src/features/cameras/usePanelWidth.ts dashboard/web/src/features/phones/camMessages.ts dashboard/web/src/features/phones/CamSender.tsx dashboard/web/src/features/phones/useDetectionsToggle.ts dashboard/web/tests schemas/esp32-frame.v1.md schemas/live-chunk.v1.json schemas/tracks.v1.json schemas/people.v1.json scripts/record.mjs scripts/browser-check.mjs scripts/multi-check.mjs scripts/pin-browser-check.mjs scripts/swarm-check.mjs scripts/sim-frame-hash.mjs tests/test_sim_defaults.py
git status --short
git commit -m "feat: accept HatchWatch and legacy NestTrace names for the motion header, schema ids, storage keys and env vars"
```

- [ ] **Step 5: Deploy before any writer changes**
```bash
cd dashboard && docker compose up -d --build web
docker compose logs --since 2m web | grep -i -E "error|refused" || true
```
Open `/cameras`: the ESP32 (still sending `X-NestTrace-Motion`) shows `Moving …%` or `Still`, **not** `No motion reading`. **Do not start Task 8 until this passes.**

---

### Task 8: Rename the rest to HatchWatch; switch writers; re-flash the board

**Files:**
- **Dashboard:**
  - `src/app/cam/page.tsx` (`title: 'HatchWatch camera'`);
  - `src/features/phones/CamSender.tsx` (`HATCHWATCH`, `HatchWatch camera`);
  - `src/lib/phones/boardSecrets.ts` (`// HatchWatch dashboard upload. …`);
  - `src/lib/changes.ts` (`__hatchwatchChanges`), `src/lib/live/watcher.ts` (`__hatchwatchLiveWatcher`), `src/lib/phones/frameStore.ts` (`__hatchwatchFrames`), `src/lib/phones/recorder.ts` (`__hatchwatchRecorder`);
  - tests `recorder.test.ts`, `camSender.test.tsx`, `boardSecrets.test.ts`, `users.test.ts`, `usersScreen.test.tsx` (emails → `@hatchwatch.local`).
- **Worker:**
  - `git mv dashboard/worker/nesttrace_worker dashboard/worker/hatchwatch_worker`;
  - `Dockerfile` `CMD ["python", "-m", "hatchwatch_worker.main"]`;
  - logger name `hatchwatch_worker` in `api.py`, `main.py` and `scheduler.py`;
  - `__init__.py` docstring `HatchWatch live detection worker: …`;
  - every test import, `test_packaging.py` (glob path) and `caplog` logger.
- **Research writers (not frozen):**
  - `scripts/live-runner.mjs` (`schema: 'hatchwatch.live-chunk'`);
  - `scripts/track_paths.py` (`'hatchwatch.tracks'`) and `scripts/people_detect.py` (`'hatchwatch.people'`);
  - `scripts/analyze.py` / `scripts/lowlight_probe.py` / `scripts/lowlight_threshold_grid.py` (temp prefixes `hatchwatch-…`);
  - `tests/test_track_paths.py` / `tests/test_people_detect.py` (assert the new ids);
  - `web/main.ts` footer `HATCHWATCH / RESEARCH PROTOTYPE`.
- **Firmware:**
  - `uplink.cpp` (`http.addHeader("X-HatchWatch-Motion", motionValue);`);
  - `uplink.h` (both comments);
  - `esp32s3-cam.ino` (comment + `CONSOLE("\nHatchWatch ESP32-S3 camera starting\n");`);
  - `web_page.h` (`<title>HatchWatch ESP32-S3 camera</title>`, eyebrow `HatchWatch`);
  - `tools/board.py` (docstring, build dir `hatchwatch-esp32-build`, the error text `HatchWatch device token`);
  - `README.md` (name + header).
- **Guards:**
  - create `dashboard/web/tests/unit/naming.test.ts`, which walks `dashboard/web/src` and `dashboard/worker/hatchwatch_worker`. `/nesttrace/i` may only appear in `src/lib/legacyNames.ts`.
  - create `dashboard/web/tests/unit/compose-names.test.ts`, which reads `../docker-compose.yml` and asserts:
    - `name: nesttrace-dashboard`;
    - `POSTGRES_USER: nesttrace` and `POSTGRES_DB: nesttrace`;
    - the volumes `pgdata`/`caddy_data`;
    - `DATABASE_URL: postgresql://nesttrace:nesttrace@db:5432/nesttrace`;
    - `seed-data.ts` `DEMO_VIEWER.email === 'viewer@nesttrace.local'`.
    Each assertion carries a comment: renaming these loses data or duplicates accounts.

- [ ] **Step 1: Failing tests:** `naming.test.ts` and `compose-names.test.ts` as above. The worker tests import `hatchwatch_worker` and fail; so do the root `test_track_paths`/`test_people_detect` new-id asserts.

- [ ] **Step 2: Implement** (mechanical). Then:
```bash
git grep -n -i nesttrace -- ':!docs/superpowers' | grep -v -E "legacyNames\.ts|docker-compose\.yml|\.env\.example|seed-data\.ts|seed\.test\.ts|compose-names\.test\.ts|config/camera-masks\.json|BRANCH_INTEGRATION\.md|NESTTRACE_(BROWSER|SIM_CHECK)|schemas/.*\.json|esp32-frame\.v1\.md|storageKeys\.test|motionHeader\.test|live-phones\.test|live-manifest\.test|danger\.test|recorder\.test|camSender\.test|cameraPanelLive\.test|expandedFeed\.test|panelWidth\.test|dashboard/README\.md|README\.md|GOAL_TODOS\.md"
```
Expected: no output. README files are handled in Task 9.

- [ ] **Step 3: Verify**
```bash
cd dashboard/web && npx tsc --noEmit && npx vitest run && npx next build
cd ../worker && .venv/bin/pytest -q
cd ../.. && npm test
```

- [ ] **Step 4: Commit (code)**
```bash
git add dashboard/web/src dashboard/web/tests dashboard/worker/Dockerfile dashboard/worker/hatchwatch_worker dashboard/worker/nesttrace_worker dashboard/worker/tests scripts/live-runner.mjs scripts/track_paths.py scripts/people_detect.py scripts/analyze.py scripts/lowlight_probe.py scripts/lowlight_threshold_grid.py tests/test_track_paths.py tests/test_people_detect.py web/main.ts firmware/esp32s3-cam/uplink.cpp firmware/esp32s3-cam/uplink.h firmware/esp32s3-cam/esp32s3-cam.ino firmware/esp32s3-cam/web_page.h firmware/esp32s3-cam/tools/board.py firmware/esp32s3-cam/README.md
git status --short     # secrets.h, .venv, __pycache__, models must not appear
git commit -m "feat: rename NestTrace to HatchWatch in code, worker package, research writers and firmware"
```

- [ ] **Step 5: Rebuild, then re-flash the live board**
```bash
cd dashboard && docker compose up -d --build web worker
docker compose ps        # web, worker, caddy, db running; project still nesttrace-dashboard
cd .. && firmware/esp32s3-cam/tools/.venv/bin/python firmware/esp32s3-cam/tools/board.py flash
```
Expected boot log: `HatchWatch ESP32-S3 camera starting`, then `Dashboard: connecting`, then frames are sent. Within 10 s on `/cameras`, E1 shows `LIVE` and the motion badge reads `Moving`/`Still` (the new header is parsed). `firmware/esp32s3-cam/tools/board.py status` shows the uploads counting up. If the flash fails, the board still runs the old firmware and keeps working thanks to Task 7; fix it and flash again.

---

### Task 9: Docs and diagrams; full verification; containers; real ESP32 mask check; screenshots

**Files:** `README.md`, `dashboard/README.md`, `CLAUDE.md`, `agent.md`, `GOAL_TODOS.md`

- [ ] **Step 1: Docs**
  - **Root `README.md`:**
    - the overview says HatchWatch;
    - Quick start points to `/cameras` and `/settings`;
    - `NESTTRACE_BROWSER` → `HATCHWATCH_BROWSER (NESTTRACE_BROWSER still works)`;
    - new short section **Names kept from NestTrace**: the Postgres user/database `nesttrace`/`nesttrace_test`, the Compose project `nesttrace-dashboard` and its volumes, the seeded `viewer@nesttrace.local`, the legacy ids still accepted (`X-NestTrace-Motion`, `nesttrace.live-chunk|tracks|people|recording|camera_masks`) and `config/camera-masks.json` (frozen). It also says old dated plans/specs keep the old name.
  - **The four Mermaid diagrams:**
    1. *How it fits together:*
       - the subgraph label `HatchWatch dashboard laptop (Docker Compose)`;
       - add `ops[("artifacts/operator<br/>camera-masks.json")]`, `web -->|per-camera masks · derived slots| ops`, `ops -.->|runner copies as mask.json| pipe`;
       - the web node label `Next.js web<br/>/ · /cameras · /analytics · /settings`.
    2. *A live frame, from camera to alert:*
       - after `K->>W: POST detections`, add `W->>W: feet of each person box inside the camera's mask? (no mask = whole picture)`;
       - `alt` becomes `feet inside the mask, linked camera, seen 2 s, zone has unprotected nests` → `open one camera danger alert (level 1)`;
       - `else feet outside the mask` → `draw grey "outside watch area"; never raise or append`;
       - the browser line reads `U->>W: /cameras and the map (poll devices, snapshot)`.
    3. *Life of a nest site:* add `note right of Protected : Entries by the demo patrol (DEMO_PATROL=1) are counted, and analytics says "Includes demo patrol (simulated)"`. The `Danger` transition label becomes `danger (person inside the watch area)`.
    4. *Who can reach what:*
       - inside `host`, add `pages["Pages: / map · /cameras (+/cameras/motion) · /analytics · /settings (admin: users, cameras)"]` with `w --- pages`;
       - add `old["/live → /cameras · /setup → /settings (308)"] -.-> pages`.
  - **`dashboard/README.md`:**
    - every `/live` becomes `/cameras` and every `/setup` becomes `/settings`;
    - new section **Cameras page** (states a/b/c, Devices section);
    - new section **Watch masks**: per camera, the editor, feet rule, grey boxes, no mask = whole picture, the research file (`by_code` + derived slots, legacy copy, `MASKS_ROOT` must be writable, `mkdir -p artifacts/operator`), and that changing masks requires re-validating registered experiments;
    - the motion header is now `X-HatchWatch-Motion` (old accepted);
    - the demo-patrol note.
  - **`CLAUDE.md` (additive):** under "Two separate applications" item 2, add `/cameras` (live and recorded), `/settings/*`, the per-camera masks with the feet rule in web (`src/lib/detections/cameraDanger.ts`), the research mask file contract `schemas/camera-masks.v1.json`, and the worker package `dashboard/worker/hatchwatch_worker`. Add the legacy-name note and the kept DB/Compose names.
  - **`agent.md` (additive):**
    - one sentence: the dashboard writes `artifacts/operator/camera-masks.json` (`schemas/camera-masks.v1.json`), public operator configuration that the runner copies, never truth. Its per-slot entries keep `pipeline/extract.py` unchanged.
    - in the live detection sentence: the camera alert counts only people whose feet are inside that camera's watch area.
  - **`GOAL_TODOS.md`:** the env var name.
  - **Grep gate:** this must print nothing outside redirect definitions, tests and historical docs:
```bash
git grep -n -E "(/setup|/live)([^-/a-z]|$)" -- ':!docs/superpowers' ':!dashboard/web/src/lib/legacyRoutes.ts' ':!dashboard/web/tests/unit/redirects.test.ts' | grep -v "/api/live"
```

- [ ] **Step 2: Render the diagrams**
```bash
S=/private/tmp/claude-501/-Users-segfault-Documents-islanderhack2026-nesttrace/d3b35a95-6c20-406d-a05a-b2a287688b9a/scratchpad
mkdir -p $S/mmd-h
python3 -c "import re,sys;t=open('README.md').read();[open(f'$S/mmd-h/d{i}.mmd','w').write(b) for i,b in enumerate(re.findall(r'\`\`\`mermaid\n(.*?)\`\`\`',t,re.S))]"
ls $S/mmd-h/*.mmd | wc -l    # 4
for i in 0 1 2 3; do PUPPETEER_SKIP_DOWNLOAD=1 npx -y @mermaid-js/mermaid-cli@11.4.2 -p $S/mmd/pp.json -i $S/mmd-h/d$i.mmd -o $S/mmd-h/d$i.svg || exit 1; done
```
Expected: four SVGs and no `Parse error`. Open each SVG to check the new nodes are present.

- [ ] **Step 3: Full test run**
```bash
cd dashboard/web && npm run db:test:prepare && npx tsc --noEmit && npx vitest run && npx next build
cd ../worker && .venv/bin/pytest -q
cd ../.. && npm test
firmware/esp32s3-cam/tools/.venv/bin/python firmware/esp32s3-cam/tools/board.py status
git diff c510911 --stat -- pipeline config results '*RESULTS.md'    # empty
```

- [ ] **Step 4: Rebuild the containers and check data survived**
```bash
S=/private/tmp/claude-501/-Users-segfault-Documents-islanderhack2026-nesttrace/d3b35a95-6c20-406d-a05a-b2a287688b9a/scratchpad
cd dashboard && docker compose exec db psql -U nesttrace -d nesttrace -tAc 'SELECT COUNT(*) FROM "Alert"' > $S/alerts-before.txt
docker compose up -d --build
docker volume ls | grep nesttrace-dashboard_pgdata
docker compose exec db psql -U nesttrace -d nesttrace -tAc 'SELECT COUNT(*) FROM "Alert"'   # ≥ the count in $S/alerts-before.txt
for p in /setup /setup/users /setup/cameras /live "/live/motion?device=x"; do curl -sk -o /dev/null -w "$p %{http_code} %{redirect_url}\n" "https://localhost:3443$p"; done   # all 308 to the new paths, query kept
```
- [ ] **Step 5: End-to-end with the real ESP32 (with the user) and screenshots.** Prepare zone E with an active unprotected site: `cd dashboard/web && npm run sim:import -- --run ../../artifacts/public/A-seaward-humans-demo-929 --pair E`, then check with `psql` that a non-DANGER alert in zone E has an open status and no `protectionInstalled`. Then:
  1. **Settings → Cameras → E1 → Mask:** the editor shows the board's live picture. Draw a mask over the floor area in front of the board and press Save: `Saved.` appears. `artifacts/operator/camera-masks.json` has `by_code.E1`, `cameras[0].label` starts `From camera E1`, and `.venv/bin/python -c "import sys;sys.path.insert(0,'pipeline');from extract import load_mask;print(load_mask('artifacts/operator/camera-masks.json',0))"` prints a polygon.
  2. **Person inside:** the user stands with their feet inside the mask for more than 2 s. `/cameras` E1 shows a coloured `person 0.xx` box and the faint watch-area outline. Within about 10 s the map shows the camera alert card `Camera alert · person detected (not measured distance)` for `E1`. Press **Resolve danger**.
  3. **Person outside:** after resolving, temporarily clear the 10-minute repeat gap: run `UPDATE "SiteEvent" SET at = at - interval '11 minutes' WHERE type='dangerResolved' AND "alertId" IN (SELECT id FROM "Alert" WHERE "cameraId"=(SELECT id FROM "Camera" WHERE code='E1') AND "siteId" IS NULL)` on the dev DB only. The user stands outside the mask for 30 s. The box is grey with `person 0.xx · outside watch area`, and `psql` shows no new open camera danger for E1.
  4. **Use whole picture** on E1, then stand anywhere: the alert is raised (no mask = whole picture). Resolve it.
  5. **Screenshots:** a Playwright script `<scratchpad>/plan-h/shots.mjs` (Chromium from the repo-root `node_modules/playwright`, `NODE_EXTRA_CA_CERTS` from `docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt`) saves PNGs to `<scratchpad>/plan-h/`:
     - `/cameras` (admin): E1 live, an offline-linked card, an unlinked `Simulated` clip, the Devices section;
     - `/cameras` as a viewer;
     - `/settings/cameras` with the E1 mask editor open;
     - `/analytics` with the demo-patrol note (with `DEMO_PATROL=1` if set in `.env`);
     - the grey outside box from step 3, captured by the user if timing needs it.
     The script also asserts the nav labels `Map, Cameras, Analytics, Settings`.

- [ ] **Step 6: Commit docs**
```bash
git add README.md dashboard/README.md CLAUDE.md agent.md GOAL_TODOS.md
git status --short
git commit -m "docs: HatchWatch name, Cameras page, per-camera masks, Settings routes and updated diagrams"
```

---

## Self-review

**Spec coverage**
- §1 labels → Task 3 (four places, exact strings). Main's two tests are flipped to assert presence for simulated videos.
- §2 demo note → Task 3. It covers the map tiles, Outcomes and the historical record (response times exist only in the deleted prototype; ambiguity 11).
- §3 Cameras page → Task 4:
  - zones; live / offline device / clip states; Devices section with the admin list;
  - header actions; Recordings; one nav item;
  - `/live` and `/live/motion` redirects;
  - the Plan E/F/G cases carried over in `allCamerasScreen.test.tsx`.
- §4 masks:
  - storage, editor over the current picture, "this camera only", no mask = whole picture → Task 5;
  - feet rule, grey `outside watch area`, never raise or append → Task 6;
  - research file per code with derived slots, runner unchanged → Task 5 (`test_camera_masks_contract.py` against the frozen `load_mask`);
  - faint outline → Task 6.
- §5 Settings routes → Task 2 (links, tests, permanent redirects) and Task 9 (docs, grep gate).
- §6 rename:
  - kept names → Task 8 `compose-names.test.ts` and the README note;
  - dual-accept header and schema ids → Task 7, deployed before writers and firmware change (Task 8);
  - storage keys migrated once → Task 7;
  - frozen files untouched → `git diff` checks in Tasks 5 and 9;
  - alert wording unchanged (no task edits it; Task 6 keeps the Plan G strings).
- §7 prototype removal after reference checks → Task 1.
- §8 docs, four diagrams, render check → Task 9 Steps 1–2.
- §9 testing:
  - suites: Task 9 Step 3;
  - label presence: Task 3; demo note: Task 3;
  - Cameras states and redirects: Tasks 4 and 2;
  - mask save, validation and research compatibility: Task 5; worker/alert mask rule: Task 6;
  - settings redirects: Task 2; header dual-accept and storage migration: Task 7;
  - end-to-end ESP32 inside/outside: Task 9 Step 5.

**Placeholder scan:** no TBD or TODO. Every new pure function, the redirect list, the rule change, the header and storage helpers and the research-file builder are given in code. UI work is specified as behaviour lists with exact strings and named DOM tests, as in Plans E–G.

**Type consistency:**
- `MaskPoint[]` (normalised) flows from `validCameraMask`/`cleanCameraMask` into `Camera.maskPolygon`, then `asCameraMask` into `CameraView.mask`/`CameraRow.mask`, then `DetectionOverlay`/`DeviceTile`/`MaskEditor`.
- On the server it flows from `asCameraMask` into `qualifyingPerson(detections, mask)` inside `raiseCameraDanger`.
- `toPixels` produces the 1280×720 polygons in `ResearchMasksFile`. Those are read by `pipeline/extract.py load_mask` (slots) and `importChunk` `maskFileSchema` (unchanged), and end up in `Video.maskPolygon` (pixels, display only).
- `Page` loses `'live'`/`'setup'` and gains `'settings'`, and every `current=` prop is updated in Tasks 2 and 4.
- `LEGACY_ROUTES` is used only by `next.config.ts` and `redirects.test.ts`.
