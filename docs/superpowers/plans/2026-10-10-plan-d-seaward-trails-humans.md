# NestTrace — Plan D: Seaward Cameras, Turtle Trails, Humans and Danger Alerts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in seaward camera layout and walking humans to the simulator, derive per-turtle trails and person detections blindly from public outputs, and show coloured growing trails and level-1 danger alerts on the dashboard.

**Architecture:** `web/simulation.ts` gains `layout` and `humans` config options (defaults reproduce today's renders). Two new research scripts read only public run outputs: `scripts/track_paths.py` (ground-grid motion → tracks matched to pins) and `scripts/people_detect.py` (calibrated height rule on moving blobs). They write versioned public JSON (`tracks/tracks.json`, `people/people.json`) before the live manifest. The dashboard importers read those optional files, store `Track` rows and raise `DANGER` alerts linked to sites; the map draws trails up to the playback clock and highlights danger.

**Tech Stack:** Three.js simulator (TypeScript), Playwright recorder, Python 3.12 + NumPy + OpenCV 5 (`cv2.connectedComponentsWithStats`, `cv2.BackgroundSubtractor` not required), pytest; dashboard Next.js 16 / Prisma 7 / Vitest 5 / react-map-gl.

**Spec:** `docs/superpowers/specs/2026-10-10-simulator-seaward-trails-humans-design.md`

## Global Constraints

- New simulator behaviour is opt-in: `layout` default `'along'`, `humans` default `0`; with defaults a rendered frame must be byte-identical to before for the same seed/scenario/model.
- Do not edit `pipeline/*`, `config/*`, `results/*`, `*RESULTS.md`. New research code in `scripts/` and `tests/`; new schemas in `schemas/`.
- Research scripts read only a run's public folder; never `artifacts/private`, truth, seeds or scenario names. `people_detect.py` must not import `pipeline/detect.py`.
- New public outputs: `tracks/tracks.json` (`schema: "nesttrace.tracks"`, `version: 1`), `people/people.json` (`schema: "nesttrace.people"`, `version: 1`); both written **before** `live-chunk.json`.
- Person = moving blob with height ≥ **1.2 m** above its ground contact, ground point inside `ground_bounds`. Danger radius **3.0 m**, from `site.startT − 2 s`. Danger message exactly **"Danger · person near an active nest site — immediate action"**, level 1.
- Digging alert wording unchanged: `Digging activity detected; nesting unresolved.`
- Trail palette (6 colours, no amber): `#4FC3F7`, `#F06292`, `#AED581`, `#BA68C8`, `#4DB6AC`, `#FFF176`; unmatched trails `#8A9BA6`.
- Demo seeds for this plan: `929`, `937` (seaward + 2 humans), `941` (seaward, 0 humans); verify absent from every `config/*registration*.json` (existing guard).
- Commits: no `Co-Authored-By`/AI attribution; explicit paths; never stage `artifacts/`, `dashboard/media/`, `.superpowers/`, `.env`.

## Review Focus

1. **Default renders change** (layout/humans code touches shared paths) → the frozen experiments silently drift. Pinned in Task 1 (frame-hash test with defaults).
2. **Turtles classified as people** (raised flippers, parallax) → false danger alerts. Pinned in Task 3 (synthetic flat-blob test + seed 941 with 0 humans must yield 0 people).
3. **Chunk published before tracks/people exist** → dashboard imports a chunk without them forever. Pinned in Task 4 (runner order; importer treats them as optional but the runner writes them first).
4. **Danger raised repeatedly every scan / on re-import** → alert spam. Pinned in Task 5 (once per person × site; idempotent re-import).
5. **Danger alert never clears or auto-archives wrongly** → stuck red chip / silent loss. Pinned in Task 5 (lifecycle tests).

---

### Task 1: Simulator — `layout: 'seaward'` and `humans: N`

**Files:** Modify `web/simulation.ts`, `scripts/record.mjs`, `scripts/live-runner.mjs`; create `web/simulationOptions.test.ts` (or `tests/sim-options.test.mjs` run by root `npm test` — choose what the root test runner supports and add it to `scripts/test.mjs`).

**Interfaces (produced):** `SimConfig = { seed; scenario; model; eggs?; layout?: 'along' | 'seaward'; humans?: number }`; `record.mjs --layout <along|seaward> --humans <0-4>` (stored in private `config.json` only); `live-runner.mjs --layout … --humans …` passed through to `record.mjs`.

- [ ] **Step 1: Baseline hash test (write first, must pass before any change).** A Playwright-free check is not possible for WebGL, so use the recorder page: script `scripts/sim-frame-hash.mjs --seed 11 --scenario swarm --model A [--layout ..] [--humans ..] --t 20 --view 0` that loads `record.html` (Vite on 5173) and prints the SHA-256 of `nestRecord.frame(t, view)`. Record the hashes for (seed 11, swarm, view 0 and 1, t 20) **before** editing `simulation.ts`; store them in `tests/fixtures/sim-default-frame-hashes.json`. Add `tests/test_sim_defaults.py` (pytest, skipped unless `NESTTRACE_SIM_CHECK=1` and 5173 answers) that recomputes and compares.
- [ ] **Step 2: Seaward cameras.** In the camera loop: if `config.layout === 'seaward'`, create cameras at `(−9, 5.6, 14)` and `(9, 5.6, 14)`, fov 52, `lookAt(x ± 6 toward centre, 0, −8)` (camera at −9 looks at `(−3, 0, −8)`; at +9 looks at `(3, 0, −8)`); else today's code unchanged. Update the calibration `note` text only for seaward ("Dune-mounted seaward cameras at 5.6 m…").
- [ ] **Step 3: Marker visibility test.** `scripts/sim-markers-check.mjs` (same page) asserts for `layout: 'seaward'` that all six `reference_points` pixels of both calibrations lie inside `[0,1280)×[0,720)` and that the water plane centre `(0, 0.1, −20)` projects inside the frame for both cameras. Run it; wire both checks into `scripts/test.mjs` behind `NESTTRACE_SIM_CHECK=1`.
- [ ] **Step 4: Humans.** When `humans > 0`: build `humans` articulated walkers (legs, torso, arms, head as boxes/capsules; height 1.65–1.85 m from `this.random()` — draw these random numbers **after** all existing random draws so turtle specs are unchanged). Each walker follows a seeded straight path across the area at 1.2–1.5 m/s, visible 2–38 s; walker 0's path is chosen to pass within 1.5 m of turtle 0's target during its dig window. Walking animation: legs/arms swing with phase. Walkers do not appear in `forcing()` (no sand disturbance). Night scenarios render them dark like turtles.
- [ ] **Step 5: Truth.** In `truth()`, add `people: [{ id, path: [[t, x, z] every 0.5 s] }]` only when `humans > 0` (private file only).
- [ ] **Step 6: Recorder/runner flags.** `record.mjs`: parse `--layout` (validate `along|seaward`) and `--humans` (int 0–4); include in `config` passed to `nestRecord.init`; written to private `config.json`. `live-runner.mjs`: accept `--layout`, `--humans`; pass through to `record.mjs`; log them at start.
- [ ] **Step 7: Verify.** Re-run Step 1 hashes with defaults → identical. Record one quick run `node scripts/record.mjs --seed 929 --scenario swarm --model A --layout seaward --humans 2 --id D-check-929` and extract frames at t=10 s and 20 s from both cameras (scratchpad); look at them: ocean ahead in both, walkers visible and human-shaped. Root `npm test` passes.
- [ ] **Step 8: Commit** `feat(sim): opt-in seaward camera layout and walking humans`.

---

### Task 2: `scripts/track_paths.py` + `schemas/tracks.v1.json`

**Interfaces (produced):** `track_paths.build_tracks(signals: list[dict], calibration: dict, pins: list[dict], timestamps: list[float], motion_threshold: int) -> dict` (the `tracks.json` document); CLI `python scripts/track_paths.py RUN_DIR` writes `RUN_DIR/tracks/tracks.json`.

- [ ] **Step 1: Failing pytest `tests/test_track_paths.py`** with synthetic grids (`motion` arrays `(T, 120, 160)` uint8; `ground_bounds [-12,12,-8,8]`):
  - one 3×3 blob moving from row of `y = −7` to `y = 2` over 8 s at 8 fps → one track, ≥ 3 s, starts at `y ≤ −5`, matched to a pin at its end point within its interval;
  - two blobs on separate lanes → two tracks, each matched to its own pin;
  - a 1 s noise blob → rejected; a blob starting at `y = 3` (never near water) → rejected;
  - a 3-frame gap mid-track → still one track;
  - points decimated to ≤ 4 per second; output validates against `schemas/tracks.v1.json` (use `jsonschema` only if already installed, else a hand check of keys/types).
- [ ] **Step 2: Implement.** Grid → metres: `x = x0 + col * (x1 − x0) / (W − 1)`, `y = z0 + row * (z1 − z0) / (H − 1)` (matches `pipeline/common.ground_homography`). Per frame and view: `mask = motion > threshold`; `cv2.connectedComponentsWithStats`; keep components ≥ 4 cells; centroid → metres. Fuse views: points from both views within 1.0 m in the same frame → average; others kept. Link: greedy nearest neighbour per frame, max 0.8 m step, allow gaps ≤ 4 frames. Keep tracks with duration ≥ 3 s and first point `y ≤ −5`. Pin match: smallest distance between any track point with `t ∈ [pin.interval[0] − 2, pin.interval[1] + 2]` and the pin point; match if ≤ 1.5 m; each pin matched at most once (best track). Decimate to 4 Hz. Write JSON with the `note`.
- [ ] **Step 3: Schema file** `schemas/tracks.v1.json` (draft 2020-12; `additionalProperties: false`; `schema` const, `version` const 1, `tracks[]` with `id` pattern `^track-[0-9]+$`, `pin_id` string|null, `points` array of `[number, number, number]` minItems 2, `note` string).
- [ ] **Step 4: Run on real data.** `python scripts/track_paths.py artifacts/public/A-swarm-demo-907` → report track count and how many matched pins (6 pins expected; aim ≥ 4 matched). If < 4, tune only the constants in this script (threshold multiplier, min cells, link distance) on runs 901/907 and record the final values; never touch `config/`.
- [ ] **Step 5: Commit** `feat(research): blind turtle trail tracks from public motion signals`.

---

### Task 3: `scripts/people_detect.py` + `schemas/people.v1.json`

**Interfaces (produced):** `people_detect.pixel_ray(calibration, u, v) -> (origin: np.ndarray[3], direction: np.ndarray[3])`; `people_detect.blob_height(calibration, foot_uv, top_uv) -> (ground_xz: tuple[float, float], height_m: float)`; `people_detect.detect_people(run_dir) -> dict`; CLI writes `RUN_DIR/people/people.json`.

- [ ] **Step 1: Failing pytest `tests/test_people_detect.py`:**
  - `pixel_ray` for the image centre of a known calibration (camera at `(0, 5, 10)` looking at `(0, 0, 0)`, fov 50) points at the origin within 1e-3;
  - `blob_height`: project a synthetic vertical pole of 1.8 m standing at `(2, 0, 1)` into that camera (foot and top pixels computed with the same pinhole maths), then recover ground `(2, 1)` ± 0.05 m and height 1.8 ± 0.05 m; a 0.4 m object → 0.4 ± 0.05;
  - a synthetic 64×36-pixel frame sequence with a tall moving rectangle and a flat moving ellipse → one person (the rectangle), the ellipse rejected;
  - output validates against `schemas/people.v1.json` keys/types.
- [ ] **Step 2: Implement.**
  - Ray: three.js camera conventions — camera looks along −Z, +Y up; `ndc = (2u/W − 1, 1 − 2v/H)`; `dir_cam = (ndc.x · tan(fov/2) · W/H, ndc.y · tan(fov/2), −1)` normalised; rotate by the quaternion `(x, y, z, w)`; origin = `mount_position_m`.
  - Height: map the foot pixel to ground `(x, z)` with a homography fitted (`cv2.findHomography`) to the calibration's `reference_points` pixel→world pairs (reimplemented here; do not import `pipeline`). For the foot ray `(C, d_f)` and the top ray `(C, d_t)`, take each ray's closest approach to the vertical line through `(x, z)`: `s = ((x − C.x)·d.x + (z − C.z)·d.z) / (d.x² + d.z²)`; `height = (C.y + s_t·d_t.y) − (C.y + s_f·d_f.y)`.
  - Detection: read `camera-N.mp4` with OpenCV; background = per-pixel median of the first 16 frames (2 s); per frame `absdiff > 25` on grey, `morphologyEx` open 3×3 then close 7×7; components with area ≥ 150 px; foot = bottom-centre, top = top-centre of the bounding box; height via `blob_height`; person if `height ≥ 1.2` and ground point inside `ground_bounds`. Fuse views (≤ 1.0 m, same frame); link (≤ 1.5 m per frame, gap ≤ 4); keep tracks ≥ 1 s; `max_height_m` per track; decimate to 4 Hz.
- [ ] **Step 3: Schema file** `schemas/people.v1.json` (same style as tracks).
- [ ] **Step 4: Measure.** Record `D-check-929` (Task 1) if not present, plus `D-check-941` (seaward, `--humans 0`) and `D-check-937` (seaward, `--humans 2`). Run the detector. Using private truth **only inside this measurement step's report script in the scratchpad** (never in `scripts/`), compute per-walker frame recall and false people. Target: ≥ 70 % recall per walker while fully in view; 0 people on 941. If not met, tune only this script's constants (diff threshold, morphology, min area, height threshold 1.0–1.4 m) and record the final values and measurements in the report.
- [ ] **Step 5: Commit** `feat(research): blind calibrated height-rule people detector`.

---

### Task 4: Wire trails and people into demo runs and the live runner

- [ ] `scripts/demo_runs.py`: `DEMO_RUNS` entries become dicts with optional `layout`/`humans`; add `A-seaward-humans-demo-929` (swarm, 929, seaward, 2), `A-seaward-humans-demo-937` (swarm, 937, seaward, 2), `A-seaward-demo-941` (swarm, 941, seaward, 0); `run_one` passes `--layout/--humans` to `record.mjs` and runs `track_paths.py` and `people_detect.py` after pin grouping; `complete()` also requires `tracks/tracks.json` and `people/people.json`. Update `tests/test_demo_runs.py` (seed guard still covers new seeds).
- [ ] `scripts/live-runner.mjs`: after `pin_fuse.py`, run `track_paths.py` and `people_detect.py` (both via `python`), then write the manifest (unchanged schema). Failures in either script are logged and the chunk is still published without that file (dashboard treats them as optional).
- [ ] Record the three demo runs (`.venv/bin/python scripts/demo_runs.py --only <id>` one per command; `NESTTRACE_BROWSER` set to Chrome if needed). Report pins / tracks matched / people per run.
- [ ] Root `npm test` passes. Commit `feat(research): trails and people in demo runs and the live runner`.

---

### Task 5: Dashboard data — tracks, danger alerts, lifecycle

**Files:** `dashboard/web/prisma/schema.prisma` (+ migration), `src/lib/sim/schema.ts` (zod mirrors `tracksFileSchema`, `peopleFileSchema`), `src/lib/sim/importRun.ts`, `src/lib/live/importChunk.ts`, `src/lib/sites/{summary,events,outcomes}.ts`, `src/lib/danger.ts` (new), `src/server/snapshot.ts`, `src/lib/types.ts`, tests.

**Interfaces (produced):**
```ts
// prisma: AlertKind += DANGER; Alert.siteId String? (FK Alert, onDelete Cascade), Alert.level Int @default(0); Track.alertId String? (FK Alert, onDelete Cascade), Track.colorIndex Int?
// SiteEventType += 'danger' (system) | 'dangerResolved' (person)
export const DANGER_MESSAGE = 'Danger · person near an active nest site — immediate action';
export const DANGER_RADIUS_M = 3;
export function findDangers(sites: { alertId: string; position: LngLat; startT: number }[], people: { id: string; points: { t: number; position: LngLat }[] }[]): { alertId: string; personId: string; at: number; position: LngLat; startT: number; endT: number }[]; // once per (person, site)
// SiteSummary += danger: 'none' | 'active' | 'resolved'
// AlertView += level: number; siteId: string | null; colorIndex: number | null
// MapSnapshot += tracks: { id: string; alertId: string | null; colorIndex: number | null; key: string /* simRunId */; points: { t: number; position: LngLat }[] }[]; dangerCount: number
```
- [ ] Failing tests first: zod mirrors accept real fixture files (copy one `tracks.json` and one `people.json` from a Task 4 run into `tests/fixtures/`) and reject malformed; `findDangers` (person passes within 2 m at t ≥ startT − 2 → one danger; passes at 5 m → none; passes twice → still one; before startT − 2 → none); importer integration: tracks stored with `alertId` of the matched pin and stable `colorIndex` (pin order), unmatched track `alertId null`; dangers create one `DANGER` alert (`level 1`, `siteId`, exact message) + one `danger` SiteEvent on the site; re-import idempotent (no duplicate dangers); `summarizeSite` → `danger: 'active'` until `dangerResolved`/`protectionInstalled`/`patrolVisit`/`note` → `'resolved'`; DANGER alerts are never auto-archived (`ageSites` skips them) and are active until resolved; outcomes: a site with a `danger` event not followed by `protectionInstalled` within 30 min → `notSaved` (both `classifyOutcome` and the `groupBy` path — add a status or compute from events for these sites; record the approach).
- [ ] Implement; `POST /api/sites/[alertId]/events` accepts `dangerResolved` for DANGER alerts (VOLUNTEER+), which marks the danger alert resolved (cached status `REVIEWED` → inactive tab) and appends `dangerResolved` to the linked site's log.
- [ ] Snapshot: include tracks for the alerts in the snapshot (bounded by their alerts) and `dangerCount` (active DANGER alerts).
- [ ] Full dashboard suite; commit `feat(dashboard): import trails and people, raise level-1 danger alerts`.

---

### Task 6: Dashboard UI — coloured growing trails and danger

Behaviour list (implement all):
- Trails layer (new "Trails" toggle in the layers menu, default on). While a feed plays, draw each track of that clip (`key === playback.key`) from its first point up to the latest point with `t ≤ playback.t`, plus a 4 px head dot; colour = palette[`colorIndex`] or grey when null. With no feed playing, draw full trails of active sites at 60 % opacity. Trails sit under pins.
- Pins: a site's ring colour matches its trail colour when it has one (protection state still shown as the pill on the card and in the drawer; ring stroke width keeps the evidence-tier meaning).
- Danger: DANGER alerts sort first in Active with a red "Level 1 · Danger" badge; their pins pulse red (CSS/MapLibre animation; reduced-motion → static red); top bar shows a red "N danger" chip when `dangerCount > 0` (links to the first danger alert); the site drawer for the linked site lists danger events; a DANGER alert's drawer shows the person-approach time, the linked site, and a **Resolve danger** action (volunteer/admin) with optional note.
- Legend: "Turtle trail — colour matches its site", "Danger — person near a site".
- Analytics: add a "Danger alerts" tile (active / total) and include danger in the Not saved explanation text.
- Tests: trail clipping to clock time, colour mapping, danger sort/badge/chip, resolve action permissions, legend rows; visual Playwright check with an imported seaward + humans run (screenshots, phone + desktop).
- Commit `feat(dashboard): coloured turtle trails and level-1 danger alerts`.

---

### Task 7: Import, end-to-end, docs

- [ ] Import `A-seaward-humans-demo-929` onto pair B and `A-seaward-demo-941` onto pair C (`npm run sim:import`), start `node scripts/live-runner.mjs --layout seaward --humans 2 --chunks 1` in the background; Playwright: B1 shows ocean ahead; trails grow with playback in distinct colours; a danger alert appears (red chip), volunteer resolves it; Analytics shows the danger tile; 941 shows no danger. Screenshots → scratchpad `plan-d/`.
- [ ] Docs: root `README.md` (new `--layout`, `--humans` options; blind trails/people scripts and their limits; not a registered experiment), `dashboard/README.md` (trails, danger alerts, resolve flow), `agent.md` (new public outputs `tracks/`, `people/` and their schemas; people detection reads RGB but is separate from the digging detector), `CLAUDE.md` (commands).
- [ ] Full verification: root `npm test`; dashboard `npm run db:test:prepare && npx vitest run && npx tsc --noEmit && npx next build`.
- [ ] Commit `docs: seaward layout, trails, humans and danger alerts`.

## Self-review notes
- Spec §2 → Task 1; §3.1 → Tasks 2, 4; §3.2 → Tasks 5, 6; §4.1 → Task 1; §4.2 → Tasks 3, 4; §4.3 → Tasks 5, 6; §5 → tests in each task + Task 7.
- Ruling recorded: no HOG/cascade in OpenCV 5 → calibrated height rule (spec §1).
- Private truth is used only in Task 3's scratchpad measurement, never in committed code or the dashboard.
