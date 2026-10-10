# HatchWatch repository guide

This repository has two separate products with different data and trust boundaries.

## Real dashboard (team-owned application)

The real monitoring dashboard lives under `dashboard/` as a Docker Compose app: `web/` (Next.js, port 3000) and Postgres (host port 5433). It owns users, access control, persistent records, and camera feeds. Do not make production behavior depend on a running simulator, the local research API, synthetic seed configuration, or evaluator truth.

Simulation footage reaches the dashboard only through the `sim-import-v1` adapter (`dashboard/web/scripts/sim-import.ts`), which reads public run outputs (`camera-*.mp4`, `view-*/pure-motion.mp4`, `calibration-*.json`, `timestamps.json`, `pins/predictions.json`) and refuses `private/` paths. The dashboard also reads `live-chunk.v1` (`schemas/live-chunk.v1.json`) through a watcher over a read-only mount of `artifacts/public`, public files only (`live-*/live-chunk.json` and the media it names), never `private/` or truth. `dashboard/web/tests/boundary.test.ts` fails if dashboard code references the simulator, the research API, or private truth.

## Synthetic experiment (current application)

`web/` is the Vite/Three.js simulation and research UI. `web/sand.ts` is the particle bed. `pipeline/` contains video extraction, blind detection, and post-inference evaluation. `scripts/server.mjs` serves the local research UI on port 5174; Vite serves it on port 5173. `config/` contains the registered experimental rules and frozen settings. Generated run data belongs in ignored `artifacts/`; `examples/` holds one versioned demonstration.

Keep simulation-only data—seeds, turtle state, scenario names, sand particle state, hidden eggs, and evaluator truth—out of the detector and out of future real-dashboard ingestion. The detector receives only saved-video difference signals, timestamps, public calibration, and frozen settings in a separate process. Do not add runtime imports from `web/` or private evaluator files to `pipeline/detect.py`.

## Integration boundary

The dashboard team may later create an explicit adapter for reviewed outputs: `predictions.json`, public camera calibration, video evidence, and `motion-map.png`. Treat the motion map as an approximate ground projection. Keep the existing alert wording: **“Digging activity detected; nesting unresolved.”** It does not establish egg deposition or a confirmed nest. Do not expose `examples/*/private` or `artifacts/private` through production endpoints.

Coordinate any shared JSON contract in a small versioned schema before wiring the two applications together. Keep their ports, environment variables, storage locations, and deployment pipelines separate. If a change affects both applications, test each one independently and include an integration check at the adapter boundary.

## Trails and people outputs

Seaward/humans simulator options are opt-in and are not registered experiments. Two further public outputs per run, written by blind scripts that read only public files: `tracks/tracks.json` (`schemas/tracks.v1.json`: `{schema, version, note, tracks: [{id, pin_id, points: [[t, x, y], ...]}]}`) and `people/people.json` (`schemas/people.v1.json`: `{schema, version, note, people: [{id, max_height_m, points: [[t, x, y], ...]}]}`). People detection reads RGB video, but it is separate from the digging detector: `scripts/people_detect.py` must not import `pipeline/detect.py`, and its output never feeds it. The dashboard may read these two files (and the `live-chunk.v1` fields that name them), never truth, seeds or the layout setting.

## Current experiment status

The simulator and detector are explicitly synthetic prototypes. `config/registration.json` and `config/frozen.json` document the original one-turtle validation at revision `f50d04c`; `config/stress-registration.json` documents the three-turtle result at `5ff15ae`. Their source hashes intentionally differ from the current larger simulator. `config/swarm-registration.json` separately registers paired six-turtle daylight and very-dark stress seeds. Keep all result sets distinct. The very-dark mode is visible-light noise, **not infrared**. See `README.md`, `RESULTS.md`, `STRESS_RESULTS.md`, and `SWARM_RESULTS.md` for measured limits.
