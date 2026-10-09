# NestTrace Dashboard: Simulation Feeds and Live Device Cameras

Date: 2026-10-09
Status: Design approved in brainstorming (sections 1–2), pending written-spec review
Builds on: `docs/superpowers/specs/2026-10-09-nesttrace-dashboard-design.md` and Plan 1 (branch `feat/dashboard-fullstack`, head `955d794`)

## 1. Intent

**Stated by the user**
- Bring in the new simulator from `origin/main` ("I just want the simulation part"); William's Vite nest log is not needed in the app now.
- Loop simulation footage on the dashboard cameras. Record new six-turtle runs. All online cameras get footage.
- Feed views: raw camera video, pure-motion clip, and a detection overlay.
- Connect an Android phone (or other own devices) as a camera through a browser page, over the same Wi-Fi, **live view only**, and let users pick which device feeds which camera.

**Assumed**
- Demo audience: hackathon judges. Success is that every online camera on the Night Watch map shows moving footage, digging pins appear in sync with the video, and a phone held up in the room appears live on a chosen camera within a few seconds.
- No model training. The detector and pin grouping stay the existing frozen, rule-based OpenCV pipeline.

**Boundaries (from `agent.md`)**
- The dashboard never imports simulator code, calls the research API, or reads `private/` files. Simulation footage enters only through an explicit import adapter that reads **public** run outputs and validates them against a versioned schema (`sim-import-v1`).
- Alert wording stays exactly `Digging activity detected; nesting unresolved.`; pins are inspection regions, never confirmed nests.
- Frozen experiment files and registered seeds are untouched. Demo recordings use fresh seeds that appear in no `config/*registration*.json`.

## 2. Part A: merge and simulation feeds

### 2.1 Merge
- Merge `origin/main` into `feat/dashboard-fullstack`.
- Conflicts under `dashboard/`: keep the Next.js app (ours). William's Vite nest-log files are dropped from the tree and remain in git history; the merge commit message says so.
- `agent.md` and root `README.md`: take `origin/main`'s simulator text (six-turtle beach, swarm scenarios, pins, results files); replace its dashboard description ("React/Vite application on port 5180", "sample data") with the Next.js/Compose description from our branch.
- After merging: root `npm test` (tsc + pytest) and `dashboard/web` vitest + tsc must pass; the dashboard boundary test must pass.

### 2.2 Recording demo runs (research side, repo root)
- Four runs, model A, with fresh seeds `901`, `907`, `911`, `919` (verified absent from every `config/*registration*.json` before recording):
  - `A-swarm-demo-901` (`swarm`) → zone pair A
  - `A-swarm-demo-907` (`swarm`) → zone pair B
  - `A-swarm-demo-911` (`swarm`) → zone pair C
  - `A-swarm-night-demo-919` (`swarm-night`) → zone pair D
- Commands per run: `node scripts/record.mjs --seed S --scenario SC --model A --id ID`, then `scripts/analyze.py ID --both --settings config/settings-swarm.json`, then pin grouping with `pipeline/pin_fuse.py` and `config/pin-registration.json`, writing `artifacts/public/ID/pins/predictions.json` exactly as `scripts/pin_batch.py` does.
- A small wrapper `scripts/demo_runs.py` (research side) runs the four, skips completed runs, and never writes into `config/` or `results/`.

### 2.3 Import adapter (`sim-import-v1`)
CLI in `dashboard/web`: `npm run sim:import -- --run <path to artifacts/public/RUN> --pair <A|B|C|D>`.

Input (public files only):
- `camera-0.mp4`, `camera-1.mp4`
- `view-0/pure-motion.mp4`, `view-1/pure-motion.mp4`
- `calibration-0.json`, `calibration-1.json` (for `ground_bounds`)
- `pins/predictions.json` (optional; absent → no alerts)
- `timestamps.json`, `analysis.json`

Validation:
- Refuse if the resolved `--run` path contains a `private` segment, or if any required file is missing.
- Validate the JSON shapes it reads with zod (`schema_version` 1 for pins; `methods.pins[]` items with `point [x,y]`, `interval [t0,t1]`, `score`, `evidence_tier`, `source_views`).
- Record the SHA-256 of every imported file in an `import-manifest.json` next to the copied media.

Output:
- Copies media to `/media/sim/<RUN>/` (MEDIA_ROOT).
- In one transaction, for the pair's two cameras (`<pair>1` ← camera-0, `<pair>2` ← camera-1): upsert one `Video` each with `source = SIMULATION`, `path`, `pureMotionPath`, `durationS`, `fps`, `width`, `height`, `simRunId`. Re-importing the same run replaces that run's rows (idempotent).
- One `Alert` per pin: `kind = DIGGING`, message exact, `score`, `startT`/`endT` from `interval`, `radiusM = 0.9`, `evidenceTier` (`TWO_CAMERA` | `SINGLE_CAMERA`), `simulated = true`, attached to camera `<pair>1`'s video, `status NEW`.
- Position mapping: the simulator's observed ground section (`ground_bounds`, metres, x along the beach, y inland) is placed **at true scale** centred on the zone's centroid and rotated to the zone's along-beach bearing; `(x, y)` metres → lng/lat via `destinationPoint`. Alerts are labelled "Simulated · approximate position" in the UI.

Schema changes (Prisma migration):
- `enum VideoSource { UPLOAD SIMULATION }`; `Video.source VideoSource @default(UPLOAD)`, `Video.pureMotionPath String?`, `Video.simRunId String?`.
- `Video.uploadedById` becomes optional (simulation imports have no uploader).
- `enum EvidenceTier { TWO_CAMERA SINGLE_CAMERA }`; `Alert.evidenceTier EvidenceTier?`, `Alert.simulated Boolean @default(false)`.
- `latestVideoId` rule (snapshot): newest video with a DONE job **or** `source = SIMULATION`.

### 2.4 Media streaming
- `GET /api/media/video/:videoId?variant=raw|motion`: requires a session; resolves the path from the DB (never from the request), serves with HTTP Range support (`206`), `Content-Type: video/mp4`, `Cache-Control: private`.

### 2.5 Dashboard UI
- Camera panel: if the camera has a video, a looping, muted, autoplaying `<video>`; header badge **SIMULATED**; **Raw / Motion** segmented toggle switches the `variant` while keeping `currentTime`.
- Playback clock: the selected camera's video time is published to `MapScreen` (requestAnimationFrame while playing).
- Detection overlay: map shows a pin for each alert of the selected camera's video only while `startT ≤ t ≤ endT` (with a 1 s fade); green = `TWO_CAMERA`, amber = `SINGLE_CAMERA`. The alerts feed highlights alerts whose window contains `t`, and shows "Simulated · approximate position".
- Alerts from all simulation videos also appear in the feed (not time-gated) so the count is meaningful.
- Cameras A1–D2 (except offline A2) have footage after the four imports.

## 3. Part B: live device cameras

### 3.1 Device page `/cam`
- Requires login (any role). Fields: device name (remembered in localStorage), camera facing (rear default), resolution 1280×720.
- Calls `getUserMedia({ video: { facingMode, width, height }, audio: false })`. Requests a Screen Wake Lock while streaming.
- Registers the device (`POST /api/live/devices` → `LiveDevice` row) and keeps a heartbeat every 5 s. Shows "Live · N viewers" and a Stop button.
- Errors shown in plain words: permission denied, no camera, insecure context (opened over http).

### 3.2 Choosing a source per camera
- `LiveDevice`: `id`, `name`, `ownerId`, `lastSeenAt`, `createdAt`. Online = `lastSeenAt` within 15 s.
- `Camera.liveDeviceId String? @unique` (one device feeds at most one camera).
- Camera panel **Source** dropdown: "Simulation loop" or any online device. Changing it is admin-only: a server action that re-reads the user's role from the DB and writes `AuditLog`.
- When a camera's device is online: red **LIVE** badge + device name, plays the WebRTC stream. When it goes offline: falls back to the simulation loop and shows "Device offline".
- **Connect device** button (admin) opens a dialog with a QR code for `https://${LAN_HOST}:3443/cam`.

### 3.3 Signalling and media
- WebRTC peer-to-peer over the LAN (host ICE candidates; no STUN/TURN). One `RTCPeerConnection` per viewer on the device; receive-only on the viewer.
- Signalling through the Next.js server, in memory (single `web` container):
  - `GET /api/live/events?role=device|viewer&device=<id>`: SSE stream of messages addressed to that peer.
  - `POST /api/live/signal`: `{ to, from, deviceId, type: 'join'|'offer'|'answer'|'ice'|'leave', payload }`, validated with zod; relayed only to the addressed peer of the same device; 64 KB limit.
  - Peer ids are random per connection; a peer's queue is dropped when its SSE stream closes; viewers are told `leave` when the device disconnects.
- Requires a session on both endpoints. Viewers may only join devices currently assigned to a camera.
- Caps: 4 viewers per device; the fifth gets "Too many viewers".

### 3.4 HTTPS on the LAN
- New Compose service `caddy` (`caddy:2`): `tls internal`, listens on `0.0.0.0:3443`, reverse-proxies to `web:3000`, passes SSE without buffering.
- `web` stays `127.0.0.1:3000`; `db` stays `127.0.0.1:5433`. Only 3443 is reachable from the LAN, and every page there requires login.
- Session cookies are `Secure` when the request arrives via HTTPS (`X-Forwarded-Proto: https`), regardless of `INSECURE_COOKIES`.
- Env: `LAN_HOST` (laptop LAN IP, e.g. from `ipconfig getifaddr en0`). README documents the one-time certificate warning on the phone (Advanced → Proceed).

## 4. Testing

Part A:
- Import adapter (vitest, temp dirs): refuses `private` paths and missing files; rejects malformed pins JSON; creates two Videos + N Alerts with exact message; re-import is idempotent; position mapping puts `(0,0)` at the zone centroid and `(+x)` along the beach bearing (unit test on the transform).
- Media route: 401 without session; Range request returns 206 with correct `Content-Range`; unknown id 404; path never taken from the request.
- UI (jsdom): Raw/Motion toggle switches source and keeps time; pins render only inside their window; SIMULATED badge.
- Research side: `pytest` still passes; `demo_runs.py` refuses seeds present in any registration file.
- End-to-end (Playwright): after importing pair B, B1 plays, toggle works, a pin appears on the map during its window.

Part B:
- Signalling relay (vitest): messages delivered only to the addressed peer of the same device; cross-device delivery rejected; queues cleaned on disconnect; viewer cap.
- Source assignment: viewer → 403; device already assigned elsewhere → rejected; offline device → camera falls back.
- Playwright with two contexts and Chrome fake media (`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`): device page streams, dashboard camera shows LIVE and receives frames (`video.videoWidth > 0`, `currentTime` advancing).
- Manual: real Android phone on the same Wi-Fi via QR code.

## 5. Delivery order
- Plan A: merge → recording wrapper + four runs → schema migration → media route → import adapter → UI feeds and overlay → docs.
- Plan B: Caddy HTTPS → LiveDevice model + device API → signalling relay → `/cam` page → viewer player + source dropdown + Connect dialog → docs.

## 6. Out of scope
Recording or analysing phone feeds, access outside the local network, TURN/relay servers, more than 4 viewers per device, porting William's nest log (noted for a later plan), model training.
