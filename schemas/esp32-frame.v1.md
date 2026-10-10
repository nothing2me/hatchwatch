# esp32-frame.v1

Shared contract between `firmware/esp32s3-cam` (sender) and the NestTrace dashboard (receiver, `POST /api/live/frame/<deviceId>`). Version 1, 2026-10-10.

## Request

| Part | Value |
| --- | --- |
| Method, path | `POST /api/live/frame/<deviceId>` on `https://<LAN_HOST>:3443` (Caddy, internal CA) |
| `Authorization` | `Bearer <token>`: the 43-character base64url token shown once by **Live cameras > Add board camera** or **Rotate token** |
| `Content-Type` | `image/jpeg` |
| Body | one JPEG (starts `FF D8`), at most 500 KB |
| `X-NestTrace-Motion` | optional, see below |

## `X-NestTrace-Motion`

```
v1;percent=<P>;active=<A>;box=<x>,<y>,<w>,<h>
```

- `P`: share of the picture moving, 0.0 to 100.0, always exactly one decimal (`4.2`, `0.0`, `100.0`).
- `A`: `1` when the board counts the picture as moving, else `0`.
- `x,y,w,h`: box around the moving cells in picture pixels of the JPEG sent (unsigned integers, at most 65535); `0,0,0,0` when nothing moves.
- Fields appear in exactly this order, with no spaces. The whole value is at most 160 characters.
- A receiver ignores a malformed value or any version other than `v1`; the frame is still accepted. Later versions use a new leading token (`v2;...`) and a new file `schemas/esp32-frame.v2.md`.

Example: `X-NestTrace-Motion: v1;percent=4.2;active=1;box=96,40,64,72`

## Responses the board acts on

| Status | Meaning | Board does |
| --- | --- | --- |
| 200 | stored (`{ at, cameraCode, recording }`) | next frame |
| 401, 403 | token not accepted (wrong, rotated, removed, other device) | stops sending, logs `Dashboard refused the token` |
| 413, 415 | frame too large or not JPEG | backs off |
| 429 | more than 10 frames a second | waits 1 s |
| 5xx, network or TLS error | dashboard unreachable | backs off 2 s, doubling to 30 s |

## Meaning

On-board motion is a viewing aid. It raises no alerts and never reaches the digging detector. Board frames are real beach footage: recorded locally like phone frames and never committed.
