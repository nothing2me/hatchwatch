# NestTrace repository guide

This repository has two separate products with different data and trust boundaries.

## Real dashboard (team-owned application)

The real monitoring dashboard lives under `dashboard/` as a separate React/Vite application on port 5180. Its backend (`dashboard/server`, port 5182) feeds it from the synthetic live runner through the adapter below; `VITE_DATA_SOURCE=sample` runs it on made-up data alone. As the team adds real camera integrations, users, access control, persistent records, and production deployment, keep its dependency manifest, build output, configuration, tests, and runtime separate. Do not make production behavior depend on a running simulator, the local research API, synthetic seed configuration, or evaluator truth.

`dashboard/README.md` documents the dashboard scaffold and its independent launch. The current simulation UI is a separate research tool.

## Synthetic experiment (current application)

`web/` is the Vite/Three.js simulation and research UI. `web/sand.ts` is the particle bed. `pipeline/` contains video extraction, blind detection, and post-inference evaluation. `scripts/server.mjs` serves the local research UI on port 5174; Vite serves it on port 5173. `config/` contains the registered experimental rules and frozen settings. Generated run data belongs in ignored `artifacts/`; `examples/` holds one versioned demonstration.

Keep simulation-only data—seeds, turtle state, scenario names, sand particle state, hidden eggs, and evaluator truth—out of the detector and out of future real-dashboard ingestion. The detector receives only saved-video difference signals, timestamps, public calibration, and frozen settings in a separate process. Do not add runtime imports from `web/` or private evaluator files to `pipeline/detect.py`.

## Integration boundary

The dashboard team may later create an explicit adapter for reviewed outputs: `predictions.json`, public camera calibration, video evidence, and `motion-map.png`. Treat the motion map as an approximate ground projection. Keep the existing alert wording: **“Digging activity detected; nesting unresolved.”** It does not establish egg deposition or a confirmed nest. Do not expose `examples/*/private` or `artifacts/private` through production endpoints.

The live demo uses exactly one such contract: `schemas/live-chunk.v1.json`. `scripts/live-runner.mjs` (simulation side) publishes a `live-chunk.json` manifest per chunk in `artifacts/public/<chunk>/`, and `dashboard/server/liveChunkAdapter.js` (dashboard side) reads only that manifest, `pins/predictions.json`, and the two camera videos, under fixed file names. The runner never runs evaluation and skips registered seeds; its `swarm-spread` layout is unregistered and not a source of reportable results.

Coordinate any shared JSON contract in a small versioned schema before wiring the two applications together. Keep their ports, environment variables, storage locations, and deployment pipelines separate. If a change affects both applications, test each one independently and include an integration check at the adapter boundary.

## Current experiment status

The simulator and detector are explicitly synthetic prototypes. `config/registration.json` and `config/frozen.json` document the original one-turtle validation at revision `f50d04c`; `config/stress-registration.json` documents the three-turtle result at `5ff15ae`. Their source hashes intentionally differ from the current larger simulator. `config/swarm-registration.json` separately registers paired six-turtle daylight and very-dark stress seeds. Keep all result sets distinct. The very-dark mode is visible-light noise, **not infrared**. See `README.md`, `RESULTS.md`, `STRESS_RESULTS.md`, and `SWARM_RESULTS.md` for measured limits.
