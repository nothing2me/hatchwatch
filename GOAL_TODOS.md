# Active goal: reliable day and night site alerts

Target: reach at least 99% precision and recall for day and night on a declared, repeatable set of runs. Keep registered experiments frozen and report synthetic and real footage separately.

## Live demo and camera health

- [x] Find why Camera A2 was shown offline and correct existing database status.
- [x] Restore the live alert path end to end: detector publishing and dashboard import, including the 32-candidate contract.
- [x] Spread more turtles across the full beach in the live simulation with seeded random spacing.
- [ ] Measure precision, recall, duplicate pins, location error, and alert latency across multiple new daylight seeds and negative controls; tune until the target is met.
- [ ] Repeat the same declared stress suite for the night setup, including low-light visibility and camera availability.
- [ ] Check that the continuous runner keeps publishing and the dashboard keeps importing after restarts and media retention.

## Map and workflow

- [x] Keep site pins visible during playback; make them clickable for site actions and Google Maps coordinates.
- [x] Open zone details and historical playback from a zone right-click.
- [x] Simplify the map legend.
- [x] Add multi-select activity filters and scrolling after roughly four cards in the sites panel.
- [ ] Visually verify those interactions in the running dashboard at desktop and narrow widths.

## Historical analytics

- [x] Replace the approximate “Everything logged” view with a database-backed historical sheet and time-window selector.
- [ ] Verify history counts and window boundaries against the running database, including empty windows and service restarts.

---

## Handoff notes — continue on another machine

Last pushed state (both `main` and `codex/photoreal-beach`): verify `git rev-parse --short HEAD` matches the log tip. All builds green at that tip: root 34 tests, dashboard 51 files / 417 tests, python 26 tests.

### Standing gates (do not claim past these)

- **Fresh registration before any accuracy claim on the new scene.** The photoreal scene and the wide live demo (`settings-live-dev.json`, 320×160 grid, 78×25 m footprint, 18 turtles) are a different video distribution than the registered pin experiment (59/60, pre-photoreal scene). Detector recall on the current scene is an unknown — recent dev measurements were negative (dev stress 0/5 daylight, night 0/6, live corpus ≈3 pins/40 chunks).
- **NIR is a proxy.** `swarm-nir` / `nir-travel` render monochrome with a brightness/contrast pass to model an 850 nm illuminator; Three.js has no wavelength-dependent materials. Real-IR footage is required before any field claim. Keep visible-light and IR results labelled separately.
- **Masks change the distribution.** Per-camera watch masks (admin-edited `artifacts/public/camera-masks.json`) narrow the motion-signal grid; any mask change also invalidates registered results.
- **Field-readiness gates** (housing sealing/thermal, anchoring pull-tests, permits, IR hardware) are reference designs only until tested.

### Open checklist (from earlier in this file + above)

1. Day and night precision/recall + duplicates + location error + alert latency on fresh dev seeds and negative controls — tune until the goal target is met.
2. Night stress suite (low-light visibility, camera availability) and runner resilience (restarts, retention, watchdog, heartbeat).
3. Visual verification of map/site interactions and the historical analytics sheet against the running DB (empty windows, restarts).
4. Fresh synthetic registration on the current scene, then real-IR field footage.

### Setting up on a new machine

- `dashboard/.env` and `dashboard/web/.env` are local (gitignored): copy `dashboard/.env.example`, set `AUTH_SECRET` (≥32 chars, `openssl rand -base64 48`), `SEED_ADMIN_PASSWORD`, and point `DATABASE_URL`/`TEST_DATABASE_URL` at the local Postgres.
- DB: this project's journal used **PostgreSQL 16 inside WSL Ubuntu on 127.0.0.1:5433** (Docker Desktop was broken). Start it with `wsl -d Ubuntu -u root -- pg_ctlcluster 16 main start`. Windows-only quirk: the WSL localhost relay binds lazily and can drop mid-run — keep a long-lived `wsl -d Ubuntu -- sleep 3600` session running while the dashboard/tests run, and connect via `127.0.0.1` (avoid `localhost`, which resolves to `::1`).
- Apply migrations before serving: from `dashboard/web` → `node node_modules/prisma/build/index.js migrate deploy` and `npm run db:seed`.
- Launch: `npm run dev` (simulator 5173), `node scripts/live-runner.mjs` (continuous feed, from repo root, Vite must be serving), and from `dashboard/web` → `npm run dev` (dashboard 3000; set `LIVE_FEED=1` only for one watcher).
- The sim requires a Chrome/Edge binary for recording (`NESTTRACE_BROWSER` if Playwright's is missing) and hardware WebGL (Direct3D 11 on Windows).
- Do not commit `artifacts/`, `.venv/`, `node_modules/`, or `dashboard/.env*`; housing STL previews and sim screenshots live under `artifacts/` only.
