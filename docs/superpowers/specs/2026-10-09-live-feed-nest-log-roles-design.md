# NestTrace Dashboard: Live Feed, Nest Log, Analytics, Roles and Camera Editing

Date: 2026-10-09
Status: Approved in chat ("skip phones part"; from main take only the 24 h sim and the analytics menu; "go ahead").
Builds on: Plan 1 + Plan A (branch `feat/dashboard-fullstack`, head `ce1a6fe`). Phones (Plan B) are dropped; its one built task was reverted.

## 1. Intent

**Stated by the user**
- From `origin/main` take **only** the 24-hour live simulation and the analytics menu — no merge, nothing else from main.
- Trails from the ocean to each laying place, one colour per turtle. *(Simulator-side; Plan D.)*
- Admin **edit mode to add cameras**: one click adds both cameras of a pair, always facing the ocean.
- Admins add **volunteers**, who cannot add cameras.
- When a nest **hatches**, its alert leaves the active list and moves to **inactive alerts**.
- A **bigger / resizable** camera view.
- **Statistics**: how many saved vs not saved.
- Humans in the simulation that endanger turtles → **danger / immediate action, level 1** alert. *(Simulator-side; Plan D.)*
- Fix camera views so north- and south-facing views don't show the ocean on the same side. *(Plan D: seaward camera layout.)*

**Decisions taken from the proposed defaults**
1. Keep the Next.js app. Copy only William's three simulator-side files; rebuild the dashboard side of the live feed and an Analytics menu in our app. William's nest-log screens, demo patrol, backend and toasts are not taken.
2. Phones: dropped.
3. Live feed: a dashboard service watches `live-chunk.json` manifests and updates every open dashboard.
4. Saved = protected and later hatched; Not saved = lost, disturbed, or never protected.
5. `Hatched` status; hatched/dismissed/archived → Inactive.
6. VOLUNTEER role: see everything, update alerts, no camera/zone/user management.
7. Admin edit mode: one click places a camera pair on the dune line, both facing the ocean.
9. Expand button + resizable camera panel.

**This spec covers items 1, 3–7, 9 (dashboard only).** Items 8, 10, 11 (seaward sim cameras, trails, humans/danger) get their own spec (Plan D) because they change the shared research simulator.

**Boundaries (unchanged, from `agent.md`)**
- The dashboard reads simulator output only through versioned public contracts: `sim-import-v1` (demo runs) and William's `schemas/live-chunk.v1.json` (live chunks). Never `private/`, seeds, scenario names or truth.
- Detector alerts say exactly `Digging activity detected; nesting unresolved.` Only a person (patrol/volunteer) can confirm a nest; the demo patrol never does.

## 2. Files taken from `origin/main` (no merge)

- Copy exactly three files from `origin/main` (`fc649c3`) with `git checkout origin/main -- <path>`: `scripts/live-runner.mjs`, `schemas/live-chunk.v1.json`, `web/simulation.ts` (its 7-line `swarm-spread` lane shuffle). Commit message credits William's commit `2b25bc5`.
- Nothing else from `main`: not its dashboard, docs, tests or nest log. William's `dashboard/server/liveChunkAdapter.js` and `dashboard/src/components/NestCharts.jsx` are read as references only.
- Root `npm test` must pass after the copy.

## 3. Live feed (port of William's backend)

### 3.1 Watcher
- Runs inside the `web` process, started from Next's `instrumentation.ts` `register()` when `LIVE_FEED=1`; one poller per process (guarded by a global flag).
- Polls `LIVE_ROOT` (Compose mounts repo `artifacts/public` read-only at `/sim-public`; host dev default `../../artifacts/public`) every 3 s for folders matching `^live-[0-9]{6}-[A-Za-z0-9]+$` that contain `live-chunk.json`.
- Validates each manifest against `live-chunk.v1` (zod mirror of the JSON schema) and its `pins/predictions.json` (existing `pinsFileSchema`). Invalid chunks are logged once and skipped.
- Imports each new chunk once (tracked by `LiveChunk` rows keyed by `chunk_id`), oldest sequence first.

### 3.2 Import of a chunk
- Zone: `zones[sequence % zones.length]` over zones ordered by code.
- Camera mapping by manifest `end`: the camera at `x_min` → `<zone>1` (north end, matching our Plan A frame: sim `−x` is the `<pair>1` end); `x_max` → `<zone>2`. Same true-scale frame as `sim-import-v1` (`zoneFrame`/`simPointToLngLat`), with `ground_bounds_m` centred on the zone centroid.
- Media copied to `MEDIA_ROOT/live/<chunk_id>/`; `Video` rows with `source = SIMULATION`, `simRunId = chunk_id`, `liveChunkId`.
- One **nest site** per pin (see §4): `Alert` (kind `DIGGING`, exact message, evidence tier, position, `startT`/`endT`), plus log entries `detected` at `recording_started_at + startT` and `departed` at `recording_started_at + endT`.
- Keep the newest 40 chunks' media (`LIVE_KEEP`); older chunk media is deleted from disk, but their sites and logs stay.

### 3.3 Ageing
- A site **fades** on the map 5 min after detection (`LIVE_FADE_MINUTES`, reduced opacity) and is **archived** after 20 min (`LIVE_ARCHIVE_MINUTES`) unless a person has acted on it: archiving appends an `archived` log entry ("Older than 20 min; removed from the live map. The log is kept.") and the site moves to Inactive. Sites with any patrol entry are never auto-archived.

### 3.4 Realtime
- `GET /api/stream` (SSE, session required): emits `{type:'snapshot'}` when anything changes (new chunk, log entry, archive, camera/zone/user change). Keepalive every 15 s.
- The map and Analytics clients re-fetch `GET /api/snapshot` (same `MapSnapshot` as the server render) on `snapshot`. No toasts, no demo patrol (not taken from main).

## 4. Nest sites and the log

### 4.1 Model
- The existing `Alert` row **is** the nest site. New append-only `SiteEvent` table: `id, alertId, type, author (string), userId?, note?, at (DateTime), createdAt`.
- Event types: system — `detected`, `departed`, `archived`, `danger` *(Plan D)*; person — `patrolVisit`, `nestConfirmed`, `noNestFound`, `protectionInstalled`, `hatched`, `lost`, `note`.
- Derived state (pure function `summarizeSite(events)`, later entries win):
  - `protection`: `unprotected` (default) | `protected` (after `protectionInstalled`) | `notNeeded` (after `noNestFound`).
  - `nesting`: `unresolved` | `confirmed` (`nestConfirmed`) | `noNest` (`noNestFound`).
  - `outcome`: `open` | `hatched` | `lost`.
  - `active`: false when `hatched`, `lost`, `noNestFound`, or `archived` (with no later person entry); else true.
- `Alert.status` stays as a cached column for queries; values extended to `NEW | REVIEWED | DISMISSED | FIELD_CONFIRMED | HATCHED | LOST | ARCHIVED`, recomputed in the same transaction as each event insert. `AlertNote`/`AlertStatusChange` are no longer written (kept for history).
- Hatched requires a prior `nestConfirmed` (UI enforces; server rejects otherwise).

### 4.2 UI
- **Alerts feed** on the map: tabs **Active** / **Inactive** (with counts). Each card shows protection pill (Unprotected red / Protected green / Not needed grey) and nesting status.
- **Site drawer** (click a card or a pin): map close-up, evidence (camera, tier, score, times), the full log (newest first, author + time), and the **Patrol update** form (volunteer/admin): action select (`patrolVisit`, `nestConfirmed`, `noNestFound`, `protectionInstalled`, `hatched` — enabled only after confirmed, `lost`, `note`) + optional note.
- Toasts for new live sites; inactive sites are not drawn on the map.

## 5. Analytics menu and statistics

- **Analytics** item in the top bar → `/analytics` page (all roles), live-updating via `/api/stream`. Scope toggle *On the map now* / *Everything logged*:
  - Tiles: sites, unprotected (with % and red tone when > 0), patrol visited, seen by both cameras (%), archived.
  - Bar charts: protection status, nesting status, sites by zone.
- **Outcomes** (whole log): **Saved** = sites whose outcome is `hatched` after `protectionInstalled`; **Not saved** = `lost`, or a `danger` event never followed by `protectionInstalled` within 30 min *(danger arrives in Plan D)*, or archived while still `unprotected`. **Pending** = everything else. Shown as a stacked bar + numbers, overall and per zone.
- Charts are hand-built SVG in Night Watch style (no chart library); colours from a fixed validated palette.

## 6. Roles and users

- `Role` gains `VOLUNTEER`. Rank: VIEWER < VOLUNTEER < ADMIN.
- Permissions: VIEWER — view only. VOLUNTEER — view + patrol updates. ADMIN — everything incl. users, cameras, zones.
- Server enforcement via DB-backed `requireCurrentUser(role)` for every mutation and API route (carry-over from Plan 1 review).
- **Users page** `/setup/users` (admin): list users; add a user (name, email, role VOLUNTEER/VIEWER/ADMIN, generated temporary password shown once); change role; deactivate (sets `disabledAt`; disabled users cannot log in and their sessions stop working on next request). Every change writes `AuditLog`. An admin cannot demote or disable themselves.

## 7. Camera editing (admin)

- **Edit cameras** toggle in the map controls (admin only). While on, the cursor is a crosshair and a hint shows "Click the dune line to add a camera pair".
- One click at point P creates, in one transaction:
  - a new **zone** (next free code after the last: E, F, …), a 120 m (along shore) × 60 m (seaward) rectangle whose land edge is centred on P;
  - two **cameras** `<code>1` and `<code>2` at the land-edge ends, both with heading pointing **seaward toward the zone centre** (≈ seaward bearing ± 20°), fov 60°, range 90 m, status ONLINE.
- The shoreline direction at P comes from the nearest existing zone (its land-south→land-north bearing); seaward = that bearing + 90° toward the sea side, verified against the zone's sea edge. With no zones, the Holiday Beach default bearing is used.
- Each admin-created zone shows a delete button in edit mode (deletes zone + its two cameras if they have no videos/alerts; otherwise refuses with a message).
- New zones have no footage until a live chunk or import targets them; live rotation includes them.

## 8. Bigger camera view

- Camera panel gets an **Expand** button: opens the same feed (same `CameraVideo`/clock/seek wiring) in a large centred overlay (min(1100px, 92vw), 16:9) with Escape/close; the map clock keeps running from the expanded player.
- The panel itself is resizable on desktop: a drag handle on its left edge sets width between 304 px and 720 px (remembered per browser via `useStoredBoolean`-style guarded storage).

## 9. Testing

- Merge: both suites pass; boundary test still passes (now also forbidding reads outside `LIVE_ROOT`'s chunk folders).
- Live: manifest/pins validation (good/bad fixtures built in the test from the schema), zone rotation, camera end mapping, idempotent chunk import, media retention, ageing (fade/archive with fake clock, no auto-archive after a person's entry), SSE emits on change.
- Log: `summarizeSite` table-driven tests incl. later-entry-wins, hatched requires confirmed, active/inactive rules; API rejects VIEWER patrol updates (403) and accepts VOLUNTEER.
- Stats: saved/not saved/pending classification tests.
- Users: admin-only routes, temp password shown once, disabled user rejected, cannot self-demote.
- Camera editing: geometry test (cameras on land edge, headings seaward, zone code sequence), transaction rollback on failure, delete refusal with data.
- UI: Active/Inactive tabs, drawer form permissions, expand overlay keeps clock, panel resize bounds.
- End-to-end (Playwright, scratchpad): run `live-runner` for 2 chunks with `LIVE_FEED=1`; see new pins and alerts arrive without reload, Analytics updating; volunteer logs `nestConfirmed` → `hatched` → site moves to Inactive and Saved count increments; admin adds a camera pair and a volunteer.

## 10. Out of scope (this spec)

Phones/live device streaming, recording, simulator changes (seaward layout, trails, humans, danger detection — Plan D), real camera integrations, notifications outside the dashboard.
