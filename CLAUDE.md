# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read `agent.md` before changing anything. It is the authoritative boundary document; this file summarizes it plus the commands.

## Two separate applications

1. **Synthetic research experiment** (repo root: `web/`, `pipeline/`, `scripts/`, `config/`). TypeScript/Vite/Three.js simulator renders two synchronized camera videos of a particle-sand beach; Python/OpenCV extracts motion signals and runs a blind detector.
2. **Real dashboard** (`dashboard/`). Docker Compose app: Next.js 16 in `dashboard/web` (port 3000), Postgres 16 (host port 5433), Python worker in `dashboard/worker` (Plan 2). Design spec and plans in `docs/superpowers/`.

Never import across them. The dashboard must not depend on the simulator, the local research API (`scripts/server.mjs`), seeds, or anything under `*/private`. Any shared JSON contract needs a small versioned schema first. When a change touches both apps, test each independently.

Alert wording must stay exactly: **"Digging activity detected; nesting unresolved."** Never call an alert a confirmed nest; scores are not probabilities.

## Commands

Root (research app). Requires Node 22+, Python 3.10+, Chrome/Edge or Playwright Chromium. On macOS use `.venv/bin/python`.

```sh
npm install
python -m venv .venv && .venv/bin/python -m pip install -r requirements.txt
npm run dev          # Vite UI on 127.0.0.1:5173
npm start            # local research API (scripts/server.mjs) on 5174, loopback only
npm test             # tsc --noEmit, then pytest tests -q (via scripts/test.mjs)
npm run build        # tsc --noEmit && vite build
node scripts/browser-check.mjs   # needs both servers running and a completed A-clean-11 run
```

Single test: `.venv/bin/python -m pytest tests/test_pipeline.py::test_maximum_cardinality_matching -q`

Experiment flow (keep Vite running):

```sh
python scripts/install-example.py                     # copy examples/A-clean-11 into artifacts/
node scripts/record.mjs --seed 11 --scenario clean --model A
.venv/bin/python scripts/analyze.py A-clean-11 [--both] [--no-evaluate]
.venv/bin/python scripts/batch.py --split development --reuse   # splits: development|validation|test|demonstrations; --model A|B
```

Live feed: with `npm run dev` running, `node scripts/live-runner.mjs [--chunks N]` writes `artifacts/public/live-*/live-chunk.json`; the dashboard watcher (enabled by `LIVE_FEED=1`, Compose default, read-only mount of `artifacts/public`) picks them up. Dashboard: `cd dashboard && docker compose up --build` (http://localhost:3000). Dev: `docker compose up -d db`, then in `dashboard/web`: `npm run dev`, `npm run db:test:prepare` (once, before `npm test`; integration tests use `TEST_DATABASE_URL`), `npm test`, single file `npx vitest run tests/unit/geo.test.ts`. Simulation feeds: repo root .venv/bin/python scripts/demo_runs.py, then in dashboard/web npm run sim:import -- --run ../../artifacts/public/<run> --pair <zone letter> (any zone with <letter>1/<letter>2 cameras).

Seaward layout and walkers (opt-in; not registered experiments): `node scripts/record.mjs ... --layout seaward --humans 2` or `node scripts/live-runner.mjs --layout seaward --humans 2`. Blind post-steps: `.venv/bin/python scripts/track_paths.py <run>` (tracks) and `.venv/bin/python scripts/people_detect.py <run>` (people), run by `demo_runs.py` and the live runner; schemas in `schemas/tracks.v1.json` and `schemas/people.v1.json`. Demo runs `A-seaward-humans-demo-929/937` and `A-seaward-demo-941` import with `npm run sim:import`; then use Setup > Cameras > Face ocean on that pair.

Phone cameras (dashboard): set `LAN_HOST` (the laptop's LAN IP) in `dashboard/.env`, run `docker compose up -d --build`, then open `https://<LAN_HOST>:3443/cam` on a phone (VOLUNTEER/ADMIN) and watch on `/live`. Recordings go to `dashboard/recordings/` (git-ignored, never staged). Host dev `npm run dev` also records there (as `.avi` without ffmpeg). ESP32-S3 camera firmware is in `firmware/esp32s3-cam/README.md`.

ESP32 board: on `/live` an admin uses Add board camera, pastes the shown `secrets.h` lines plus Caddy's root certificate into `firmware/esp32s3-cam/secrets.h` (git-ignored, never staged), and compiles with the arduino-cli command in the firmware README. The board pushes frames with a bearer device token and the `esp32-frame.v1` motion header (`schemas/esp32-frame.v1.md`).

## Pipeline architecture and detector isolation

`scripts/analyze.py` orchestrates per camera view, each step a separate subprocess:

1. `pipeline/extract.py`: the only stage that sees RGB. Reads `artifacts/public/<run>/camera-N.mp4` + public calibration, writes `view-N/signals.npz` (background/motion/timestamps/valid), Pure-motion video, `motion-map.png`, metadata.
2. `pipeline/detect.py`: run in a fresh temp staging dir containing only `detect.py`, `common.py`, `signals.npz`, `calibration.json`, `settings.json`. Writes `predictions.json` for all four methods (frozen reference, delayed motion, blob tracker, combined evidence) and an `input-manifest.json` of input hashes. **Do not add imports from `web/`, simulator state, or private files to `detect.py`**; a test (`test_detector_rejects_hidden_fields`) guards this.
3. `pipeline/evaluate.py`: post-inference only, compares predictions to `artifacts/private/<run>/truth.json` using `config/registration.json`.

`pipeline/common.py` holds shared helpers (`read_json`, `write_json`, `sha`). Generated data goes in ignored `artifacts/public|private|reports|qa`; `examples/A-clean-11` is the one versioned demo. The API serves only public artifacts; truth requires the explicit `/api/truth/` reveal after inference.

Simulator: `web/simulation.ts` (scene/turtles/cameras), `web/sand.ts` (~42k-grain particle bed; sand model A = radial flipper throws, B = tangential raking), `web/main.ts` (operator UI), `web/record.ts`/`record.html` (headless recording driven by `scripts/record.mjs`). Visible effects must be independent of the hidden egg flag; render-invariance is checked.

## Frozen experiment rules

- `config/registration.json`: seed splits and the geometric success rule (0.90 m radius, 3.016 m² max region, ≥1 s temporal overlap, one-to-one matching; Gate A = ≥8/10 sites with ≤0.2 false alerts/run).
- `config/settings.json`: detector settings. `config/frozen.json`: source and settings hashes frozen by `scripts/freeze.py` before reserved validation.
- Never tune detector settings or simulator behavior against validation/test results. Changes to frozen sources or settings invalidate the freeze; substantial revisions need newly registered validation seeds and must preserve prior results.
- README references `RESULTS.md` for measured results; it is not currently in the repo.
