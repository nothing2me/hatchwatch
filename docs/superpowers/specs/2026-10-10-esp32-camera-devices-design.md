# NestTrace Dashboard: ESP32 Cameras as Live Devices

Date: 2026-10-10
Status: Approach A approved in chat ("yes"). Pending written-spec review.
Builds on: branch `feat/dashboard-fullstack` (Plan E live phone cameras, head `5774050`), firmware `firmware/esp32s3-cam`.

## 1. Intent

**Stated by the user:** add the ESP32-S3 camera "as a device on the dashboard too, under Live cameras".

**Decisions**
- The board **pushes** frames to the existing phone frame route (approach A). The dashboard never connects out to devices.
- A board authenticates with a **device token** instead of a user session. Everything after authentication is the phone path unchanged: frame store, `/live` tile, motion view, recording, linking to a map camera, Remove.
- The board's on-device motion result travels with each frame in a small versioned header and is shown on the tile.

**Boundaries (from `agent.md`)**
- No simulator, research API or `private/` paths. Board frames never reach the digging detector. On-device motion is a viewing aid: it raises no alerts.
- Board footage is real beach footage: same local-only recording and retention as phones.
- The header is a shared contract between the firmware and the dashboard, so it gets a versioned schema file first (`schemas/esp32-frame.v1.md`).

## 2. Device tokens (dashboard)

- `LiveDevice` gains `kind` (`PHONE` default | `BOARD`) and `tokenHash String?` (SHA-256 of the token, hex; unique). Phones never have a token.
- **Add board camera** (admin only, on Live cameras): a name → a `BOARD` device owned by the admin, plus a random 32-byte token (base64url) shown **once** with the device id and a ready-to-paste `secrets.h` block. Audited (`device.create`).
- **Rotate token** and **Remove** (existing) on the admin Phones list, now "Devices". Rotate replaces the hash and shows the new token once (audited). Remove sets `disabledAt` and calls `frameStore.forget`, as for phones.
- `POST /api/live/frame/<id>` accepts either the existing session rules **or** `Authorization: Bearer <token>` where SHA-256(token) matches that device's `tokenHash` (constant-time compare), the device is a `BOARD` and not removed. A token is valid only for its own device id. Wrong or missing token on a `BOARD` → 401. All other frame rules unchanged (500 KB, 10 frames/s, JPEG only).
- Tokens never appear in logs, audit details, snapshots or `/api/live/devices`.

## 3. Motion header (contract `esp32-frame.v1`)

- Request header `X-NestTrace-Motion: v1;percent=<0-100, 1 decimal>;active=<0|1>;box=<x>,<y>,<w>,<h>` (box in picture pixels; `0,0,0,0` when none).
- Optional; malformed or unknown versions are ignored (the frame is still accepted).
- Stored beside the newest frame in the frame store (memory only) and returned by `GET /api/live/devices` as `motion: { percent, active, box, at }` for board devices.
- The `/live` tile shows a "Moving 4.2%" / "Still" badge for board devices, and the box over the picture when active. Labelled "Motion measured on the camera board".

## 4. Firmware

- `secrets.h` gains `DASHBOARD_URL` (e.g. `https://10.47.138.152:3443`), `DEVICE_ID`, `DEVICE_TOKEN`, and `DASHBOARD_CA` (the Caddy local root certificate, PEM). If `DASHBOARD_URL` is empty, upload is off and the board works standalone as today.
- A `dashboard_uplink` task (core 0, low priority) takes each new JPEG from the capture task (sequence-based, at most 5 frames/s), POSTs it over HTTPS with the bearer token and the motion header, reusing one TLS connection (keep-alive). On 401/403 it stops and logs "Dashboard refused the token"; on network errors it backs off 2 s → 30 s; 429 waits 1 s.
- TLS verifies the dashboard with `DASHBOARD_CA` (no insecure mode). The README shows how to copy Caddy's root certificate: `docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt`.
- `/status` gains `uplink: { state, sent, lastError }`; the camera page shows it.

## 5. Network

- `LAN_HOST` in `dashboard/.env` is set to the laptop's current address on the shared Wi-Fi (now `10.47.138.152` on "San"); Caddy's certificate covers it. README notes that the board, phones and laptop must share one 2.4 GHz-capable network.

## 6. Testing

- Dashboard unit/integration: token create (shown once, hash stored, audit has no token), bearer accepted for its own board, rejected for another device / a phone / removed board / wrong token (401), constant-time compare used, rotate invalidates the old token, motion header parse (valid, malformed ignored, unknown version ignored), devices API exposes motion and never the token, admin-only create/rotate.
- Firmware: compile; on the real board, frames appear as a tile on `/live`, motion badge follows hand movement, linking to E1 shows LIVE on the map, recording converts, wrong token logs the refusal.
- End-to-end (Playwright): a scripted fake board (Node, same headers and token) posts frames through `https://localhost:3443`.

## 7. Out of scope

Dashboard pulling from devices, object detection (separate design), audio, more than one stream viewer on the board, OTA firmware updates.
