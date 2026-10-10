# NestTrace Simulator + Dashboard: Seaward Cameras, Turtle Trails, Humans and Danger Alerts

Date: 2026-10-10
Status: Defaults accepted in chat (items 8, 10, 11 of the proposal); "go ahead with plan D". Pending written-spec review.
Builds on: branch `feat/dashboard-fullstack` (head `5503a6c`), Plans 1, A, C.

## 1. Intent

**Stated by the user**
- Camera views: "north viewing and south viewing has ocean on same side which is wrong" → cameras on the dunes **facing the ocean**.
- **Trails** from the ocean to each laying place, **one colour per turtle**.
- **Humans** in the simulation that make turtles unsafe → **danger / immediate action, level 1** alert.

**Decisions (from the accepted proposal, adapted)**
- Every simulator change is a **new opt-in option**; existing scenarios, layouts and registered experiments render exactly as before.
- Trails and people are derived **blind** from public outputs (camera video + public calibration), never from simulator truth.
- Person detection: OpenCV 5 (the pinned version) has no HOG pedestrian detector or cascades, and a DNN model would need downloaded weights. **Ruling:** use a calibrated **height rule** on moving blobs (person = moving blob whose top stands ≥ 1.2 m above its ground contact). No downloads, no training, explainable. A DNN detector can replace it later behind the same output file.

**Boundaries**
- `pipeline/*`, `config/*`, `results/*`, `*RESULTS.md` are not edited. New research code lives in `scripts/` (+ `tests/`). New public outputs live in each run's public folder.
- The dashboard reads the new files only through versioned schemas (`schemas/tracks.v1.json`, `schemas/people.v1.json`), from public folders, through the existing adapters.
- Alert wording for digging stays `Digging activity detected; nesting unresolved.` Danger alerts never claim harm occurred.
- Changing `web/simulation.ts` changes its source hash, so the batch scripts that verify registered hashes will refuse; registered results remain reproducible at their recorded revisions (already documented in README). Coordinate with nothing2me and William before pushing.

## 2. Seaward camera layout (simulator)

- `SimConfig.layout?: 'along' | 'seaward'` (default `'along'` = today).
- `seaward`: two cameras on the dune side of the analysed area, at `(−9, 5.6, +14)` and `(+9, 5.6, +14)` (x along the shore, z inland), each looking at a point on the waterline side of the area turned 20° toward the area centre: camera at `x = −9` looks toward `(−9 + 6, 0, −8)`, camera at `x = +9` toward `(+9 − 6, 0, −8)`. Vertical fov 52°. Both see the ocean ahead.
- Calibration output unchanged in shape (`mount_position_m`, `orientation_quaternion_xyzw`, `vertical_fov_degrees`, `ground_bounds [-12,12,-8,8]`, `reference_points` projected from the six markers). The six markers stay in view (verified by a test that projects them inside the frame for both cameras).
- `scripts/record.mjs` gains `--layout <along|seaward>` (default along) and stores it in the private config only. `scripts/live-runner.mjs` gains `--layout` and passes it through; the live manifest's `cameras[].end` keeps meaning "x_min / x_max side of the area".
- Dashboard mapping is unchanged (camera at `x_min` → `<zone>1`, north end). With the seaward layout the dashboard cameras of the zone the chunk lands on show ocean-ahead views, matching admin-placed pairs (Plan C) that face the ocean.

## 3. Turtle trails

### 3.1 Research side
- New `scripts/track_paths.py RUN_DIR` (public inputs only: `view-0/signals.npz`, `view-1/signals.npz`, `calibration-*.json`, `pins/predictions.json`, `timestamps.json`). It does not touch `pipeline/`.
- Method: per view, threshold the ground-projected motion grid (`motion > settings.motion_threshold` from `config/settings-swarm.json`), connected components per frame → centroids in metres; fuse both views by averaging centroids within 1.0 m in the same frame; link frames with nearest-neighbour (≤ 0.8 m per frame, gap ≤ 4 frames); keep tracks ≥ 3 s long that start within 3 m of the water edge (`y ≤ −5`). Each track is matched to the nearest pin (≤ 1.5 m from any track point during the pin's interval) → `pin_id`.
- Output `tracks/tracks.json`:
  ```json
  { "schema": "nesttrace.tracks", "version": 1,
    "tracks": [ { "id": "track-1", "pin_id": "pin-3" | null,
                  "points": [[t, x, y], ...] } ],
    "note": "Blind tracks from public motion signals; positions are approximate." }
  ```
  Schema file `schemas/tracks.v1.json`. Points are decimated to ≤ 4 per second.
- Called by `scripts/demo_runs.py` and `scripts/live-runner.mjs` after pin grouping and **before** the live manifest is written (so a chunk is complete when the manifest appears).

### 3.2 Dashboard
- `sim-import-v1` and the live importer read `tracks/tracks.json` if present (optional; absent → no trails), validate against a zod mirror, map points with the existing zone frame, and store `Track` rows (existing table): `videoId` = `<pair>1` video, `points` = `[{t, lng, lat}]`, `label` = track id, `alertId` (new nullable FK) = the alert created for `pin_id`.
- Colour: each site gets a stable colour from a fixed 6-colour palette validated for contrast on the dark satellite (amber excluded — reserved for attention), assigned in pin order per clip; the site's pin ring and its trail share the colour. Unmatched tracks are drawn grey.
- Drawing: while a feed plays, each trail of that clip is drawn **up to the current clock time** (growing line from the water) with a small head dot; when no feed plays, full trails of active sites are drawn at 60 % opacity. Trails toggle with the existing layer menu (new "Trails" layer).
- Legend: "Turtle trail (colour matches its site)".

## 4. Humans and danger alerts

### 4.1 Simulator
- `SimConfig.humans?: number` (0–4, default 0). Human actors: articulated low-poly figures 1.65–1.85 m tall (legs, torso, arms, head) with a walking animation, walking along seeded paths across the analysed area. At least one walker per run passes within 2 m of a digging turtle during its dig window when `humans ≥ 1`. Walkers never touch the sand forcing (no sand disturbance) so digging detection is unchanged.
- `scripts/record.mjs --humans N`, `scripts/live-runner.mjs --humans N`.
- Truth (private) records walker paths for later evaluation only; never read by the dashboard or detectors.

### 4.2 Research side: blind people detector
- New `scripts/people_detect.py RUN_DIR` (public inputs only: `camera-N.mp4`, `calibration-N.json`, `timestamps.json`). Reads RGB like the extractor does; it is separate from the digging detector and never imports `pipeline/detect.py`.
- Method per view and frame: background subtraction against the median of the first 2 s; morphological clean-up; connected components; for each blob take the bottom-centre pixel as the ground contact, project it to the ground plane with the calibration (ray–plane intersection using mount position, orientation quaternion and vertical fov), then intersect the ray through the blob's top-centre pixel with the vertical line above that ground point to get the blob's **height in metres**. Blob is a **person** if height ≥ 1.2 m and ground point inside the analysed area. Fuse views (≤ 1.0 m, same frame), link into tracks (≤ 1.5 m per frame).
- Output `people/people.json` (schema `schemas/people.v1.json`):
  ```json
  { "schema": "nesttrace.people", "version": 1,
    "people": [ { "id": "person-1", "points": [[t, x, y], ...], "max_height_m": 1.74 } ],
    "note": "Blind height-rule detections from public video; not identity, not intent." }
  ```
- Called by `demo_runs.py` and `live-runner.mjs` after the existing pipeline, before the manifest.
- Verification: with `--humans 2` on two fresh seeds, the detector finds every walker for ≥ 70 % of the frames it is fully in view, and finds no person on two `--humans 0` seeds (turtles must never be classified as people). Measured numbers go in the report; this is a demo capability, not a registered experiment.

### 4.3 Dashboard: danger
- Importers read `people/people.json` if present. For each person track, for each site of the same clip: if any person point is within **3.0 m** of the site position at a time `t ≥ site.startT − 2 s`, raise danger once per (person, site):
  - a system `SiteEvent` `danger` on the site (author "Camera", note "Person within 3 m of the site at mm:ss"), and
  - a new `Alert` of kind `DANGER`, level 1: message **"Danger · person near an active nest site — immediate action"**, position = the person point at closest approach, `startT/endT` = the time window within 3 m, linked to the site via a new nullable `Alert.siteId` FK, camera/zone = the site's.
- Danger alerts are **active until a person logs `protectionInstalled`, `patrolVisit` or `note` on the site, or resolves the danger alert itself** (new person event `dangerResolved` on the danger alert). They never auto-archive.
- UI: danger alerts sort first in the Active list with a red level-1 badge; their pins pulse red; the top bar shows a red "1 danger" chip when any are active; the site drawer shows the danger events in its log with a **Resolve danger** action (volunteer/admin).
- Statistics: `Not saved` additionally counts sites with a `danger` event not followed by `protectionInstalled` within 30 min (spec C §5 rule, now active). `summarizeSite` gains `danger: 'none' | 'active' | 'resolved'`.

## 4b. Camera editing rework (user correction to Plan C §7)

Stated by the user: "I don't mean to add a new zone but add [cameras] in a new location, and in Setup for cameras too"; "both cameras but editable lat long, remove zone E and move its cameras".
- Map **Edit cameras**: one click adds **both cameras of a pair** at the clicked dune-line spot, both facing the ocean (seaward ±20° toward each other, 40 m apart along the shore, centred on the click), attached to the **nearest existing zone** — no new zone. Codes continue that zone's numbering (`D3`, `D4`, …).
- Every camera's **latitude/longitude is editable** (Setup form and drag-to-move in map edit mode), plus heading, field of view, range, status and code; deleting a camera is allowed when it has no videos/alerts.
- **Setup → Cameras** page (admin): table of all cameras grouped by zone; **Add pair** (zone select + lat/lng inputs or click on a small map); edit row; delete.
- Admin-created zones are no longer created by the UI. Data change: remove **Zone E**; move its two cameras to the nearest zone with new codes; reassign Zone E's `LiveChunk`, `Alert` and `Zone`-scoped references to that zone; then delete Zone E (one transaction, audited).

## 5. Testing

- Simulator: unit test (Vitest in root `tsc` scope or a small node test) that the `seaward` cameras project all six markers inside the 1280×720 frame and both see the water plane ahead; `along` output byte-identical to before for a fixed seed (render-hash test on one frame).
- `track_paths.py`: pytest on synthetic motion grids (two crossing blobs, gaps, short noise tracks rejected, pin matching).
- `people_detect.py`: pytest for the ray–plane height maths with a known camera; synthetic frame with a tall rectangle vs a flat ellipse (person vs turtle); end-to-end measurement on recorded runs (report only).
- Schemas: JSON-schema files + zod mirrors; dashboard tests for optional files absent/present/malformed.
- Dashboard: Track/danger import (integration), colour assignment stability, trail drawn up to clock time, danger alert lifecycle (raise once, resolve, not auto-archived), stats rule, UI badges/pulse/chip.
- End-to-end: record two seaward + humans runs (`demo_runs.py` new entries) and one live chunk with `--layout seaward --humans 2`; see trails grow with playback, a danger alert raised and resolved by the volunteer, analytics Not saved rule.

## 6. Out of scope

Night/IR person detection, identity or intent of people, real-world accuracy claims, changing registered scenarios or pipeline code, phones, DNN models (possible later swap behind `people.v1`).
