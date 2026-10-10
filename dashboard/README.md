# NestTrace dashboard

Monitoring app for sea turtle crawl and digging activity on the Holiday Beach stretch of Port Aransas. It is separate from the research simulator in the repository root and never reads simulator state, the research API, or private evaluator truth (see `../agent.md`).

## Run

Requires Docker Desktop (running) and, for development outside Docker, Node 24.

```bash
cd dashboard
cp .env.example .env            # then set AUTH_SECRET (openssl rand -base64 32), SEED_ADMIN_PASSWORD and optionally SEED_VIEWER_PASSWORD
docker compose up --build
```

Open http://localhost:3000 and sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. The first start creates zones A–D, cameras A1–D2 and a read-only `viewer@nesttrace.local` account. Under Docker the viewer password is never printed: set `SEED_VIEWER_PASSWORD` in `.env` before the first start and it is used when the viewer is created (an existing viewer is never overwritten). To set or change it later, put the new value in `SEED_VIEWER_PASSWORD` and run `npm run db:reset-viewer` from `web/` (it updates the dev database named by `DATABASE_URL` and refuses if the variable is unset). The app refuses to start with `change-me` placeholder secrets.

The Compose file binds web (3000) and Postgres (5433) to 127.0.0.1 and sets `INSECURE_COOKIES=1` so the session cookie works over plain HTTP on localhost. For the network, Caddy serves HTTPS on :3443 and the session cookie is marked Secure on each HTTPS request; web and Postgres stay on loopback, so only Caddy is reachable from the LAN.

## Develop

```bash
docker compose up -d db          # Postgres on localhost:5433
cd web && cp ../.env .env && npm install
npx prisma migrate dev           # apply migrations, generate client
npm run db:seed
npm run dev                      # http://localhost:3000
npm run db:test:prepare          # creates and migrates the nesttrace_test database named by TEST_DATABASE_URL
npm test                         # unit + integration + boundary (needs the db container)
npx vitest run tests/unit/geo.test.ts   # one file
```

## Simulation feeds

Camera feeds loop footage recorded by the research simulator and imported through the `sim-import-v1` adapter. The adapter reads only a run's public outputs and refuses `private/` paths.

```bash
# repo root: record the four demo runs (needs `npm run dev` on port 5173)
.venv/bin/python scripts/demo_runs.py
# dashboard/web: import one run per zone pair
npm run sim:import -- --run ../../artifacts/public/A-swarm-demo-901 --pair A
npm run sim:import -- --run ../../artifacts/public/A-swarm-demo-907 --pair B
npm run sim:import -- --run ../../artifacts/public/A-swarm-demo-911 --pair C
npm run sim:import -- --run ../../artifacts/public/A-swarm-night-demo-919 --pair D
```

If Playwright's bundled browser is missing, `scripts/demo_runs.py` needs `NESTTRACE_BROWSER` pointing at a Chrome binary, for example `export NESTTRACE_BROWSER="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.

Media lands in `dashboard/media/` (git-ignored, bind-mounted into the container). Pins are placed at true scale around each zone's centre and labelled "Simulated · approximate position"; they mark digging activity for inspection, never a confirmed nest.

## 24-hour live feed

The root simulator can run as a continuous beach feed. In one terminal at the repo root run `npm run dev` (Vite on 127.0.0.1:5173), and in another run `node scripts/live-runner.mjs` (add `--chunks 2` to stop after two chunks; on macOS set `NESTTRACE_BROWSER` if Playwright's browser is missing). The runner records six-turtle chunks, runs the blind pipeline on each and writes `artifacts/public/live-<n>-<id>/live-chunk.json` last, so a chunk is either complete or invisible.

The dashboard never talks to the runner. Compose mounts `artifacts/public` read-only at `/sim-public`, and a watcher inside the web container polls for `live-*/live-chunk.json` every 3 seconds. It reads only public files named by the `live-chunk.v1` schema (`schemas/live-chunk.v1.json`) and copies the chunk's media to `MEDIA_ROOT/live/<chunk_id>/`. It never reads `private/`, seeds, scenario names or truth. New pins and alerts reach open browsers without a reload. Each chunk's cameras map onto the dashboard zones in rotation: a manifest camera at `x_min` becomes the zone's `1` camera (north end) and `x_max` the `2` camera.

Timings (all server side):

- A site fades on the map 5 minutes after detection while nobody has logged an entry on it (`LIVE_FADE_MINUTES`). Any person entry keeps it at full strength.
- 20 minutes after detection it moves to Inactive as archived (`LIVE_ARCHIVE_MINUTES`), unless a person has logged any entry on it, in which case it stays until the person closes it with an outcome.
- Media of the newest 40 chunks is kept (`LIVE_KEEP`). Older media is pruned but the database rows stay, and the UI falls back to the status card.

Environment variables: `LIVE_FEED` (`1` starts the watcher; Compose always sets `1` for the web container, and a host `npm run dev` leaves it off unless you start it with `LIVE_FEED=1`, after stopping Compose web, because two watchers on one database would race), `LIVE_ROOT` (`/sim-public` in Compose, `../../artifacts/public` outside Docker), `LIVE_FADE_MINUTES`, `LIVE_ARCHIVE_MINUTES`, `LIVE_KEEP`.

## People and roles

There are three roles, each including the one before: viewer, volunteer, admin.

- Viewer: view-only. Sees the map, feeds, alerts, site logs and analytics.
- Volunteer: also adds site log entries (patrol visited, protection set up, nest confirmed, no nest found, hatched, lost, note).
- Admin: also manages users, cameras and zones.

Every request checks the database-backed role, so a role change or a disabled account takes effect on the next request. Admins manage people on the Users page: create an account with a role and an initial password, change a role, reset a password, or disable an account. Disable is how to cut a person off immediately: a password reset does not end sessions that already exist, while a disabled user is treated as signed out on their next request. Admins cannot change their own role or disable themselves.

## Nest lifecycle and statistics

Detector alerts always read "Digging activity detected; nesting unresolved." Only a person can record that a nest was found. Site events: `detected` and `departed` (from the footage), `archived` (system, when a site reaches the archive time with nobody logging anything), and person entries `patrolVisit`, `protectionInstalled`, `nestConfirmed`, `noNestFound`, `hatched`, `lost` and `note`. `hatched` requires an earlier `nestConfirmed` on the same site; the server rejects it otherwise.

A nest site is **secured** once someone logs protection on it or resolves a danger (on the site or any of its danger alerts); a newer danger clears that until it is resolved again. Active secured sites get a soft green 20 m circle on the map (with a Secured tag when zoomed in), and the site drawer names who secured it and when.

Active sites are open ones still on the live map. Inactive sites have an outcome (hatched or lost), a no-nest finding, or were archived.

Saved and not saved, shown on Analytics ("Everything logged"):

- Saved: the site was logged as hatched, with or without logged protection.
- Not saved: logged as lost, archived while unprotected with no person entry, or a danger with no protection logged within 30 minutes of the first danger. Resolving the danger alone does not count as protection.
- Pending: everything else, including sites still open and sites archived after protection was logged.

Pre-log sites (created before the site log existed) get a `detected` entry automatically when the container starts (the seed step runs `backfillSiteEvents`; `npm run db:backfill-site-events` does the same by hand). It is safe to run repeatedly.
- No-nest sites are excluded from all three.

## Trails and danger alerts

Imported runs and live chunks may carry `tracks/tracks.json` and `people/people.json` (see `schemas/`). The map draws each turtle trail in its own colour from the camera feed's current time, so trails grow as the footage plays. Trails and positions are blind and approximate.

A person track that passes within 3 m of an open nest site raises a Level 1 danger on that site: a red chip in the top bar, a red pin and a grouped card in the feed ("Person on the beach near N sites", with a Resolve button per site and Resolve all). Detection is one danger per site per 60 seconds. Volunteers and admins resolve a danger (resolving one site resolves that group's other open dangers on the same site; person log entries resolve it too); viewers see no resolve controls. An open danger on a site that is already closed is shown on the site. A site becomes Not saved when no protection is logged within 30 minutes of its first danger; resolving the danger alone does not count (Analytics shows open danger alerts as a tile). Dangers on live chunks appear only for chunks imported after this change.

Seaward runs (`--layout seaward`, see the root README) record footage facing the ocean. After importing one onto a pair, use Setup > Cameras > "Face ocean" for that pair so its headings match (the pair turns about 20 degrees toward each other).

## Editing cameras

Admins click the pencil on the map to enter edit mode. Esc or Done leaves edit mode. A click inside a zone or within 150 m of its outline adds a camera pair to that zone, facing the sea. A click farther than 150 m from every zone creates a new zone there (next free letter: E, F, …): a 120 m × 60 m rectangle with its land edge centred on the click, lined up with the nearest zone, and cameras `<code>1`/`<code>2` 40 m apart on that edge facing the sea; it is refused if the rectangle would overlap a zone. Drag a camera to move it; a move the server refuses snaps back. Zones made on the map show a grip and × on their tag in edit mode: drag the tag to move the zone with its cameras, or delete a zone that has no footage, alerts or live chunks. The seeded zones A–D cannot be moved or deleted. Setup > Cameras lists every pair: edit latitude, longitude, heading, view, range and status, add a pair to a chosen zone or as a new zone at typed coordinates, delete a camera, or use Face ocean to turn a pair toward the sea. Merging a zone into its nearest neighbour is only offered for zones added on the map; the merged cameras keep their footage and sit just outside the receiving zone's outline. Volunteers and viewers do not see the edit button.

Open a camera to see its feed. The expand button shows it large (Escape closes it) and the left edge of the camera panel can be dragged, or moved with the arrow keys, to resize it; the width is remembered in the browser.

## Live phone cameras

Signed-in volunteers and admins can turn a phone on the same Wi-Fi into a live camera.

1. Set `LAN_HOST` in `dashboard/.env` to the laptop's LAN IP (`ipconfig getifaddr en0`), not `localhost` or `127.0.0.1`, then run `docker compose up -d --build`. Caddy serves `https://localhost:3443` and `https://LAN_HOST:3443`; port 3443 is the only port open to the LAN (`web` and `db` stay on loopback).
2. Admins open **Live cameras > Connect phone** and scan the QR code. On the phone, accept the one-time certificate warning (it is Caddy's own CA; to remove it, run `docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt .` and install that file on the phone), sign in as a volunteer or admin, and press Start.
3. The **Live cameras** page shows one tile per online phone, with Expand and a **Motion view**. The motion view is a viewing aid, not the digging detector. Admins link a phone to a camera with the **Source** picker (Setup > Cameras, or the camera panel on the map); the panel then shows LIVE, and falls back to "Phone offline" and the simulation loop when the phone stops. Admins can **Remove** a phone: that stops this phone, but the person can start again with a new phone name; to block a person, disable their account on the Users page.
4. Recording: every phone is recorded as 10-minute mp4 segments (5 fps) under `RECORDINGS_ROOT` (`./recordings`, git-ignored; Compose mounts it at `/recordings`). Segments are deleted after `RECORDING_RETENTION_HOURS` (default 72, swept hourly). `RECORDING=off` turns recording off, and `FFMPEG_PATH` overrides the `ffmpeg` binary (the web image includes ffmpeg; without it segments stay as `.avi`). Admins see the Recordings list on **Live cameras** with Play and Download; a new recording can take up to about 45 s to appear and be playable.
5. Limits: one `web` instance holds the newest frames in memory, about 6 phones at once, no audio, LAN only. Phone footage is real beach footage: it stays on local disk, is never committed, and never reaches the digging detector.

## ESP32 camera boards

An ESP32-S3 camera board (`firmware/esp32s3-cam`) can send its picture to the dashboard like a phone.

1. An admin opens **Live cameras > Add board camera** and names the board. The dialog shows the device id and a token **once**, as `secrets.h` lines with `DASHBOARD_URL` from `LAN_HOST`. Only a SHA-256 hash of the token is stored. **Rotate token** in the Devices list issues a new one (the old one stops working), and **Remove** stops the board. All three are audited (`device.create`, `device.rotate`, `device.remove`) without the token.
2. In `firmware/esp32s3-cam/secrets.h`, replace the existing `DASHBOARD_URL`, `DEVICE_ID` and `DEVICE_TOKEN` lines with the ones shown, paste Caddy's root certificate (`docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt`) into the existing `DASHBOARD_CA` block, and upload the firmware (see `firmware/esp32s3-cam/README.md`).
3. The board POSTs JPEGs to `/api/live/frame/<id>` with `Authorization: Bearer <token>` and the `X-NestTrace-Motion` header (`schemas/esp32-frame.v1.md`), at most 5 per second. It then behaves like a phone: tile, Motion view, recording, Source linking.
4. Board tiles show **Moving x%** / **Still** and the motion box, labelled "Motion measured on the camera board". It is a viewing aid: no alerts, never reaches the digging detector. The badge refreshes with the device list (about every 3 s).
5. Board, laptop and phones must share one 2.4 GHz-capable network. `LAN_HOST` must be the laptop's address on it.

## Live detection

The `worker` service looks at live phone and board pictures and draws boxes on them.

1. What it does: it finds **people** (YOLOX-nano, Apache-2.0, score at least 0.40) and **possible turtles**. A possible turtle comes from a rule (a slow, wide moving shape), never from a turtle model, and it is never a confirmed turtle; it has no score. Each box has a track id (`P1`, `T1`, ...) and a trail of the last 30 s. The **Detections** button on **Live cameras** turns boxes, counts and trails on or off, and each browser remembers the choice. The map's camera panel shows the same boxes for a linked live camera. It is a viewing aid: it can miss people and mistake objects.
2. Setup: put `WORKER_TOKEN=$(openssl rand -hex 32)` in `dashboard/.env` (run the `openssl` command and paste its output), then `docker compose up -d --build`. The `worker` image downloads the model once at build time and checks its SHA-256; the build fails on a mismatch. At runtime the worker is on an internal-only network (no internet, no published port). `/api/internal/*` is for the worker only: Caddy answers 404 to the LAN, and the routes refuse any request without the token. Without `WORKER_TOKEN` the worker exits and tiles say "Detection off".
3. Restarts: Compose restarts the worker with `restart: on-failure:3`. After three crashes in a row (for example, `WORKER_TOKEN` unset) it stays down. Fix the cause, then run `docker compose up -d worker` (or `docker compose restart worker`). `docker compose ps` and `docker compose logs worker` show its state; the logs carry status codes and error class names only, never frames or the token.
4. Camera alert: when a person is seen for 2 s (score at least 0.50) on a phone or board **linked to a map camera**, and that camera's zone has an active unprotected nest site, a red level-1 card appears first in the Active list, labelled **"Camera alert · person detected (not measured distance)"**, with the message "Danger · person seen on camera `<code>` near active nest sites — check now". The top-bar danger chip counts it and the map shows a pulsing marker at the camera. There is one per camera until a volunteer or admin resolves it (**Resolve danger**), and the next one comes at least 10 minutes after the resolve. Repeat sightings are logged on it at most once a minute. It is not tied to one nest, does not change any site's Saved/Not saved status, is not counted in outcomes, and is not a measured distance. Devices that are not linked to a map camera never raise one.
5. Deleting: a camera alert stays attached to its camera and zone after it is resolved, so, like other alerts, it blocks deleting that camera or zone. A zone added on the map can still be merged into a neighbour (its alerts move with it).
6. Limits: CPU only, at most 2 frames/s per device, about 6 devices. Below 25/255 mean brightness the tile says "Too dark to detect"; night or infrared detection is out of scope. Boxes refresh about every second and can lag the picture by up to about 1.5 s. The worker keeps frames and results in memory only; it never writes them to disk.
7. Worker tests on the host (Python 3.12):

   ```bash
   cd dashboard/worker && python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
   mkdir -p models && curl -fsSL -o models/yolox_nano.onnx https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx
   echo "c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d  models/yolox_nano.onnx" | shasum -a 256 -c -
   .venv/bin/pytest -q
   ```

   `models/` and `.venv/` are git-ignored. Inside the image: `docker compose run --rm --no-deps worker python -m pytest -q`.

## Limits

Map imagery comes from Esri World Imagery and needs internet; without it the map shows zones and cameras on a dark background. Zone and camera positions were converted from the earlier map image and are accurate to roughly ±20 m. Alerts never confirm a nest; only a person in the field can mark an alert field-confirmed.
