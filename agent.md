# NestTrace repository guide

This repository has two separate products with different data and trust boundaries.

## Real dashboard (future team-owned application)

Place the real monitoring dashboard under `dashboard/`. It will own real camera integrations, users, access control, persistent records, and production deployment. Give it its own dependency manifest, build output, configuration, tests, and runtime port. Do not make production behavior depend on a running simulator, the local research API, synthetic seed configuration, or evaluator truth.

The real dashboard does not exist yet. `dashboard/README.md` reserves its location and documents the handoff. Do not describe the current simulation UI as the real dashboard.

## Synthetic experiment (current application)

`web/` is the Vite/Three.js simulation and research UI. `web/sand.ts` is the particle bed. `pipeline/` contains video extraction, blind detection, and post-inference evaluation. `scripts/server.mjs` serves the local research UI on port 5174; Vite serves it on port 5173. `config/` contains the registered experimental rules and frozen settings. Generated run data belongs in ignored `artifacts/`; `examples/` holds one versioned demonstration.

Keep simulation-only data—seeds, turtle state, scenario names, sand particle state, hidden eggs, and evaluator truth—out of the detector and out of future real-dashboard ingestion. The detector receives only saved-video difference signals, timestamps, public calibration, and frozen settings in a separate process. Do not add runtime imports from `web/` or private evaluator files to `pipeline/detect.py`.

## Integration boundary

The dashboard team may later create an explicit adapter for reviewed outputs: `predictions.json`, public camera calibration, video evidence, and `motion-map.png`. Treat the motion map as an approximate ground projection. Keep the existing alert wording: **“Digging activity detected; nesting unresolved.”** It does not establish egg deposition or a confirmed nest. Do not expose `examples/*/private` or `artifacts/private` through production endpoints.

Coordinate any shared JSON contract in a small versioned schema before wiring the two applications together. Keep their ports, environment variables, storage locations, and deployment pipelines separate. If a change affects both applications, test each one independently and include an integration check at the adapter boundary.

## Current experiment status

The simulator and detector are an explicitly synthetic daylight prototype. `config/registration.json` defines the seed splits and geometric success rule. `config/frozen.json` records the source and settings hashes used for reserved validation. Do not tune detector settings or simulator behavior against those reserved results; substantial experimental changes need new registered seeds. See `README.md` and `RESULTS.md` for execution and measured limits.
