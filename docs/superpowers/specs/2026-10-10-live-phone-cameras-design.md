# NestTrace Dashboard: Live Phone Cameras

Date: 2026-10-10
Status: Design approved in chat ("Port into our app", "local Wi-Fi only", "yes"). Pending written-spec review.
Builds on: branch `feat/dashboard-fullstack` (head `20ae632`).
Reference (read only, not merged): `origin/live-phone-cameras` (elpaelpa, `3981767`, `4b313f1`), built on main's old Vite dashboard: phone sender page, JPEG frame relay with polling, live tiles, browser motion view, server-side recording.

## 1. Intent

**Stated by the user**
- Bring the phone-camera work from the other branch into our dashboard as a **menu in the top bar**.
- Port it into our Next.js app (not run the teammate's relay as a second app).
- Phones reach the dashboard over **local Wi-Fi only**.

**Decisions**
- Transport is the teammate's: JPEG frames posted by the phone, newest frame kept in memory, viewers poll. Chosen over WebRTC because it is simpler, passes through an HTTPS proxy unchanged, and lets the server record.
- Phones sign in with a normal account (VOLUNTEER or ADMIN) instead of a shared access key.
- An admin can link a phone to any map camera; that camera then shows the phone's live picture.

**Boundaries (from `agent.md`)**
- No simulator, research API, seeds or `private/` paths. Live phone frames and recordings never reach the detector (a reviewed adapter and per-camera calibration are needed first; out of scope).
- Recordings are real footage of a nesting beach: kept on local disk, git-ignored, never published.
- The teammate's files are a reference only; nothing is merged or cherry-picked from that branch. The commit that introduces the ported feature credits elpaelpa's commits in its message. Commits carry only the user as author.

## 2. Navigation and pages

- Top bar: `Map · Analytics · Live cameras · Setup · Users` (Setup/Users stay admin-only). Live cameras is visible to every role.
- **`/live`** (all roles): a grid of tiles, one per **online** phone. Each tile: live picture, device name, owner, linked map camera (if any), red **REC** badge while recording, buttons **Motion view** and **Expand** (large overlay, Escape closes). Empty state explains how to connect a phone. Admins also see **Connect phone** (QR code + URL) and the **Recordings** list (§5).
- **`/live/motion?device=<id>`** (all roles): live picture beside its motion picture, computed in the browser on a canvas: mode **Against background** (running average updated slowly, so still objects fade within a few seconds) or **Since last frame**; a threshold slider (brightness change that counts as motion). A viewing aid only, labelled as such.
- **`/cam`** (VOLUNTEER or ADMIN; a VIEWER sees "Your account can watch but not send"): device name (remembered in localStorage), camera facing (rear default), quality (Standard 960×540 q0.7 / High 1280×720 q0.8), Start/Stop. While sending: preview, frames-per-second sent, "Live · linked to <camera>" or "Live · not linked yet". Requests a Screen Wake Lock. Plain-word errors: camera permission denied, no camera, page not on HTTPS, signed out, server refused a frame.

## 3. Frames

- `LiveDevice` table: `id` (cuid), `name`, `ownerId` → User, `lastSeenAt`, `createdAt`, `disabledAt?`. The phone registers once per Start (`POST /api/live/devices` `{ name }` → `{ id }`; reuses the caller's device of the same name).
- `POST /api/live/frame/<deviceId>`: body `image/jpeg`, ≤ 500 KB; session required; caller must own the device (or be ADMIN); rate cap 10 frames/s per device (excess → 429). Stores `{ jpeg, at }` in an in-memory map in the `web` process (one instance, documented) and updates `lastSeenAt` at most once per 5 s.
- `GET /api/live/frame/<deviceId>`: session required (any role); returns the newest JPEG with `Cache-Control: no-store` and `X-Frame-At`; `If-None-Match`/ETag on the frame time so unchanged frames return 304; 404 when no frame in the last 10 s.
- **Online** = a frame received within the last 10 s. `GET /api/live/devices` lists online devices (and, for admins, all devices) for `/live` and the Source picker; `/live` polls it every 3 s.
- Clients poll frames at ~5 Hz into an `<img>` (object-URL swap, previous URL revoked).

## 4. Linking phones to map cameras (admin)

- `Camera.liveDeviceId String? @unique` (a phone feeds at most one camera).
- **Source** select on the Setup → Cameras row and in the map camera panel (admin only): "Simulation loop" or any device. Server action re-reads the role from the DB (`requireCurrentUser('ADMIN')`), writes `AuditLog` (`camera.source`), publishes a change.
- Map camera panel: when the linked device is online, shows the live picture with a red **LIVE** badge and the device name (Raw only; Motion toggle opens the motion view); otherwise the simulation loop as today, with "Phone offline" when a device is linked but silent. Disabling a user or deleting a device unlinks it.

## 5. Recording

- The `web` process records each online device: JPEG frames written as MJPEG into an AVI segment at a fixed 5 fps on the real clock (last frame repeated to fill gaps; a gap over 10 s closes the segment); a new file every 10 min. Sidecar JSON: device id/name, linked camera code at start, real start time, fps, frame count.
- On close, `ffmpeg` (added to the Docker image) converts to H.264 `.mp4` and deletes the `.avi`; leftover `.avi` files are converted at start-up. Without ffmpeg the `.avi` stays.
- Path: `RECORDINGS_ROOT` (Compose bind mount `./recordings` → `/recordings`, git-ignored), layout `<deviceId>/<YYYY-MM-DD>/<HHMMSS>.mp4`. Files older than `RECORDING_RETENTION_HOURS` (72) are deleted hourly. `RECORDING=off` disables recording.
- Admin **Recordings** list on `/live`: device, camera, start, length, size, **Play** (in-page player) and **Download**, served by `GET /api/live/recordings/<path>` (ADMIN, path validated inside `RECORDINGS_ROOT`, Range support).

## 6. HTTPS on the local network

- New Compose service `caddy` (`caddy:2`): `tls internal`, listens on `0.0.0.0:3443`, reverse-proxies to `web:3000`, `flush_interval -1` so SSE is not buffered, request body limit 1 MB.
- `web` stays `127.0.0.1:3000`, `db` stays `127.0.0.1:5433`. Only 3443 is reachable from the LAN; every page and API there requires login.
- Session cookies are `Secure` when the request arrives over HTTPS (`X-Forwarded-Proto: https` from Caddy).
- `LAN_HOST` env (laptop IP, e.g. `ipconfig getifaddr en0`) builds the **Connect phone** URL/QR (`https://${LAN_HOST}:3443/cam`). README explains the one-time certificate warning on the phone.

## 7. Testing

- Unit: frame store (newest wins, 10 s offline, size and rate caps), motion-difference maths (both modes, threshold), recorder segmenting (fps fill, 10 s gap, 10 min roll) with a fake clock and fake writer, path validation.
- Integration (test DB): device register/reuse, frame POST auth (owner/admin, VIEWER 403, signed out 401, oversize 413, rate 429), GET 304/404, Source link/unlink audited and admin-only, unique link, unlink on user disable/device delete, recordings route admin-only and path-safe.
- UI: top-bar item, `/live` empty state and tiles, map camera panel LIVE/offline fallback, `/cam` role gate and error messages.
- End-to-end (Playwright, scratchpad): Chrome with `--use-fake-device-for-media-stream` as the phone through `https://localhost:3443/cam`, tile appears on `/live`, link to E1, map panel shows LIVE, motion view moves, a recording file appears and plays. Then a real phone check by the user.

## 8. Out of scope

Audio, internet exposure, more than ~6 simultaneous phones, multiple `web` instances, running the detector on phone footage, phone calibration.
