# Real dashboard workspace

This is the team’s NestTrace dashboard. It shows a live, continuously updated beach fed by the synthetic simulator, or fixed sample data when run on its own. The `web/` application is a separate synthetic research simulator and evidence viewer. Keep the dashboard as a separate application with its own package, runtime, tests, deployment, credentials, and real-data storage.

The dashboard reads simulator output only through the versioned live-chunk contract (`../schemas/live-chunk.v1.json`) and the adapter in `server/liveChunkAdapter.js`. It never depends on simulator objects, seeds, private evaluator truth, or the local research API. See the repository’s [`agent.md`](../agent.md) for the boundary and alert wording.

## Live demo: an endless synthetic night shift

Four processes, each in its own terminal, from the repository root:

```powershell
# 1. Simulator renderer (the recorder drives it in a headless browser)
npm run dev

# 2. Continuous simulator: records, analyzes, and publishes a six-turtle chunk about every 1.5-2 min
node scripts/live-runner.mjs

# 3. Dashboard backend on 127.0.0.1:5182 (drop ":demo" to turn the simulated patrol off;
#    set NESTTRACE_ACCESS_KEY first to also turn on the phone camera relay)
npm --prefix dashboard run server:demo

# 4. Dashboard UI on http://localhost:5180
npm --prefix dashboard run dev
```

The simulator's research API (`npm start`, port 5174) is not needed for the live demo.

What happens:

1. `scripts/live-runner.mjs` records 40 s chunks of six turtles crawling up, digging, and leaving, each on a fresh seed (registered experiment seeds are skipped) and a fresh beach, so older disturbances vanish from the simulation. Recording the next chunk overlaps with analysis of the previous one through the unchanged blind pipeline (extract → detect → two-camera pin grouping). When a chunk is complete it writes `artifacts/public/<chunk>/live-chunk.json` last. It keeps the newest 40 chunks (`--keep`).
2. The backend polls for new manifests every 3 s. Each chunk is assigned to the next zone (A → B → C → D → A…), so every camera pair gets footage. Each pin becomes a nest site: map position inside the zone, arrival and departure times, which cameras saw it, and an automatic **Unprotected** flag.
3. Connected dashboards get a live **alert** per new site ("Digging activity detected; nesting unresolved.") and a fresh snapshot. The selected pair's panel plays both cameras' latest clips.
4. Sites fade after 5 minutes and leave the live map after 20 minutes. Leaving is itself a logged "Faded from live map" entry, and the site stays under **Archived** in the Nest log.
5. With `server:demo`, a clearly labeled **Demo patrol (simulated)** answers each alert with a visit and then precautionary protection. It never confirms or rules out a nest, because it has no access to the simulator's truth. It stands down for any site a real patrol member has already visited. Real patrol updates entered in the dashboard go to the backend and are shared by every viewer.

The renderer is daylight. The very-dark mode currently places no pins (see `../SWARM_RESULTS.md`), so a literally dark night would never raise an alert. The `swarm-spread` layout used by the live runner is not a registered experiment; don't quote accuracy from it.

### Backend settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `NESTTRACE_DASHBOARD_API_PORT` | `5182` (or `PORT`) | Backend port |
| `NESTTRACE_DASHBOARD_HOST` | `127.0.0.1` | Address to listen on; `--lan` (`npm start`) listens on every interface |
| `NESTTRACE_DIST_DIR` | `dist/` | Built dashboard served for non-API paths |
| `TLS_CERT`, `TLS_KEY` | none | PEM paths to serve HTTPS directly |
| `NESTTRACE_PUBLIC_ARTIFACTS` | `../artifacts/public` | Where live chunks are read from |
| `NESTTRACE_DASHBOARD_DATA` | `server-data/` | Dashboard state and audit trail (git-ignored) |
| `NESTTRACE_FADE_START_MINUTES` | `5` | When a site starts fading |
| `NESTTRACE_ARCHIVE_AFTER_MINUTES` | `20` | When a site leaves the live map |
| `NESTTRACE_CAMERA_STALE_MINUTES` | `15` | When a pair with no new footage shows offline |
| `NESTTRACE_DEMO_PATROL` | off | `1` (or `--demo-patrol`) turns the simulated patrol on |

`server-data/state.json` is replaced atomically on every change. `server-data/audit.jsonl` gets one line per log entry and is only ever appended to. Delete the folder to start a fresh night.

## Sample mode

To run the UI without the backend, on made-up data:

```powershell
cd dashboard
$env:VITE_DATA_SOURCE = "sample"; npm run dev
```

Sample-mode patrol entries are saved in that browser's localStorage only.

## Nest log

The **Nest log** tab tracks every nest site in its own log: when activity arrived and left (camera entries), where the site is, and every patrol update. Each new site is flagged **Unprotected** automatically. The flag clears only when a patrol logs "Protection set up" (or "No nest found"). Statuses are always worked out from the log (`src/utils/nestStatus.js`, shared by the UI and the backend), and patrol entries are append-only.

Camera entries never confirm a nest. They use the required wording "Digging activity detected; nesting unresolved." Only a patrol entry can mark a nest as confirmed. Sites seen by only one camera of the pair are tagged **One camera** and get a dashed pin: review the clips before acting on them.

## Live cameras (phones as cameras)

Any phone with a browser can be a beach camera, no app needed. The phone
opens `/camera`, picks a camera position (A1–D2), and sends JPEG frames
to the camera relay (`server/cameraRelay.js`), which the dashboard backend
mounts next to the live feed: one process, one port (5182). The **Cameras**
tab shows every position, with a live feed for each one that is sending.

- Every camera is also recorded to disk (see **Recordings** below). The
  server never runs the detector.
- Everyone needs the team access key (`NESTTRACE_ACCESS_KEY`, at least 12
  characters) to send or watch. It is remembered in each device's
  localStorage. Without it the backend still runs the live feed and nest
  log, but the camera routes answer 503.
- Phone browsers only allow the camera on **HTTPS** pages.
- Phone cameras are not linked to nest sites yet: the map, the app bar's
  camera count and the nest log come from the live simulator feed (or
  sample data).

### Motion view

`/motion?camera=B1` shows one camera's live feed next to its motion
difference (also linked as **Motion view** under each live tile). The
difference is worked out in the browser from the live frames: **Against
background** compares with a slowly updated picture of the scene, so
something that stops moving fades out over a few seconds; **Since last
frame** shows only what changed between frames. The threshold slider sets
how big a brightness change counts as motion. This is a viewing aid, not
the detector, and it does not affect recording.

### Try it on your local network

```powershell
cd dashboard
$env:NESTTRACE_ACCESS_KEY = 'pick-a-long-secret'
npm run server         # backend + camera relay on 127.0.0.1:5182 (terminal 1)
npm run dev:phone      # dashboard over self-signed HTTPS (terminal 2)
```

On the phone (same Wi-Fi), open `https://<your PC's IP>:5180/camera`, accept
the certificate warning, enter the key, and tap **Start camera**. Watch on
`https://localhost:5180` → **Cameras**. The phone only talks to Vite, which
forwards `/api` to the backend, so the backend can stay on loopback. Allow
Node through Windows Firewall if the phone can't connect.

### Deploy

One Node process serves the built dashboard, the live feed, the nest log
and the relay:

```powershell
npm run build
$env:NESTTRACE_ACCESS_KEY = 'pick-a-long-secret'
npm start              # every interface, port 5182; phone page at /camera
```

Or use the `Dockerfile` (`docker build -t nesttrace-dashboard .`). Put it
behind HTTPS: a host such as Render, Fly.io or Railway, a reverse proxy
like Caddy, or a Cloudflare tunnel. To serve HTTPS directly, set `TLS_CERT`
and `TLS_KEY` to PEM file paths. Run a single instance, since frames live
in that process's memory.

### Recordings

The server records every camera that is sending, in 10-minute video files
under `dashboard/recordings/<camera>/<date>/` (git-ignored). The Cameras tab
lists them with **Play** and **Download**; a **REC** badge marks cameras
being recorded.

- Video runs at a fixed 5 frames per second on the real clock: if a phone
  sends fewer frames, the last one is repeated, so one video second is one
  real second. A gap over 10 seconds starts a new file instead.
- Each video has a `.json` file next to it with the camera, the real start
  time, the frame rate and the frame count.
- Files are MJPEG `.avi`, which OpenCV reads. If
  [ffmpeg](https://ffmpeg.org/download.html) is installed
  (`winget install Gyan.FFmpeg`), finished files are converted to H.264
  `.mp4`: much smaller and playable in the browser. Leftover `.avi` files
  are converted the next time the server starts.
- Recordings older than 72 hours are deleted automatically.
- Stop the server with Ctrl+C so it can finish the open files.

| Variable | Default | Meaning |
| --- | --- | --- |
| `NESTTRACE_ACCESS_KEY` | none | Team key for the camera relay; relay off without it |
| `NESTTRACE_RECORDING` | on | `off` disables recording |
| `NESTTRACE_RECORDINGS_DIR` | `dashboard/recordings` | Where videos are saved |
| `NESTTRACE_RECORDING_FPS` | `5` | Frames per second in recordings |
| `NESTTRACE_SEGMENT_MINUTES` | `10` | Length of each video file |
| `NESTTRACE_RETENTION_HOURS` | `72` | Delete recordings older than this |
| `FFMPEG_PATH` | `ffmpeg` | ffmpeg to use for .mp4 conversion |

Storage: without ffmpeg, roughly 1–1.5 GB per camera per hour at the Standard
phone setting; with ffmpeg,
roughly a tenth of that. The Docker image includes ffmpeg; mount a volume
at `/app/recordings` to keep footage across restarts.

Recordings are real footage of a nesting beach: keep them off public
storage. Feeding them to the detector still needs the reviewed adapter and
per-camera calibration described in [`agent.md`](../agent.md).

## Tests

```powershell
npm --prefix dashboard test
```

The tests cover the adapter contract (including manifests that try to point at private files), map placement, the store's logging, fading, archiving and persistence, the demo patrol, and an integration check that runs the real backend against a fixture chunk built from real pipeline output.
