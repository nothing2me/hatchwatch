# Real dashboard workspace

This is the team’s real NestTrace dashboard scaffold. It currently uses sample data; live camera integration is still to be added. The current `web/` application is a synthetic research simulator and evidence viewer. Keep the dashboard as a separate application with its own package, runtime, tests, deployment, credentials, and real-data storage.

The dashboard can later consume a reviewed, versioned adapter for prediction JSON, public calibration, evidence videos, and projected motion maps. It must not depend on simulator objects, seeds, private evaluator truth, or the local research API. See the repository’s [`agent.md`](../agent.md) for the boundary and alert wording.

## Running the dashboard

This is a standalone React + Vite app with its own `package.json`; it does not
use the root package or the research simulator. Requires Node 18+.

```powershell
cd dashboard
npm install
npm run dev
```

Open **http://localhost:5180**. All numbers are sample data from
`src/data/sampleData.js`. The UI reads data only through `subscribe()` on a
data source (`src/data/dataSource.js`), so the future pipeline adapter can be
swapped in by changing one line in `src/App.jsx`.

## Nest log

The **Nest log** tab tracks every nest site in its own log: when activity
arrived and left (camera entries), where the site is, and every patrol
update. Each new site is flagged **Unprotected** automatically; the flag
clears only when a patrol logs "Protection set up" (or "No nest found").
Statuses are always worked out from the log (`src/utils/nestStatus.js`),
and patrol entries are append-only.

Camera entries never confirm a nest. They use the required wording
"Digging activity detected; nesting unresolved." Only a patrol entry can
mark a nest as confirmed.

Patrol entries are currently saved in the browser's localStorage
(`src/data/nestLogStore.js`), so each browser keeps its own copy. Replace
that store with a backend that has the same `subscribe` / `addPatrolEntry`
methods so all patrols share one log.

## Live cameras (phones as cameras)

Any phone with a browser can be a beach camera, no app needed. The phone
opens `/camera`, picks a camera position (A1–D2), and sends JPEG frames
to the camera relay in `server/server.mjs`. The **Cameras** tab shows every
position, with a live feed for each one that is sending.

- Every camera is also recorded to disk (see **Recordings** below). The
  server never runs the detector.
- Everyone needs the team access key (`NESTTRACE_ACCESS_KEY`) to send or
  watch. It is remembered in each device's localStorage.
- Phone browsers only allow the camera on **HTTPS** pages.
- The map, the app bar's camera count, and the nest log still use sample data.

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
npm start              # camera relay on port 5182 (terminal 1)
npm run dev:phone      # dashboard over self-signed HTTPS (terminal 2)
```

On the phone (same Wi-Fi), open `https://<your PC's IP>:5180/camera`, accept
the certificate warning, enter the key, and tap **Start camera**. Watch on
`https://localhost:5180` → **Cameras**. Allow Node through Windows Firewall
if the phone can't connect.

### Deploy

One Node process serves the built dashboard and the relay:

```powershell
npm run build
$env:NESTTRACE_ACCESS_KEY = 'pick-a-long-secret'
npm start              # http://localhost:5182, phone page at /camera
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
