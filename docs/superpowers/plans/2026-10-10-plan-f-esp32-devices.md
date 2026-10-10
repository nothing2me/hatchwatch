# NestTrace Dashboard — Plan F: ESP32 Cameras as Live Devices — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Freenove ESP32-S3 camera board shows up under **Live cameras** like a phone. An admin adds a **board camera** on `/live` and gets a device id and a token, shown once, as a ready-to-paste `secrets.h` block. The board pushes its newest JPEG with that token and its on-board motion result to the existing frame route over verified HTTPS. From there it uses the phone path unchanged: tile, motion view, recording, linking to a map camera, and Remove. The tile shows a "Moving 4.2%" / "Still" badge and the motion box.

**Architecture:** Plan E's frame route `POST /api/live/frame/<id>` gains a second way in: `Authorization: Bearer <token>`. The token is checked against `LiveDevice.tokenHash` (SHA-256 hex, constant-time compare), only for a `BOARD` row with that same id that is not removed. Everything after authentication is the phone code: `readCapped`, `isJpeg`, `FrameStore.put`, `touchDevice`, `Recorder.addFrame`. The optional `X-NestTrace-Motion` header (contract `esp32-frame.v1`, written first as `schemas/esp32-frame.v1.md`) is parsed by a pure function. It is stored beside the newest frame in the in-memory `FrameStore` and returned by `GET /api/live/devices` as `motion` for boards. Create and rotate are admin server actions in `src/app/(app)/live/actions.ts` over a small `src/lib/phones/boards.ts`. Both are audited and never write the token anywhere but the one action result. On the board, a new `uplink` task (core 0, low priority, stack in PSRAM) reads frames from the capture task by sequence number. It POSTs at most 5 per second through one keep-alive `NetworkClientSecure` + `HTTPClient` connection that verifies the dashboard against `DASHBOARD_CA`. mbedTLS is pointed at PSRAM at boot (`mbedtls_platform_set_calloc_free`) because only about 21 KB of internal RAM is free.

**Tech Stack:** Next.js 16.4.0 App Router, React 19.3.0, TypeScript 5.9.3, Tailwind v4, Prisma 7.10.0 + Postgres 16, zod 4.6.5, Vitest 5.0.3, `node:crypto` (`randomBytes`, `createHash`, `timingSafeEqual`), Playwright from the repo-root `node_modules/playwright` for the end-to-end check. Firmware: Arduino-ESP32 core 3.3.12 (ESP-IDF 5.5, mbedTLS 3.6.6), `NetworkClientSecure`, `HTTPClient`, FreeRTOS `xTaskCreatePinnedToCoreWithCaps`. No new npm packages.

**Spec:** `docs/superpowers/specs/2026-10-10-esp32-camera-devices-design.md` (binding). Boundaries: `agent.md`, `CLAUDE.md`. Builds on Plan E (`docs/superpowers/plans/2026-10-10-plan-e-live-phone-cameras.md`) and the firmware at `firmware/esp32s3-cam` (HEAD `651412a`).

## Global Constraints

- **Device tokens:** 32 random bytes, **base64url** (43 characters, no padding), created with `randomBytes(32)`. The token is **shown once**, in the action result of **Add board camera** or **Rotate token**, and never again. The database stores only `tokenHash` = **SHA-256 of the token, lower-case hex, unique**. The check hashes the presented token and compares it with **`crypto.timingSafeEqual`** (constant time), and it runs even when the device id is unknown. Phones never have a token (database CHECK).
- **Who may send what:** `POST /api/live/frame/<id>` accepts either the existing session rules (unchanged for phones) **or** `Authorization: Bearer <token>`. A bearer token is valid **only for its own device id**, only when that device is a **`BOARD`**, and only when the board is not removed (`disabledAt` null). Wrong token, malformed token, a token on a phone, a token on another board, or a removed board → **401**. A `BOARD` reached without a bearer token → **401**, even with an admin session. All other frame rules are **unchanged**: body `image/jpeg` (415 otherwise), **≤ 500 KB** (413, checked while streaming), **≤ 10 frames/s per device** (429), and the newest frame in memory in the one `web` process.
- **Motion header (contract `esp32-frame.v1`):** request header exactly `X-NestTrace-Motion: v1;percent=<0-100, 1 decimal>;active=<0|1>;box=<x>,<y>,<w>,<h>`. The box is in picture pixels and is `0,0,0,0` when nothing moves. The header is optional. A **malformed value or an unknown version is ignored** and the frame is still accepted. It is read only on the bearer (board) path. It is stored beside the newest frame (memory only) and returned by `GET /api/live/devices` as `motion: { percent, active, box, at }` for board devices (`null` for phones and for boards without a valid reading).
- **Secrecy:** tokens never appear in logs, `AuditLog.details`, the map snapshot, `GET /api/live/devices`, page props, or the firmware console. `tokenHash` is read and written only in `src/lib/phones/{deviceToken,devices,boards}.ts`, and none of those files logs. Caddy stays without an access `log` directive.
- **Admin only, audited:** **Add board camera** (`device.create`, details `{ name, kind: 'BOARD' }`) and **Rotate token** (`device.rotate`, details `{ name }`). Both go through `requireCurrentUser('ADMIN')` (role re-read from the DB). **Remove** stays the existing `removePhone` (`device.remove`, `disabledAt`, `frameStore.forget`).
- **On-device motion is a viewing aid:** it raises no alerts, never reaches the digging detector, and is labelled "Motion measured on the camera board". Board frames are real beach footage, with the same local-only recording and 72 h retention as phones.
- **Firmware uplink:** off when `DASHBOARD_URL` is empty (the board works standalone). It sends at most **5 frames/s**, sequence-based, newest frame only. It reuses **one TLS connection** (keep-alive). Network or TLS errors and 5xx back off **2 s → 4 → 8 → 16 → 30 s** (cap 30 s, reset on success). **429** waits **1 s**. **401/403** stop the uplink and log `Dashboard refused the token`. TLS **verifies the dashboard with `DASHBOARD_CA`**. There is **no insecure mode**: no `setInsecure()`, no `http://` URLs, no fallback that skips verification.
- **Network:** `LAN_HOST = 10.47.138.152` (laptop on the "San" hotspot). `dashboard/.env` is local, git-ignored and never committed. The board, phones and laptop share one 2.4 GHz-capable network.
- **Boundary:** nothing under `dashboard/` imports or references the simulator (`web/`), the research API (`scripts/server.mjs`), seeds, `pipeline/`, or any `private/` path. Frozen research files (`pipeline/*`, `config/*`, `results/*`, `*RESULTS.md`) are untouched. The firmware never talks to the research pipeline.
- **Alert wording unchanged:** `Digging activity detected; nesting unresolved.`
- **Commits:** only the user as author; **no `Co-Authored-By` and no AI attribution** in any message. Stage **explicit paths** only. **Never stage** `artifacts/`, `dashboard/media/`, `dashboard/recordings/`, `.superpowers/`, any `.env`, or `firmware/**/secrets.h`.
- **Code style:** follow the existing files: Allman braces, 4-space indent, single quotes, `@/` imports, one-line comments only where the reason is not obvious. The firmware uses the same brace style, `CONSOLE(...)` for logs, and anonymous namespaces.

## Review Focus

1. **The frame route lets a token open the wrong door.** Examples: a board's token accepted on another board or on a phone; a removed board still sending; a board reached with only an admin session; a token compared with `===` or a crash when the stored hash has another length. Pinned in **Task 1** `tests/integration/live-phones.test.ts` (`board frames` block: the full 401 matrix) and `tests/unit/deviceToken.test.ts` (`timingSafeEqual` is called for every comparison, including malformed input).
2. **A token leaks after it was shown.** Examples: in `AuditLog.details`, in `GET /api/live/devices`, in a `select`-less Prisma include that carries `tokenHash` into the snapshot, or in a `console.*` line. Pinned in **Task 1** `tests/unit/token-boundary.test.ts` (only three files may name `tokenHash`, and none logs) and the devices-API assertion in `live-phones.test.ts`, and in **Task 2** `tests/integration/board-devices.test.ts` (audit rows contain neither token nor hash).
3. **The motion header drops frames or accepts junk.** Examples: a malformed or `v2` header causing 400/500 instead of being ignored, `percent=101.0`, a negative or 6-digit box, or a phone's header shown as board motion. Pinned in **Task 1** `tests/unit/motionHeader.test.ts` and the `board frames` motion cases in `live-phones.test.ts`.
4. **Rotate or Add leaves an old token working, or shows a token twice.** Pinned in **Task 2** `tests/integration/board-devices.test.ts` (old token 401 and new token 200 after rotate; admin-only; rotate refused for phones and removed boards) and **Task 3** `tests/unit/liveScreen.test.tsx` (the token is gone after the dialog closes).
5. **The board tile misdraws motion.** Examples: the box drawn in CSS pixels instead of picture pixels, drawn when still, or the badge shown on phone tiles. Pinned in **Task 3** `tests/unit/liveScreen.test.tsx` (`MotionBox` viewBox and rect, badge text, no badge on phones).

## Risks and the choices they leave to the user

- **TLS memory on the board (the main risk).** At runtime only about **21 KB of internal RAM** is free. The raw QVGA frame buffer (150 KB) must stay in internal DMA RAM, and Wi-Fi takes most of the rest. The prebuilt Arduino core sets `CONFIG_MBEDTLS_INTERNAL_MEM_ALLOC=y` with `CONFIG_MBEDTLS_SSL_MAX_CONTENT_LEN=16384`. A TLS session therefore wants about **40 KB of internal RAM** (two 16 KB record buffers plus handshake state), which does not fit. The plan handles it in four layers:
  1. **Default (built in, Task 4):** at the top of `setup()`, before Wi-Fi or any TLS, `uplink::useTlsMemoryInPsram()` calls `mbedtls_platform_set_calloc_free()`. The core's `esp_config.h` defines `MBEDTLS_PLATFORM_MEMORY` without the `CALLOC_MACRO`s, and `libmbedcrypto.a` exports `mbedtls_platform_set_calloc_free`, so this works on the prebuilt core. The replacement allocates from PSRAM (`heap_caps_calloc(..., MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT)`) and falls back to internal RAM. The free function is `heap_caps_free`, which frees blocks from either heap, so blocks allocated before the switch are still freed correctly. This is what ESP-IDF's own `CONFIG_MBEDTLS_EXTERNAL_MEM_ALLOC` does. The uplink task's 12 KB stack is also in PSRAM (`xTaskCreatePinnedToCoreWithCaps(..., MALLOC_CAP_SPIRAM)`; the core has `CONFIG_SPIRAM_ALLOW_STACK_EXTERNAL_MEMORY=y`; the task never touches flash).
  2. **Check before connecting:** before each new TLS connection the task reads `heap_caps_get_free_size(MALLOC_CAP_INTERNAL)`. Under **12 KB** (sockets and lwIP still use internal RAM), it does not try. It sets state `no-memory` and `lastError` `only N B internal RAM free`, logs it, and backs off.
  3. **Clear reporting:** a failed handshake records `NetworkClientSecure::lastError()` text (for example `SSL - Memory allocation failed`) in `/status` `uplink.lastError`, on the camera page, and on the Serial Monitor.
  4. **Fallbacks the user can choose (documented in `firmware/esp32s3-cam/README.md`, never automatic):**
     - **A. Smaller raw picture:** remove `FRAMESIZE_QVGA` from `RAW_SIZES` in `camera.cpp`. The raw buffer drops from 150 KB to 84 KB (HQVGA 240×176), which frees about 66 KB of internal RAM at the cost of a smaller picture.
     - **B. Stay standalone:** leave `DASHBOARD_URL` empty and use a phone as the live camera on the dashboard.
     There is **no** insecure fallback: the spec forbids it, and `setInsecure()` must not appear in the firmware (Task 4 Step 6 greps for it).
- **Certificate for an IP address:** Caddy's internal CA issues the `LAN_HOST` certificate with an IP SAN. mbedTLS 3.6.6 in the core matches IP SANs (`mbedtls_x509_crt_parse_cn_inet_pton` is present). The core has `CONFIG_MBEDTLS_HAVE_TIME_DATE` off, so the board does not need the time for verification. If `caddy_data` is recreated, the CA changes and the board reports a verification error until the new root certificate is pasted (README).
- **Badge latency:** the spec puts motion on `GET /api/live/devices`, which `/live` polls every 3 s, so the badge and box lag hand movement by up to about 3 s. This plan keeps the spec's channel and does not add a motion header to `GET frame`.

---

## File Structure

```
schemas/esp32-frame.v1.md                              T1  versioned header contract (firmware ↔ dashboard)
dashboard/
  README.md                                            T5  "ESP32 camera boards" section
  web/
    prisma/schema.prisma (+ migration board_devices)   T1  DeviceKind enum, LiveDevice.kind, LiveDevice.tokenHash (unique), CHECK
    src/lib/types.ts                                   T1  LiveDeviceKind, BoardMotionView, LiveDeviceView.kind/.motion
    src/lib/phones/deviceToken.ts                      T1  newDeviceToken, hashDeviceToken, tokenMatches, bearerToken
    src/lib/phones/motionHeader.ts                     T1  MOTION_HEADER, parseMotionHeader
    src/lib/phones/frameStore.ts                       T1  BoardMotion stored beside the newest frame; motion()
    src/lib/phones/devices.ts                          T1  registerDevice PHONE-only, frameAccess 401 for boards, boardAccess, listDevices kind/motion
    src/lib/phones/http.ts                             T1  postFrame: bearer path + motion header
    src/lib/phones/boards.ts                           T2  createBoard, rotateBoardToken (audited)
    src/lib/phones/connect.ts                          T2  dashboardOrigin(LAN_HOST)
    src/lib/phones/boardSecrets.ts                     T2  boardSecretsBlock (the secrets.h lines)
    src/app/(app)/live/actions.ts                      T2  addBoardCamera, rotateDeviceToken
    src/features/phones/BoardToken.tsx                 T3  AddBoardDialog, IssuedTokenDialog
    src/features/phones/LiveScreen.tsx                 T3  Add board camera button, Devices list (kind, Rotate token), board tile badge + MotionBox
    tests/unit/deviceToken.test.ts                     T1
    tests/unit/motionHeader.test.ts                    T1
    tests/unit/frameStore.test.ts                      T1  motion cases
    tests/unit/token-boundary.test.ts                  T1
    tests/integration/live-phones.test.ts              T1  board frames block
    tests/unit/boardSecrets.test.ts                    T2
    tests/unit/connect.test.ts                         T2  dashboardOrigin
    tests/integration/board-devices.test.ts            T2
    tests/unit/liveScreen.test.tsx                     T1 fixtures; T3 board UI
    tests/unit/sourceSelect.test.tsx                   T1 fixtures
firmware/esp32s3-cam/
  uplink.h, uplink.cpp                                 T4  PSRAM TLS memory, uplink task, motion header, status
  esp32s3-cam.ino                                      T4  useTlsMemoryInPsram first; uplink::begin after first IP
  web_server.cpp                                       T4  /status uplink object
  web_page.h                                           T4  Dashboard row on the camera page
  secrets.example.h                                    T4  DASHBOARD_URL, DEVICE_ID, DEVICE_TOKEN, DASHBOARD_CA
  README.md                                            T4  "Send to the dashboard", CA copy command, memory fallbacks
  secrets.h                                            T4/T5 local only, git-ignored, never staged
CLAUDE.md, agent.md                                    T5  one paragraph / one sentence
```

Board code lives in the existing `phones/` folders because a board is a `LiveDevice` on the phone path. The URLs stay `/api/live/*` and `/live`.

---

### Task 1: Contract, schema, device tokens, bearer frames, motion header in the store and the devices API

**Files:**
- Create: `schemas/esp32-frame.v1.md`, `dashboard/web/src/lib/phones/deviceToken.ts`, `dashboard/web/src/lib/phones/motionHeader.ts`, `dashboard/web/tests/unit/deviceToken.test.ts`, `dashboard/web/tests/unit/motionHeader.test.ts`, `dashboard/web/tests/unit/token-boundary.test.ts`, `dashboard/web/prisma/migrations/<timestamp>_board_devices/migration.sql`
- Modify: `dashboard/web/prisma/schema.prisma`, `dashboard/web/src/lib/types.ts`, `dashboard/web/src/lib/phones/frameStore.ts`, `dashboard/web/src/lib/phones/devices.ts`, `dashboard/web/src/lib/phones/http.ts`, `dashboard/web/tests/unit/frameStore.test.ts`, `dashboard/web/tests/integration/live-phones.test.ts`, `dashboard/web/tests/unit/liveScreen.test.tsx`, `dashboard/web/tests/unit/sourceSelect.test.tsx`

**Interfaces:**
- Consumes: `FrameStore.put/latest/onlineIds/lastFrameAt/forget`, `frameAccess`, `listDevices`, `registerDevice`, `postFrame`, `getDevices` and `PhoneDeps` (Plan E).
- Produces:
  - `deviceToken.ts`: `TOKEN_BYTES = 32`; `newDeviceToken(): { token: string; hash: string }`; `hashDeviceToken(token: string): string`; `tokenMatches(token: string, storedHash: string | null): boolean`; `bearerToken(headers: Headers): string | null`.
  - `motionHeader.ts`: `MOTION_HEADER = 'x-nesttrace-motion'`; `parseMotionHeader(value: string | null): BoardMotion | null`.
  - `frameStore.ts`: `interface BoardMotion { percent: number; active: boolean; box: [number, number, number, number] }`; `put(deviceId, jpeg, now?, motion?: BoardMotion | null)`; `motion(deviceId, now?): (BoardMotion & { at: number }) | null`.
  - `devices.ts`: `BoardAccess`; `boardAccess(prisma, deviceId, token): Promise<BoardAccess>`; `FrameAccess` status widened to `401 | 403 | 404`; `frameAccess(prisma, deviceId, user)` now also refuses VIEWERs (403) and boards (401).
  - `http.ts`: `BOARD_REFUSED = 'Device token not accepted.'`; `BOARD_NEEDS_TOKEN = 'This camera board sends with its device token.'`.
  - `types.ts`: `type LiveDeviceKind = 'PHONE' | 'BOARD'`; `interface BoardMotionView { percent: number; active: boolean; box: [number, number, number, number]; at: string }`; `LiveDeviceView` gains `kind: LiveDeviceKind` and `motion: BoardMotionView | null`.

- [ ] **Step 1: Write the contract first**

`schemas/esp32-frame.v1.md`:
````markdown
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
````

- [ ] **Step 2: Schema and migration**

`prisma/schema.prisma`: add the enum next to the other enums and two fields to `LiveDevice`:
```prisma
enum DeviceKind {
  PHONE
  BOARD
}
```
```prisma
model LiveDevice {
  id         String     @id @default(cuid())
  name       String
  kind       DeviceKind @default(PHONE)
  /// SHA-256 (hex) of a BOARD's device token; phones never have one. The token itself is never stored.
  tokenHash  String?    @unique
  ownerId    String
  ...unchanged fields...
}
```
Run (with `docker compose up -d db`): `cd dashboard/web && npx prisma migrate dev --name board_devices --create-only`. The generated SQL must be exactly the first three statements below. Append the CHECK by hand:
```sql
-- CreateEnum
CREATE TYPE "DeviceKind" AS ENUM ('PHONE', 'BOARD');

-- AlterTable
ALTER TABLE "LiveDevice" ADD COLUMN     "kind" "DeviceKind" NOT NULL DEFAULT 'PHONE',
ADD COLUMN     "tokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LiveDevice_tokenHash_key" ON "LiveDevice"("tokenHash");

-- Every board has a token hash and no phone has one.
ALTER TABLE "LiveDevice" ADD CONSTRAINT "LiveDevice_token_matches_kind" CHECK (("kind" = 'BOARD') = ("tokenHash" IS NOT NULL));
```
Then `npx prisma migrate dev` (applies it and regenerates the client) and `npm run db:test:prepare`.

- [ ] **Step 3: Failing unit tests**

`tests/unit/deviceToken.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('node:crypto', async importOriginal =>
{
    const real = await importOriginal<typeof import('node:crypto')>();
    return { ...real, timingSafeEqual: vi.fn(real.timingSafeEqual) };
});
const crypto = await import('node:crypto');
const { bearerToken, hashDeviceToken, newDeviceToken, tokenMatches, TOKEN_BYTES } = await import('@/lib/phones/deviceToken');

describe('device tokens', () =>
{
    it('makes 32 random bytes as base64url and stores only the SHA-256 hex', () =>
    {
        expect(TOKEN_BYTES).toBe(32);
        const { token, hash } = newDeviceToken();
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(Buffer.from(token, 'base64url')).toHaveLength(32);
        expect(hash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
        expect(newDeviceToken().token).not.toBe(token);
    });

    it('matches only the right token, always through timingSafeEqual', () =>
    {
        const { token, hash } = newDeviceToken();
        const other = newDeviceToken().token;
        const compare = vi.mocked(crypto.timingSafeEqual);
        compare.mockClear();
        expect(tokenMatches(token, hash)).toBe(true);
        expect(tokenMatches(other, hash)).toBe(false);
        expect(tokenMatches('short', hash)).toBe(false);
        expect(tokenMatches(token, null)).toBe(false);
        expect(tokenMatches(token, 'not-hex')).toBe(false);
        expect(tokenMatches(token, hash.toUpperCase())).toBe(false);
        expect(compare).toHaveBeenCalledTimes(6);
    });

    it('reads only a Bearer authorization', () =>
    {
        expect(bearerToken(new Headers({ authorization: 'Bearer abc_DEF-1' }))).toBe('abc_DEF-1');
        expect(bearerToken(new Headers({ authorization: 'bearer   abc' }))).toBe('abc');
        expect(bearerToken(new Headers({ authorization: 'Basic abc' }))).toBeNull();
        expect(bearerToken(new Headers({ authorization: 'Bearer' }))).toBeNull();
        expect(bearerToken(new Headers({ authorization: 'Bearer a b' }))).toBeNull();
        expect(bearerToken(new Headers())).toBeNull();
        expect(hashDeviceToken('a')).toHaveLength(64);
    });
});
```

`tests/unit/motionHeader.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { MOTION_HEADER, parseMotionHeader } from '@/lib/phones/motionHeader';

describe('X-NestTrace-Motion v1', () =>
{
    it('parses the firmware format', () =>
    {
        expect(MOTION_HEADER).toBe('x-nesttrace-motion');
        expect(parseMotionHeader('v1;percent=4.2;active=1;box=96,40,64,72')).toEqual({ percent: 4.2, active: true, box: [96, 40, 64, 72] });
        expect(parseMotionHeader('v1;percent=0.0;active=0;box=0,0,0,0')).toEqual({ percent: 0, active: false, box: [0, 0, 0, 0] });
        expect(parseMotionHeader('v1;percent=100.0;active=1;box=0,0,320,240')).toEqual({ percent: 100, active: true, box: [0, 0, 320, 240] });
        expect(parseMotionHeader(' v1;percent=1.5;active=0;box=1,2,3,4 ')?.percent).toBe(1.5);
    });

    it('ignores missing, malformed and unknown versions', () =>
    {
        for (const value of [
            null, '', 'v2;percent=4.2;active=1;box=1,2,3,4', 'V1;percent=4.2;active=1;box=1,2,3,4',
            'v1;percent=4;active=1;box=1,2,3,4', 'v1;percent=4.25;active=1;box=1,2,3,4', 'v1;percent=100.1;active=1;box=1,2,3,4',
            'v1;percent=-1.0;active=1;box=1,2,3,4', 'v1;percent=4.2;active=2;box=1,2,3,4', 'v1;percent=4.2;active=1;box=1,2,3',
            'v1;percent=4.2;active=1;box=1,2,3,65536', 'v1;percent=4.2;active=1;box=1,2,3,-4', 'v1;active=1;percent=4.2;box=1,2,3,4',
            'v1; percent=4.2;active=1;box=1,2,3,4', 'v1;percent=4.2;active=1;box=1,2,3,4;extra=1', 'v1;percent=4.2;active=1;box=1,2,3,4'.padEnd(161, ' '),
        ])
        {
            expect(parseMotionHeader(value), String(value)).toBeNull();
        }
    });
});
```

Add to `tests/unit/frameStore.test.ts`:
```ts
it('keeps the board motion beside the newest frame and drops it with the frame', () =>
{
    const store = new FrameStore();
    const moving = { percent: 4.2, active: true, box: [1, 2, 3, 4] as [number, number, number, number] };
    store.put('b1', jpeg(1), 1_000, moving);
    expect(store.motion('b1', 1_000)).toEqual({ ...moving, at: 1_000 });
    store.put('b1', jpeg(2), 1_200);
    expect(store.motion('b1', 1_200)).toBeNull();
    store.put('b1', jpeg(3), 1_400, moving);
    expect(store.motion('b1', 1_400 + 10_001)).toBeNull();
    for (let i = 0; i < 10; i++) store.put('b2', jpeg(i), 2_000 + i, moving);
    expect(store.put('b2', jpeg(99), 2_050, { ...moving, percent: 50 }).ok).toBe(false);
    expect(store.motion('b2', 2_050)?.percent).toBe(4.2);
});
```

`tests/unit/token-boundary.test.ts`:
```ts
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const ALLOWED = ['src/lib/phones/deviceToken.ts', 'src/lib/phones/devices.ts', 'src/lib/phones/boards.ts'];
const NO_LOGS = [...ALLOWED, 'src/app/(app)/live/actions.ts', 'src/lib/phones/boardSecrets.ts', 'src/features/phones/BoardToken.tsx'];

function files(dir: string): string[]
{
    return readdirSync(dir).flatMap(name =>
    {
        const path = join(dir, name);
        if (name === 'generated' || name === 'node_modules') return [];
        return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
}

describe('device token boundary', () =>
{
    it('lets only the token, device and board modules touch tokenHash', () =>
    {
        const touching = files(join(root, 'src')).filter(path => readFileSync(path, 'utf8').includes('tokenHash')).map(path => relative(root, path));
        expect(touching.filter(path => !ALLOWED.includes(path))).toEqual([]);
    });

    it('never logs from code that holds a token or its hash', () =>
    {
        for (const path of NO_LOGS.map(file => join(root, file)).filter(existsSync))
        {
            expect(readFileSync(path, 'utf8'), path).not.toMatch(/console\.|logger\./);
        }
    });
});
```

Run: `npx vitest run tests/unit/deviceToken.test.ts tests/unit/motionHeader.test.ts tests/unit/frameStore.test.ts tests/unit/token-boundary.test.ts`. Expected: FAIL (modules missing, `motion` not a function).

- [ ] **Step 4: Implement the token, header and store pieces**

`src/lib/phones/deviceToken.ts`:
```ts
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOKEN_BYTES = 32;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const HASH_SHAPE = /^[0-9a-f]{64}$/;
const NO_HASH = Buffer.alloc(32);

export function hashDeviceToken(token: string): string
{
    return createHash('sha256').update(token, 'utf8').digest('hex');
}

// A new board token; only the hash is ever stored.
export function newDeviceToken(): { token: string; hash: string }
{
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    return { token, hash: hashDeviceToken(token) };
}

// Always hashes and compares in constant time, even for a malformed token or a missing hash, so timing says nothing.
export function tokenMatches(token: string, storedHash: string | null): boolean
{
    const wellFormed = TOKEN_SHAPE.test(token) && storedHash !== null && HASH_SHAPE.test(storedHash);
    const presented = Buffer.from(hashDeviceToken(token), 'hex');
    const stored = wellFormed && storedHash ? Buffer.from(storedHash, 'hex') : NO_HASH;
    return timingSafeEqual(presented, stored) && wellFormed;
}

export function bearerToken(headers: Headers): string | null
{
    const match = /^Bearer +(\S+)\s*$/i.exec(headers.get('authorization') ?? '');
    return match ? match[1] : null;
}
```

`src/lib/phones/motionHeader.ts`:
```ts
import type { BoardMotion } from './frameStore';

export const MOTION_HEADER = 'x-nesttrace-motion';
const MAX_LENGTH = 160;
// schemas/esp32-frame.v1.md: fixed order, one decimal, no spaces.
const V1 = /^v1;percent=(100\.0|\d{1,2}\.\d);active=([01]);box=(\d{1,5}),(\d{1,5}),(\d{1,5}),(\d{1,5})$/;

// The board's motion reading, or null when absent, malformed or another version (the frame is still accepted).
export function parseMotionHeader(value: string | null): BoardMotion | null
{
    if (!value || value.length > MAX_LENGTH)
    {
        return null;
    }
    const match = V1.exec(value.trim());
    if (!match)
    {
        return null;
    }
    const box = match.slice(3, 7).map(Number) as [number, number, number, number];
    if (box.some(n => n > 65535))
    {
        return null;
    }
    return { percent: Number(match[1]), active: match[2] === '1', box };
}
```

`src/lib/phones/frameStore.ts`: add the type, store it on `Entry`, and add `motion()`:
```ts
export interface BoardMotion
{
    percent: number;
    active: boolean;
    box: [number, number, number, number];
}

interface Entry
{
    jpeg: Buffer;
    at: number;
    recent: number[];
    touchedAt: number;
    motion: BoardMotion | null;
}
```
In `put(deviceId: string, jpeg: Buffer, now: number = Date.now(), motion: BoardMotion | null = null)`, write `motion` into the new entry: `this.entries.set(deviceId, { jpeg, at, recent, touchedAt: ..., motion })`. A rate-refused frame leaves the entry as it was. New method:
```ts
    // The motion that came with the newest frame, while the device is online.
    motion(deviceId: string, now: number = Date.now()): (BoardMotion & { at: number }) | null
    {
        const entry = this.entries.get(deviceId);
        return entry?.motion && now - entry.at <= ONLINE_MS ? { ...entry.motion, at: entry.at } : null;
    }
```

`src/lib/types.ts`:
```ts
export type LiveDeviceKind = 'PHONE' | 'BOARD';

// Motion measured on a camera board, as last reported with a frame (schemas/esp32-frame.v1.md).
export interface BoardMotionView
{
    percent: number;
    active: boolean;
    box: [number, number, number, number];
    at: string;
}
```
`LiveDeviceView` gains `kind: LiveDeviceKind;` and `motion: BoardMotionView | null;`. Add `kind: 'PHONE', motion: null` to the `LiveDeviceView` fixtures `phone` in `tests/unit/liveScreen.test.tsx` and `dune` in `tests/unit/sourceSelect.test.tsx`.

Run the Step 3 command. Expected: PASS.

- [ ] **Step 5: Failing integration tests (bearer path, motion, devices API)**

In `tests/integration/live-phones.test.ts` add the imports `newDeviceToken, hashDeviceToken` from `@/lib/phones/deviceToken` and `registerDevice` from `@/lib/phones/devices`, then append:
```ts
describe('board frames', () =>
{
    let now: number;
    beforeEach(() => { now = T0; });
    const deps = (user: SessionUser | null, store: FrameStore, recorder: FrameRecorder | null = null) => ({ prisma, user, store, recorder, now: () => (now += 200) });
    const boardFrame = (token: string | null, motion?: string, body: Uint8Array<ArrayBuffer> = jpeg()) =>
    {
        const headers: Record<string, string> = { 'content-type': 'image/jpeg' };
        if (token !== null) headers.authorization = `Bearer ${token}`;
        if (motion !== undefined) headers['x-nesttrace-motion'] = motion;
        return new Request('https://x/api/live/frame/id', { method: 'POST', body, headers });
    };
    async function board(name = 'Dune board'): Promise<{ id: string; token: string }>
    {
        const { token, hash } = newDeviceToken();
        const row = await prisma.liveDevice.create({ data: { ownerId: admin.id, name, kind: 'BOARD', tokenHash: hash } });
        return { id: row.id, token };
    }

    it('accepts a board with its own token and no session, and records it like a phone', async () =>
    {
        const { id, token } = await board();
        const store = new FrameStore();
        const added: unknown[] = [];
        const recorder: FrameRecorder = { addFrame: (_d, _j, _at, meta) => added.push(meta), isRecording: () => true };
        const response = await postFrame(deps(null, store, recorder), id, boardFrame(token));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ at: T0 + 200, cameraCode: null, recording: true });
        expect(store.latest(id, T0 + 200)?.jpeg).toEqual(jpeg());
        expect(added).toEqual([{ deviceName: 'Dune board', cameraCode: null }]);
        // A session does not change the outcome when a bearer token is present.
        expect((await postFrame(deps(viewer, store), id, boardFrame(token))).status).toBe(200);
    });

    it('answers 401 for every token that is not this board\'s own', async () =>
    {
        const first = await board('One');
        const second = await board('Two');
        const phone = await register(volunteer);
        const store = new FrameStore();
        const status = async (id: string, token: string | null, user: SessionUser | null = null) => (await postFrame(deps(user, store), id, boardFrame(token))).status;
        expect(await status(first.id, second.token)).toBe(401);
        expect(await status(first.id, newDeviceToken().token)).toBe(401);
        expect(await status(first.id, 'not-a-token')).toBe(401);
        expect(await status(first.id, hashDeviceToken(first.token))).toBe(401);
        expect(await status(phone, first.token)).toBe(401);
        expect(await status('no-such-device', first.token)).toBe(401);
        expect(await status(first.id, null)).toBe(401);
        expect(await status(first.id, null, admin)).toBe(401);
        expect(await status(first.id, null, volunteer)).toBe(401);
        expect(await status(first.id, null, viewer)).toBe(401);
        await prisma.liveDevice.update({ where: { id: first.id }, data: { disabledAt: new Date() } });
        expect(await status(first.id, first.token)).toBe(401);
        expect(store.latest(first.id, now)).toBeNull();
        expect(await status(second.id, second.token)).toBe(200);
    });

    it('keeps the phone rules: 413, 415 and 429 apply to boards too', async () =>
    {
        const { id, token } = await board();
        const store = new FrameStore();
        expect((await postFrame(deps(null, store), id, boardFrame(token, undefined, jpeg(500 * 1024 + 1)))).status).toBe(413);
        expect((await postFrame(deps(null, store), id, boardFrame(token, undefined, Buffer.from('hello world')))).status).toBe(415);
        const fast = { prisma, user: null, store, now: () => (now += 50) };
        const statuses: number[] = [];
        for (let i = 0; i < 11; i++) statuses.push((await postFrame(fast, id, boardFrame(token))).status);
        expect(statuses).toEqual([...Array(10).fill(200), 429]);
    });

    it('stores the motion header for boards, ignores bad ones, and lists it without the token', async () =>
    {
        const { id, token } = await board();
        const phone = await register(volunteer);
        const store = new FrameStore();
        await postFrame(deps(null, store), id, boardFrame(token, 'v1;percent=4.2;active=1;box=96,40,64,72'));
        await postFrame(deps(volunteer, store), phone, new Request('https://x', { method: 'POST', body: jpeg(), headers: { 'content-type': 'image/jpeg', 'x-nesttrace-motion': 'v1;percent=9.9;active=1;box=1,1,1,1' } }));
        const response = await getDevices({ prisma, user: viewer, store, now: () => T0 + 1_000 });
        const text = await response.clone().text();
        expect(text).not.toContain(token);
        expect(text).not.toContain(hashDeviceToken(token));
        expect(text).not.toContain('tokenHash');
        const { devices } = await response.json() as { devices: LiveDeviceView[] };
        const byKind = Object.fromEntries(devices.map(d => [d.kind, d]));
        expect(byKind.BOARD.motion).toEqual({ percent: 4.2, active: true, box: [96, 40, 64, 72], at: new Date(T0 + 200).toISOString() });
        expect(byKind.PHONE.motion).toBeNull();

        expect((await postFrame(deps(null, store), id, boardFrame(token, 'v2;percent=4.2;active=1;box=1,2,3,4'))).status).toBe(200);
        expect(store.motion(id, now)).toBeNull();
        expect((await postFrame(deps(null, store), id, boardFrame(token, 'garbage'))).status).toBe(200);
        expect(store.motion(id, now)).toBeNull();
    });

    it('never reuses a board when a phone registers under the same owner and name', async () =>
    {
        const { id } = await board('Pier');
        const phone = await registerDevice(prisma, admin.id, 'Pier');
        expect(phone.id).not.toBe(id);
        expect(phone.created).toBe(true);
    });

    it('enforces in the database that only boards have a token hash', async () =>
    {
        await expect(prisma.liveDevice.create({ data: { ownerId: volunteer.id, name: 'x', tokenHash: 'a'.repeat(64) } })).rejects.toThrow();
        await expect(prisma.liveDevice.create({ data: { ownerId: admin.id, name: 'y', kind: 'BOARD' } })).rejects.toThrow();
        const { hash } = newDeviceToken();
        await prisma.liveDevice.create({ data: { ownerId: admin.id, name: 'z', kind: 'BOARD', tokenHash: hash } });
        await expect(prisma.liveDevice.create({ data: { ownerId: admin.id, name: 'w', kind: 'BOARD', tokenHash: hash } })).rejects.toThrow();
    });
});
```
Also update the existing assertion in `'lets the owner and an admin send, and refuses everyone else'`: the VIEWER line stays 403 (now from `frameAccess`), and everything else is unchanged.

Run: `npx vitest run tests/integration/live-phones.test.ts`. Expected: FAIL (`boardAccess` missing, bearer frames get 401 from `senderOrRefusal`, no `kind`/`motion` in the list).

- [ ] **Step 6: Implement the bearer path**

`src/lib/phones/devices.ts`:
- `registerDevice`: both queries get `kind: 'PHONE'`. The `findFirst` uses `where: { ownerId, name, kind: 'PHONE', disabledAt: null }` and the `create` uses `data: { ownerId, name, kind: 'PHONE' }`.
- `frameAccess` becomes the whole session check (signed-out is still handled in `postFrame`):
```ts
export type FrameAccess = { ok: true; device: { id: string; name: string; cameraCode: string | null } } | { ok: false; status: 401 | 403 | 404 };

// Session senders: a board needs its token (401); otherwise the owner or an admin, never a viewer, and never a removed phone.
export async function frameAccess(prisma: PrismaClient, deviceId: string, user: SessionUser): Promise<FrameAccess>
{
    const row = await prisma.liveDevice.findUnique({ where: { id: deviceId }, select: { id: true, name: true, kind: true, ownerId: true, disabledAt: true, camera: { select: { code: true } } } });
    if (!row)
    {
        return { ok: false, status: 404 };
    }
    if (row.kind === 'BOARD')
    {
        return { ok: false, status: 401 };
    }
    if ((user.role !== 'VOLUNTEER' && user.role !== 'ADMIN') || row.disabledAt || (row.ownerId !== user.id && user.role !== 'ADMIN'))
    {
        return { ok: false, status: 403 };
    }
    return { ok: true, device: { id: row.id, name: row.name, cameraCode: row.camera?.code ?? null } };
}

export type BoardAccess = { ok: true; device: { id: string; name: string; cameraCode: string | null } } | { ok: false };

// A bearer token opens only its own BOARD while that board is not removed. The comparison runs even for unknown ids.
export async function boardAccess(prisma: PrismaClient, deviceId: string, token: string): Promise<BoardAccess>
{
    const row = await prisma.liveDevice.findUnique({ where: { id: deviceId }, select: { id: true, name: true, kind: true, tokenHash: true, disabledAt: true, camera: { select: { code: true } } } });
    const matches = tokenMatches(token, row?.tokenHash ?? null);
    if (!row || !matches || row.kind !== 'BOARD' || row.disabledAt)
    {
        return { ok: false };
    }
    return { ok: true, device: { id: row.id, name: row.name, cameraCode: row.camera?.code ?? null } };
}
```
- `listDevices`: replace the `include` with an explicit `select` so `tokenHash` can never ride along, and add `kind` and `motion`:
```ts
    const rows = await prisma.liveDevice.findMany({
        where: options.all ? { disabledAt: null } : { disabledAt: null, id: { in: [...online] } },
        orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, kind: true, lastSeenAt: true, owner: { select: { name: true } }, camera: { select: { code: true } } },
    });
    return rows.map(row =>
    {
        const frameAt = store.lastFrameAt(row.id);
        const reading = row.kind === 'BOARD' ? store.motion(row.id, now) : null;
        return {
            id: row.id,
            name: row.name,
            kind: row.kind,
            ownerName: row.owner.name,
            cameraCode: row.camera?.code ?? null,
            online: online.has(row.id),
            recording: options.isRecording?.(row.id) ?? false,
            lastSeenAt: new Date(Math.max(frameAt ?? 0, row.lastSeenAt.getTime())).toISOString(),
            motion: reading ? { percent: reading.percent, active: reading.active, box: reading.box, at: new Date(reading.at).toISOString() } : null,
        };
    });
```
Import `tokenMatches` from `./deviceToken`.

`src/lib/phones/http.ts`: `postFrame` picks the path from the `Authorization` header:
```ts
export const BOARD_REFUSED = 'Device token not accepted.';
export const BOARD_NEEDS_TOKEN = 'This camera board sends with its device token.';

export async function postFrame(deps: PhoneDeps, deviceId: string, request: Request): Promise<Response>
{
    const token = bearerToken(request.headers);
    let device: { id: string; name: string; cameraCode: string | null };
    let motion: BoardMotion | null = null;
    if (token !== null)
    {
        const board = await boardAccess(deps.prisma, deviceId, token);
        if (!board.ok)
        {
            return json({ error: BOARD_REFUSED }, 401);
        }
        device = board.device;
        motion = parseMotionHeader(request.headers.get(MOTION_HEADER));
    }
    else
    {
        if (!deps.user)
        {
            return json({ error: SIGN_IN_FIRST }, 401);
        }
        const access = await frameAccess(deps.prisma, deviceId, deps.user);
        if (!access.ok)
        {
            const error = access.status === 404 ? 'Unknown phone.' : access.status === 401 ? BOARD_NEEDS_TOKEN : 'This phone cannot send here.';
            return json({ error }, access.status);
        }
        device = access.device;
    }
    const body = await readCapped(request, MAX_FRAME_BYTES);
    if (body === 'too-large')
    {
        return json({ error: 'Frame larger than 500 KB.' }, 413);
    }
    if (!isJpeg(body))
    {
        return json({ error: 'Frames must be JPEG.' }, 415);
    }
    const now = deps.now?.() ?? Date.now();
    const put = deps.store.put(deviceId, body, now, motion);
    if (!put.ok)
    {
        return json({ error: 'More than 10 frames a second.' }, 429);
    }
    if (put.touch)
    {
        await touchDevice(deps.prisma, deviceId, new Date(now));
    }
    deps.recorder?.addFrame(deviceId, body, put.at, { deviceName: device.name, cameraCode: device.cameraCode });
    return json({ at: put.at, cameraCode: device.cameraCode, recording: deps.recorder?.isRecording(deviceId) ?? false });
}
```
Import `bearerToken` from `./deviceToken`, `parseMotionHeader, MOTION_HEADER` from `./motionHeader`, `boardAccess` from `./devices`, and `type BoardMotion` from `./frameStore`. A signed-out caller with no token still gets 401 before any lookup, and an unknown id with a session is still 404, as in Plan E. `senderOrRefusal` stays for `postDevice`.

Run: `npx vitest run tests/integration/live-phones.test.ts tests/integration/remove-phone.test.ts tests/integration/camera-source.test.ts tests/unit`. Expected: PASS.

- [ ] **Step 7: Full check and commit**

```bash
cd dashboard/web && npx tsc --noEmit && npx vitest run
git add schemas/esp32-frame.v1.md dashboard/web/prisma/schema.prisma dashboard/web/prisma/migrations/*_board_devices/migration.sql \
  dashboard/web/src/lib/types.ts dashboard/web/src/lib/phones/deviceToken.ts dashboard/web/src/lib/phones/motionHeader.ts \
  dashboard/web/src/lib/phones/frameStore.ts dashboard/web/src/lib/phones/devices.ts dashboard/web/src/lib/phones/http.ts \
  dashboard/web/tests/unit/deviceToken.test.ts dashboard/web/tests/unit/motionHeader.test.ts dashboard/web/tests/unit/frameStore.test.ts \
  dashboard/web/tests/unit/token-boundary.test.ts dashboard/web/tests/integration/live-phones.test.ts \
  dashboard/web/tests/unit/liveScreen.test.tsx dashboard/web/tests/unit/sourceSelect.test.tsx
git commit -m "feat(dashboard): camera boards send frames with a device token and an on-board motion header"
```
(`git add` with the glob expands to the one new migration folder; check `git status --short` before committing.)

---

### Task 2: Add board camera and Rotate token (admin, audited)

**Files:**
- Create: `dashboard/web/src/lib/phones/boards.ts`, `dashboard/web/src/lib/phones/boardSecrets.ts`, `dashboard/web/tests/unit/boardSecrets.test.ts`, `dashboard/web/tests/integration/board-devices.test.ts`
- Modify: `dashboard/web/src/lib/phones/connect.ts`, `dashboard/web/tests/unit/connect.test.ts`, `dashboard/web/src/app/(app)/live/actions.ts`

**Interfaces:**
- Consumes: `newDeviceToken` (T1), `cleanDeviceName`, `DEVICE_NAME_MAX`, `CameraEditError`, `requireCurrentUser('ADMIN')`, `connectUrl`.
- Produces:
  - `boards.ts`: `interface IssuedToken { id: string; name: string; token: string }`; `createBoard(prisma, actorId, name): Promise<IssuedToken>`; `rotateBoardToken(prisma, actorId, deviceId): Promise<IssuedToken>`. Both throw `CameraEditError` with a user-facing message.
  - `connect.ts`: `dashboardOrigin(lanHost: string | undefined): string | null` → `https://<host>:3443`; `connectUrl` now returns `${dashboardOrigin(lanHost)}/cam`.
  - `boardSecrets.ts`: `boardSecretsBlock(input: { dashboardUrl: string | null; deviceId: string; token: string }): string`.
  - `actions.ts`: `type IssuedTokenResult = { ok: true; deviceId: string; name: string; token: string; secrets: string; dashboardUrl: string | null } | { ok: false; error: string }`; `addBoardCamera(name: string): Promise<IssuedTokenResult>`; `rotateDeviceToken(deviceId: string): Promise<IssuedTokenResult>`.

- [ ] **Step 1: Failing unit tests**

`tests/unit/boardSecrets.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { boardSecretsBlock } from '@/lib/phones/boardSecrets';

describe('boardSecretsBlock', () =>
{
    it('writes the secrets.h lines with the dashboard address, id, token and a CA slot', () =>
    {
        const block = boardSecretsBlock({ dashboardUrl: 'https://10.47.138.152:3443', deviceId: 'ckboard1', token: 'T'.repeat(43) });
        expect(block).toContain('#define DASHBOARD_URL "https://10.47.138.152:3443"');
        expect(block).toContain('#define DEVICE_ID "ckboard1"');
        expect(block).toContain(`#define DEVICE_TOKEN "${'T'.repeat(43)}"`);
        expect(block).toContain('docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt');
        expect(block).toContain('static const char DASHBOARD_CA[] = R"PEM(\n)PEM";');
    });

    it('leaves the address empty with a note when LAN_HOST is not set', () =>
    {
        const block = boardSecretsBlock({ dashboardUrl: null, deviceId: 'ckboard1', token: 'T'.repeat(43) });
        expect(block).toContain('#define DASHBOARD_URL ""');
        expect(block).toContain('Set LAN_HOST in dashboard/.env');
    });
});
```
Add to `tests/unit/connect.test.ts`:
```ts
it('builds the dashboard origin the board uses', () =>
{
    expect(dashboardOrigin('10.47.138.152')).toBe('https://10.47.138.152:3443');
    expect(dashboardOrigin(' laptop.local ')).toBe('https://laptop.local:3443');
    expect(dashboardOrigin('')).toBeNull();
    expect(dashboardOrigin('bad host')).toBeNull();
    expect(connectUrl('10.47.138.152')).toBe('https://10.47.138.152:3443/cam');
});
```
Run: `npx vitest run tests/unit/boardSecrets.test.ts tests/unit/connect.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement `connect.ts` and `boardSecrets.ts`**

`src/lib/phones/connect.ts`:
```ts
// https://<LAN_HOST>:3443, the address phones and camera boards use. Null when unset or malformed.
export function dashboardOrigin(lanHost: string | undefined): string | null
{
    const host = lanHost?.trim();
    return host && HOST.test(host) ? `https://${host}:3443` : null;
}

// The address phones open, from LAN_HOST (the laptop's Wi-Fi IP). Null when unset or malformed.
export function connectUrl(lanHost: string | undefined): string | null
{
    const origin = dashboardOrigin(lanHost);
    return origin ? `${origin}/cam` : null;
}
```

`src/lib/phones/boardSecrets.ts`:
```ts
// The lines an admin pastes into firmware/esp32s3-cam/secrets.h. Built in the action result only; never stored.
export function boardSecretsBlock({ dashboardUrl, deviceId, token }: { dashboardUrl: string | null; deviceId: string; token: string }): string
{
    return [
        '// NestTrace dashboard upload. Paste below the Wi-Fi lines in firmware/esp32s3-cam/secrets.h.',
        ...(dashboardUrl ? [] : ['// Set LAN_HOST in dashboard/.env, then put https://<LAN_HOST>:3443 here.']),
        `#define DASHBOARD_URL "${dashboardUrl ?? ''}"`,
        `#define DEVICE_ID "${deviceId}"`,
        `#define DEVICE_TOKEN "${token}"`,
        '// Caddy\'s root certificate. In dashboard/: docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt',
        '// Paste its lines (BEGIN to END CERTIFICATE) between the two lines below.',
        'static const char DASHBOARD_CA[] = R"PEM(',
        ')PEM";',
        '',
    ].join('\n');
}
```
Run the Step 1 command. Expected: PASS.

- [ ] **Step 3: Failing integration tests for the actions**

`tests/integration/board-devices.test.ts`. Use the same mock header as `tests/integration/remove-phone.test.ts` (`@/lib/db` → test client, `next/headers`, `next/navigation`, `next/cache`, `@/lib/auth/session` with `role`/`sessionId`, and `AUTH_SECRET` in `beforeAll`), then:
```ts
const { prisma } = await import('@/lib/db') as { prisma: PrismaClient };
const { addBoardCamera, rotateDeviceToken, removePhone } = await import('@/app/(app)/live/actions');
const { registerDevice } = await import('@/lib/phones/devices');
const { hashDeviceToken } = await import('@/lib/phones/deviceToken');
const { FrameStore } = await import('@/lib/phones/frameStore');
const { postFrame } = await import('@/lib/phones/http');
const { seedDatabase } = await import('../../prisma/seed');

// beforeEach: TRUNCATE as in remove-phone.test.ts, seed, adminId/volunteerId/viewerId; role = 'ADMIN'; sessionId = adminId; process.env.LAN_HOST = '10.47.138.152'.

const jpeg = () => { const body = Buffer.alloc(64, 7); body[0] = 0xff; body[1] = 0xd8; return body; };
const send = (id: string, token: string) => postFrame({ prisma, user: null, store: new FrameStore() }, id, new Request('https://x', { method: 'POST', body: jpeg(), headers: { authorization: `Bearer ${token}`, 'content-type': 'image/jpeg' } }));

describe('addBoardCamera', () =>
{
    it('refuses volunteers and viewers before creating anything', async () =>
    {
        for (const [denied, userId] of [['VOLUNTEER', volunteerId], ['VIEWER', viewerId]])
        {
            role = denied;
            sessionId = userId;
            await expect(addBoardCamera('Dune board')).rejects.toThrow('FORBIDDEN');
        }
        expect(await prisma.liveDevice.count()).toBe(0);
        expect(await prisma.auditLog.count({ where: { action: 'device.create' } })).toBe(0);
    });

    it('creates a BOARD owned by the admin, stores only the hash, and audits without the token', async () =>
    {
        const result = await addBoardCamera('  Dune   board ');
        if (!result.ok) throw new Error(result.error);
        expect(result.name).toBe('Dune board');
        expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(result.dashboardUrl).toBe('https://10.47.138.152:3443');
        expect(result.secrets).toContain(`#define DEVICE_TOKEN "${result.token}"`);
        expect(result.secrets).toContain(`#define DEVICE_ID "${result.deviceId}"`);
        const row = await prisma.liveDevice.findUniqueOrThrow({ where: { id: result.deviceId } });
        expect(row).toMatchObject({ kind: 'BOARD', ownerId: adminId, name: 'Dune board', tokenHash: hashDeviceToken(result.token) });
        const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'device.create' } });
        expect(audit).toMatchObject({ userId: adminId, targetType: 'LiveDevice', targetId: result.deviceId, details: { name: 'Dune board', kind: 'BOARD' } });
        const everything = JSON.stringify(await prisma.auditLog.findMany());
        expect(everything).not.toContain(result.token);
        expect(everything).not.toContain(row.tokenHash!);
        expect((await send(result.deviceId, result.token)).status).toBe(200);
    });

    it('refuses an empty or too long name', async () =>
    {
        expect(await addBoardCamera('   ')).toEqual({ ok: false, error: 'Give the board a name of 1 to 60 characters.' });
        expect(await addBoardCamera('x'.repeat(61))).toEqual({ ok: false, error: 'Give the board a name of 1 to 60 characters.' });
        expect(await prisma.liveDevice.count()).toBe(0);
    });
});

describe('rotateDeviceToken', () =>
{
    it('replaces the token: the old one gets 401, the new one works, and it is audited without either', async () =>
    {
        const added = await addBoardCamera('Dune board');
        if (!added.ok) throw new Error(added.error);
        const rotated = await rotateDeviceToken(added.deviceId);
        if (!rotated.ok) throw new Error(rotated.error);
        expect(rotated.token).not.toBe(added.token);
        expect((await send(added.deviceId, added.token)).status).toBe(401);
        expect((await send(added.deviceId, rotated.token)).status).toBe(200);
        const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'device.rotate' } });
        expect(audit).toMatchObject({ userId: adminId, targetId: added.deviceId, details: { name: 'Dune board' } });
        const everything = JSON.stringify(await prisma.auditLog.findMany());
        for (const secret of [added.token, rotated.token, hashDeviceToken(added.token), hashDeviceToken(rotated.token)])
        {
            expect(everything).not.toContain(secret);
        }
    });

    it('is admin only and refuses phones, removed boards and unknown ids', async () =>
    {
        const added = await addBoardCamera('Dune board');
        if (!added.ok) throw new Error(added.error);
        const phone = await registerDevice(prisma, volunteerId, 'Pixel');
        expect(await rotateDeviceToken(phone.id)).toEqual({ ok: false, error: 'Only camera boards have a token.' });
        expect(await rotateDeviceToken('no-such-device')).toEqual({ ok: false, error: 'That board was removed.' });
        expect(await removePhone(added.deviceId)).toEqual({ ok: true });
        expect(await rotateDeviceToken(added.deviceId)).toEqual({ ok: false, error: 'That board was removed.' });
        role = 'VOLUNTEER';
        sessionId = volunteerId;
        await expect(rotateDeviceToken(added.deviceId)).rejects.toThrow('FORBIDDEN');
        expect(await prisma.auditLog.count({ where: { action: 'device.rotate' } })).toBe(0);
    });
});
```
Run: `npx vitest run tests/integration/board-devices.test.ts`. Expected: FAIL (actions missing).

- [ ] **Step 4: Implement `boards.ts` and the actions**

`src/lib/phones/boards.ts`:
```ts
import type { PrismaClient } from '@/generated/prisma/client';
import { CameraEditError } from '@/lib/cameras/manage';
import { newDeviceToken } from './deviceToken';
import { cleanDeviceName, DEVICE_NAME_MAX } from './devices';

export interface IssuedToken
{
    id: string;
    name: string;
    token: string;
}

// A new camera board owned by the admin. The token is returned once and only its hash is stored.
export async function createBoard(prisma: PrismaClient, actorId: string, rawName: string): Promise<IssuedToken>
{
    const name = cleanDeviceName(rawName);
    if (!name)
    {
        throw new CameraEditError(`Give the board a name of 1 to ${DEVICE_NAME_MAX} characters.`);
    }
    const { token, hash } = newDeviceToken();
    const row = await prisma.$transaction(async tx =>
    {
        const created = await tx.liveDevice.create({ data: { ownerId: actorId, name, kind: 'BOARD', tokenHash: hash }, select: { id: true, name: true } });
        await tx.auditLog.create({ data: { userId: actorId, action: 'device.create', targetType: 'LiveDevice', targetId: created.id, details: { name, kind: 'BOARD' } } });
        return created;
    });
    return { id: row.id, name: row.name, token };
}

// Replaces a board's token; the old one stops working on the board's next frame.
export async function rotateBoardToken(prisma: PrismaClient, actorId: string, deviceId: string): Promise<IssuedToken>
{
    const { token, hash } = newDeviceToken();
    const row = await prisma.$transaction(async tx =>
    {
        const device = await tx.liveDevice.findUnique({ where: { id: deviceId }, select: { id: true, name: true, kind: true, disabledAt: true } });
        if (!device || device.disabledAt)
        {
            throw new CameraEditError('That board was removed.');
        }
        if (device.kind !== 'BOARD')
        {
            throw new CameraEditError('Only camera boards have a token.');
        }
        await tx.liveDevice.update({ where: { id: device.id }, data: { tokenHash: hash } });
        await tx.auditLog.create({ data: { userId: actorId, action: 'device.rotate', targetType: 'LiveDevice', targetId: device.id, details: { name: device.name } } });
        return device;
    });
    return { id: row.id, name: row.name, token };
}
```

`src/app/(app)/live/actions.ts`: add below `removePhone`:
```ts
export type IssuedTokenResult =
    | { ok: true; deviceId: string; name: string; token: string; secrets: string; dashboardUrl: string | null }
    | { ok: false; error: string };

function issued(board: IssuedToken): IssuedTokenResult
{
    const dashboardUrl = dashboardOrigin(process.env.LAN_HOST);
    return { ok: true, deviceId: board.id, name: board.name, token: board.token, dashboardUrl, secrets: boardSecretsBlock({ dashboardUrl, deviceId: board.id, token: board.token }) };
}

// The only place a token leaves the server: this one response.
export async function addBoardCamera(name: string): Promise<IssuedTokenResult>
{
    const actor = await requireCurrentUser('ADMIN');
    const parsed = z.string().max(200).safeParse(name);
    if (!parsed.success)
    {
        return { ok: false, error: 'Give the board a name of 1 to 60 characters.' };
    }
    try
    {
        const board = await createBoard(prisma, actor.id, parsed.data);
        revalidatePath('/live');
        return issued(board);
    }
    catch (error)
    {
        if (error instanceof CameraEditError)
        {
            return { ok: false, error: error.message };
        }
        throw error;
    }
}

export async function rotateDeviceToken(deviceId: string): Promise<IssuedTokenResult>
{
    const actor = await requireCurrentUser('ADMIN');
    const parsed = z.string().min(1).max(40).safeParse(deviceId);
    if (!parsed.success)
    {
        return { ok: false, error: 'That board was removed.' };
    }
    try
    {
        return issued(await rotateBoardToken(prisma, actor.id, parsed.data));
    }
    catch (error)
    {
        if (error instanceof CameraEditError)
        {
            return { ok: false, error: error.message };
        }
        throw error;
    }
}
```
Imports: `createBoard, rotateBoardToken, type IssuedToken` from `@/lib/phones/boards`; `boardSecretsBlock` from `@/lib/phones/boardSecrets`; `dashboardOrigin` from `@/lib/phones/connect`.

Run: `npx vitest run tests/integration/board-devices.test.ts tests/integration/remove-phone.test.ts tests/unit/token-boundary.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd dashboard/web && npx tsc --noEmit && npx vitest run
git add dashboard/web/src/lib/phones/boards.ts dashboard/web/src/lib/phones/boardSecrets.ts dashboard/web/src/lib/phones/connect.ts \
  'dashboard/web/src/app/(app)/live/actions.ts' dashboard/web/tests/unit/boardSecrets.test.ts dashboard/web/tests/unit/connect.test.ts \
  dashboard/web/tests/integration/board-devices.test.ts
git commit -m "feat(dashboard): admins add camera boards and rotate their tokens"
```

---

### Task 3: `/live` UI: Add board camera, token shown once, Devices list, board motion badge and box

**Files:**
- Create: `dashboard/web/src/features/phones/BoardToken.tsx`
- Modify: `dashboard/web/src/features/phones/LiveScreen.tsx`, `dashboard/web/tests/unit/liveScreen.test.tsx`

**Interfaces:**
- Consumes: `addBoardCamera`, `rotateDeviceToken`, `IssuedTokenResult` (T2); `LiveDeviceView.kind/.motion` (T1); `useModal` from `ConnectPhone.tsx`; `removePhone`.
- Produces:
  - `BoardToken.tsx`: `AddBoardDialog({ onClose, onAdded }: { onClose(): void; onAdded(): void })`; `IssuedTokenDialog({ issued, title, onClose }: { issued: Extract<IssuedTokenResult, { ok: true }>; title: string; onClose(): void })`; `IssuedTokenPanel({ issued })` (shared body).
  - `LiveScreen.tsx`: exports `MotionBox({ box, width, height }: { box: [number, number, number, number]; width: number; height: number })` and `MotionBadge({ motion }: { motion: BoardMotionView | null })`. `LivePicture` gains `onNaturalSize?: (width: number, height: number) => void` and `children?: React.ReactNode` (rendered over the picture).

- [ ] **Step 1: Failing DOM tests**

In `tests/unit/liveScreen.test.tsx`, extend the actions mock and add a board fixture:
```ts
const addBoardCamera = vi.fn();
const rotateDeviceToken = vi.fn();
vi.mock('@/app/(app)/live/actions', () => ({
    removePhone: (...args: unknown[]) => removePhone(...args),
    addBoardCamera: (...args: unknown[]) => addBoardCamera(...args),
    rotateDeviceToken: (...args: unknown[]) => rotateDeviceToken(...args),
}));
const { LiveScreen, MotionBox } = await import('@/features/phones/LiveScreen');
const board = { ...phone, id: 'ckb', name: 'Dune board', kind: 'BOARD' as const, ownerName: 'Ad', recording: false, motion: { percent: 4.2, active: true, box: [96, 40, 64, 72] as [number, number, number, number], at: '2026-10-10T20:00:00.000Z' } };
const token = 'A'.repeat(43);
const issuedResult = { ok: true, deviceId: 'ckb', name: 'Dune board', token, dashboardUrl: 'https://10.47.138.152:3443', secrets: `#define DASHBOARD_URL "https://10.47.138.152:3443"\n#define DEVICE_ID "ckb"\n#define DEVICE_TOKEN "${token}"\n` };
```
Change `'hides the phones list from viewers'` to expect no heading named `Devices`. Add:
```ts
describe('camera boards', () =>
{
    it('shows the on-board motion badge and label on board tiles only', async () =>
    {
        stubFetch([board, { ...board, id: 'ckb2', name: 'Still board', motion: { ...board.motion, percent: 0.4, active: false, box: [0, 0, 0, 0] } }, phone]);
        render(<LiveScreen user={viewer} bar={bar} connect={null} />);
        const moving = await screen.findByRole('article', { name: 'Dune board' });
        expect(within(moving).getByText('Moving 4.2%')).toBeTruthy();
        expect(within(moving).getByText('Motion measured on the camera board')).toBeTruthy();
        expect(within(moving).getByText('Camera board · added by Ad')).toBeTruthy();
        expect(within(screen.getByRole('article', { name: 'Still board' })).getByText('Still')).toBeTruthy();
        const phoneTile = screen.getByRole('article', { name: 'Dune phone' });
        expect(within(phoneTile).queryByText(/Moving|Still/)).toBeNull();
        expect(within(phoneTile).queryByText('Motion measured on the camera board')).toBeNull();
    });

    it('draws the box in picture pixels with the picture\'s own letterboxing', () =>
    {
        const { container } = render(<MotionBox box={[96, 40, 64, 72]} width={320} height={240} />);
        const svg = container.querySelector('svg')!;
        expect(svg.getAttribute('viewBox')).toBe('0 0 320 240');
        expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
        const rect = svg.querySelector('rect')!;
        expect([rect.getAttribute('x'), rect.getAttribute('y'), rect.getAttribute('width'), rect.getAttribute('height')]).toEqual(['96', '40', '64', '72']);
    });

    it('adds a board and shows the token once', async () =>
    {
        stubFetch([]);
        addBoardCamera.mockResolvedValueOnce(issuedResult);
        render(<LiveScreen user={admin} bar={bar} connect={{ url: null, qrSvg: null }} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Add board camera' }));
        const dialog = screen.getByRole('dialog', { name: 'Add board camera' });
        fireEvent.change(within(dialog).getByLabelText('Board name'), { target: { value: 'Dune board' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
        await waitFor(() => expect(addBoardCamera).toHaveBeenCalledWith('Dune board'));
        expect((await within(dialog).findByLabelText('Device token') as HTMLInputElement).value).toBe(token);
        expect((within(dialog).getByLabelText('Device id') as HTMLInputElement).value).toBe('ckb');
        expect(within(dialog).getByText(/shown only once/)).toBeTruthy();
        expect(within(dialog).getByLabelText('secrets.h lines').textContent).toContain(`#define DEVICE_TOKEN "${token}"`);
        fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.body.textContent).not.toContain(token);
        fireEvent.click(screen.getByRole('button', { name: 'Add board camera' }));
        expect((screen.getByLabelText('Board name') as HTMLInputElement).value).toBe('');
    });

    it('lists devices with their kind and rotates a board token after a confirm', async () =>
    {
        stubFetch([{ ...board, online: false }, { ...phone, online: false }]);
        rotateDeviceToken.mockResolvedValueOnce({ ...issuedResult, token: 'B'.repeat(43) });
        render(<LiveScreen user={admin} bar={bar} connect={null} />);
        expect(await screen.findByRole('heading', { name: 'Devices' })).toBeTruthy();
        const boardRow = await screen.findByRole('listitem', { name: 'Dune board' });
        const phoneRow = screen.getByRole('listitem', { name: 'Dune phone' });
        expect(within(boardRow).getByText('Camera board')).toBeTruthy();
        expect(within(phoneRow).getByText('Phone')).toBeTruthy();
        expect(within(phoneRow).queryByRole('button', { name: /Rotate token/ })).toBeNull();
        fireEvent.click(within(boardRow).getByRole('button', { name: 'Rotate token for Dune board' }));
        expect(within(boardRow).getByText(/stops sending until secrets.h has the new token/)).toBeTruthy();
        fireEvent.click(within(boardRow).getByRole('button', { name: 'Rotate' }));
        await waitFor(() => expect(rotateDeviceToken).toHaveBeenCalledWith('ckb'));
        const dialog = await screen.findByRole('dialog', { name: 'New token for Dune board' });
        expect((within(dialog).getByLabelText('Device token') as HTMLInputElement).value).toBe('B'.repeat(43));
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(document.body.textContent).not.toContain('B'.repeat(43));
    });
});
```
Run: `npx vitest run tests/unit/liveScreen.test.tsx`. Expected: FAIL.

- [ ] **Step 2: Implement `BoardToken.tsx`**

The behaviour to build (styling follows `ConnectPhone.tsx`: `fixed inset-0 z-50` backdrop, `rounded-2xl border border-white/10 bg-night-900` card, `useModal` for Escape/Tab/focus return):
- `AddBoardDialog`: a `role="dialog"` named **Add board camera**. Phase 1 is a form: a `Board name` input (`maxLength={60}`, required, autofocus), an **Add** submit button (disabled while pending) and **Cancel**. On submit it calls `addBoardCamera(name)` in `useTransition`. `{ ok: false }` shows the error in `role="alert"`. `{ ok: true }` calls `onAdded()` and switches the same dialog to phase 2, `<IssuedTokenPanel issued={result} />`, with a **Done** button. Closing (Done, Escape, backdrop) calls `onClose()`. The parent unmounts the dialog, so the token lives only in that component's state and is gone on close.
- `IssuedTokenPanel`:
  1. A warning line: "This token is shown only once. Copy it into secrets.h now; if it is lost, use Rotate token."
  2. Two read-only inputs labelled **Device id** and **Device token** (`font-mono`, `select-all`, `spellCheck={false}`, `autoComplete="off"`).
  3. A `<pre aria-label="secrets.h lines">` with `issued.secrets`, and a **Copy secrets.h lines** button (clipboard, or select the `pre` when the clipboard is unavailable, like `ConnectPhone`).
  4. When `issued.dashboardUrl` is null, a note: "LAN_HOST is not set in dashboard/.env, so DASHBOARD_URL is empty. Set it and paste the address by hand."
  5. A last line: "Then paste Caddy's root certificate into DASHBOARD_CA (see the firmware README) and upload the firmware."
- `IssuedTokenDialog`: a `role="dialog"` named by `title` around `IssuedTokenPanel` with a **Done** button. Used for rotation with the title `New token for <name>`.

- [ ] **Step 3: Implement the `LiveScreen.tsx` changes**

- Header: next to **Connect phone** (admins only), a second button **Add board camera** (`Cpu` icon from lucide-react, same outline style as `action` but `h-10`). It opens `AddBoardDialog`, and `onAdded` calls `refresh()`.
- `LivePicture`: `<img ... onLoad={event => onNaturalSize?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />`, then `{children}` after the img, inside the relative box.
- `MotionBox`:
```tsx
// The board's box over the picture. The SVG uses the picture's own pixels and object-contain's letterboxing (xMidYMid meet).
export function MotionBox({ box, width, height }: { box: [number, number, number, number]; width: number; height: number })
{
    const [x, y, w, h] = box;
    return (
        <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
            <rect x={x} y={y} width={w} height={h} fill="none" stroke="#F5B544" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
    );
}
```
- `MotionBadge`: `motion?.active` → `Moving ${motion.percent.toFixed(1)}%` (amber background, dark text); otherwise `Still` (muted). `motion === null` → `No motion reading` (muted). Same pill shape as `RecBadge` without the pulse.
- `Tile`: `const [size, setSize] = useState<{ width: number; height: number } | null>(null)` with `onNaturalSize={(width, height) => setSize(previous => previous?.width === width && previous.height === height ? previous : { width, height })}`. For `device.kind === 'BOARD'`:
  - the badge goes at `absolute top-2.5 right-2.5`;
  - `<MotionBox>` renders inside `LivePicture` when `device.motion?.active && size` and the box is non-empty (`w > 0 && h > 0`);
  - the owner line reads `Camera board · added by {ownerName}`;
  - a `text-[11px] text-ink-muted` line reads **Motion measured on the camera board**.
  Phone tiles are unchanged.
- Devices section: the heading becomes **Devices**, and the help text becomes "Every phone and camera board that can send. Link one to a map camera from Setup or the camera panel." `PhoneRow` → `DeviceRow`:
  - A small kind pill (`Camera board` / `Phone`) sits next to the name.
  - Boards get a **Rotate token** button (`aria-label="Rotate token for <name>"`, `KeyRound` icon). It opens an inline confirm: "Rotate the token for <name>? The board stops sending until secrets.h has the new token and the firmware is uploaded again." with **Rotate** / **Cancel**. Success opens `IssuedTokenDialog` with title `New token for <name>`, and an error shows in the row's `role="alert"` line.
  - The Remove confirm text for boards is "Remove <name>? Its camera returns to the simulation loop and the board's token stops working. Add it again to get a new token." The phone text stays exactly as today.
  - The empty text becomes "No devices yet."
- The counter line and the empty-state copy stay the same (phones and boards both count as sending).

Run: `npx vitest run tests/unit/liveScreen.test.tsx tests/unit`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd dashboard/web && npx tsc --noEmit && npx vitest run && npx next build
git add dashboard/web/src/features/phones/BoardToken.tsx dashboard/web/src/features/phones/LiveScreen.tsx dashboard/web/tests/unit/liveScreen.test.tsx
git commit -m "feat(dashboard): board tiles show on-board motion; Devices list with kind and Rotate token"
```

---

### Task 4: Firmware uplink over verified HTTPS

**Files:**
- Create: `firmware/esp32s3-cam/uplink.h`, `firmware/esp32s3-cam/uplink.cpp`
- Modify: `firmware/esp32s3-cam/esp32s3-cam.ino`, `firmware/esp32s3-cam/web_server.cpp`, `firmware/esp32s3-cam/web_page.h`, `firmware/esp32s3-cam/secrets.example.h`, `firmware/esp32s3-cam/README.md`
- Local only (git-ignored, never staged): `firmware/esp32s3-cam/secrets.h`

**Interfaces:**
- Consumes: `JpegFrame(afterSequence, waitMs)` with `ok()/data()/length()/sequence()` and `cameraStartCapture()` (`camera.h`); `motion::snapshot()` → `Snapshot{percent, active, x, y, w, h}` (`motion.h`); `CONSOLE(...)` (`console.h`).
- Produces (`uplink.h`):
```cpp
// Sends the newest JPEG and the board's motion to the NestTrace dashboard over HTTPS (schemas/esp32-frame.v1.md).
// Motion is a viewing aid only; nothing here reaches the digging detector.
#pragma once

#include <Arduino.h>

namespace uplink
{
    struct Status
    {
        const char *state = "off";  // off | no-certificate | waiting-for-wifi | connecting | sending | retrying | no-memory | refused
        uint32_t sent = 0;
        char lastError[96] = "";
    };

    // Moves mbedTLS allocations to PSRAM. Call first in setup(), before Wi-Fi or any TLS.
    void useTlsMemoryInPsram();
    // Starts the uplink task when DASHBOARD_URL is set. Call once, after the first IP address.
    bool begin();
    Status status();
    // Writes the X-NestTrace-Motion value ("v1;percent=4.2;active=1;box=96,40,64,72"); returns snprintf's result.
    int motionHeader(char *out, size_t size, float percent, bool active, uint16_t x, uint16_t y, uint16_t w, uint16_t h);
}
```

- [ ] **Step 1: Secrets fields**

`secrets.example.h`:
```cpp
// Copy this file to secrets.h (git-ignored) and fill in your network.
#pragma once

#define WIFI_SSID "your-network"
#define WIFI_PASSWORD "your-password"

// Dashboard upload. Leave DASHBOARD_URL empty to keep the board standalone.
// Live cameras > Add board camera shows these lines filled in, once.
#define DASHBOARD_URL ""
#define DEVICE_ID ""
#define DEVICE_TOKEN ""
// Caddy's root certificate. In dashboard/: docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt
// Paste its lines (BEGIN to END CERTIFICATE) between the two lines below.
static const char DASHBOARD_CA[] = R"PEM(
)PEM";
```
Add the same seven lines to the local `secrets.h`, keeping its Wi-Fi values. With `DASHBOARD_URL` empty the board behaves exactly as before. `secrets.h` stays git-ignored (`.gitignore:14 firmware/**/secrets.h`).

- [ ] **Step 2: `uplink.cpp`**

```cpp
#include "uplink.h"

#include <HTTPClient.h>
#include <NetworkClientSecure.h>
#include <WiFi.h>
#include "camera.h"
#include "console.h"
#include "esp_heap_caps.h"
#include "freertos/idf_additions.h"
#include "freertos/semphr.h"
#include "mbedtls/platform.h"
#include "motion.h"
#include "secrets.h"

namespace
{
    constexpr uint32_t MIN_INTERVAL_MS = 200;        // at most 5 frames per second
    constexpr uint32_t BACKOFF_FIRST_MS = 2000;
    constexpr uint32_t BACKOFF_MAX_MS = 30000;
    constexpr uint32_t BUSY_WAIT_MS = 1000;          // after 429
    constexpr size_t MIN_INTERNAL_FREE = 12 * 1024;  // sockets and lwIP still use internal RAM
    constexpr uint32_t STACK_BYTES = 12 * 1024;      // in PSRAM; this task never touches flash

    SemaphoreHandle_t statusLock = nullptr;
    uplink::Status current;

    // mbedTLS buffers (2 x 16 KB records plus handshake state) go to PSRAM; internal RAM only as a fallback.
    void *tlsCalloc(size_t count, size_t size)
    {
        void *block = heap_caps_calloc(count, size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
        return block ? block : heap_caps_calloc(count, size, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    }

    void tlsFree(void *block)
    {
        heap_caps_free(block);  // frees from either heap, so blocks made before the switch are fine
    }

    void setState(const char *state, const char *error = nullptr)
    {
        xSemaphoreTake(statusLock, portMAX_DELAY);
        current.state = state;
        if (error)
        {
            // The text goes into /status JSON: keep it printable and free of quotes and backslashes.
            size_t i = 0;
            for (; error[i] && i < sizeof(current.lastError) - 1; i++)
            {
                const char c = error[i];
                current.lastError[i] = (c == '"' || c == '\\' || c < 0x20) ? ' ' : c;
            }
            current.lastError[i] = '\0';
        }
        xSemaphoreGive(statusLock);
    }

    void countSent()
    {
        xSemaphoreTake(statusLock, portMAX_DELAY);
        current.state = "sending";
        current.sent++;
        xSemaphoreGive(statusLock);
    }

    bool hasCertificate()
    {
        return strstr(DASHBOARD_CA, "-----BEGIN CERTIFICATE-----") != nullptr;
    }

    void backOff(uint32_t &backoff)
    {
        delay(backoff);
        backoff = min(backoff * 2, BACKOFF_MAX_MS);
    }

    void uplinkTask(void *)
    {
        NetworkClientSecure tls;
        tls.setCACert(DASHBOARD_CA);  // verified against Caddy's root; there is no insecure mode
        tls.setHandshakeTimeout(15);
        HTTPClient http;
        http.setReuse(true);  // one keep-alive TLS connection for every frame
        http.setConnectTimeout(5000);
        http.setTimeout(5000);
        const String url = String(DASHBOARD_URL) + "/api/live/frame/" + DEVICE_ID;
        const String authorization = String("Bearer ") + DEVICE_TOKEN;

        uint32_t sequence = 0;
        uint32_t lastSend = 0;
        uint32_t backoff = BACKOFF_FIRST_MS;
        while (true)
        {
            if (WiFi.status() != WL_CONNECTED)
            {
                setState("waiting-for-wifi");
                tls.stop();
                delay(1000);
                continue;
            }
            JpegFrame frame(sequence, 1000);  // the next frame newer than the last one sent
            if (!frame.ok())
            {
                continue;
            }
            sequence = frame.sequence();
            const uint32_t since = millis() - lastSend;
            if (since < MIN_INTERVAL_MS)
            {
                delay(MIN_INTERVAL_MS - since);
            }

            if (!tls.connected())
            {
                const size_t internal = heap_caps_get_free_size(MALLOC_CAP_INTERNAL);
                if (internal < MIN_INTERNAL_FREE)
                {
                    char error[64];
                    snprintf(error, sizeof(error), "only %u B internal RAM free", static_cast<unsigned>(internal));
                    CONSOLE("Dashboard upload: %s; retrying in %u s.\n", error, static_cast<unsigned>(backoff / 1000));
                    setState("no-memory", error);
                    backOff(backoff);
                    continue;
                }
                setState("connecting");
            }

            const motion::Snapshot moving = motion::snapshot();
            char motionValue[96];
            uplink::motionHeader(motionValue, sizeof(motionValue), moving.percent, moving.active, moving.x, moving.y, moving.w, moving.h);

            lastSend = millis();
            http.begin(tls, url);
            http.addHeader("Authorization", authorization);
            http.addHeader("Content-Type", "image/jpeg");
            http.addHeader("X-NestTrace-Motion", motionValue);
            const int code = http.POST(const_cast<uint8_t *>(frame.data()), frame.length());
            if (code > 0)
            {
                http.getString();  // read the small JSON reply so the connection can be reused
            }
            http.end();

            if (code == 200)
            {
                countSent();
                backoff = BACKOFF_FIRST_MS;
                continue;
            }
            if (code == 401 || code == 403)
            {
                CONSOLE("Dashboard refused the token (HTTP %d). Check DEVICE_ID and DEVICE_TOKEN in secrets.h; upload stopped.\n", code);
                setState("refused", "Dashboard refused the token");
                tls.stop();
                while (true)
                {
                    delay(60 * 1000);  // stays stopped until reset; a task made WithCaps cannot delete itself
                }
            }
            if (code == 429)
            {
                setState("sending", "HTTP 429: more than 10 frames a second");
                delay(BUSY_WAIT_MS);
                continue;
            }

            char error[96];
            if (code < 0)
            {
                char tlsError[64] = "";
                tls.lastError(tlsError, sizeof(tlsError));
                snprintf(error, sizeof(error), "%s%s%s", HTTPClient::errorToString(code).c_str(), tlsError[0] ? ": " : "", tlsError);
            }
            else
            {
                snprintf(error, sizeof(error), "HTTP %d", code);
            }
            CONSOLE("Dashboard upload failed: %s. Retrying in %u s.\n", error, static_cast<unsigned>(backoff / 1000));
            setState("retrying", error);
            tls.stop();
            backOff(backoff);
        }
    }
}

void uplink::useTlsMemoryInPsram()
{
    mbedtls_platform_set_calloc_free(tlsCalloc, tlsFree);
}

bool uplink::begin()
{
    if (!statusLock)
    {
        statusLock = xSemaphoreCreateMutex();
        if (!statusLock)
        {
            return false;
        }
    }
    if (strlen(DASHBOARD_URL) == 0)
    {
        CONSOLE("Dashboard upload off (DASHBOARD_URL is empty in secrets.h).\n");
        setState("off");
        return true;
    }
    if (strncmp(DASHBOARD_URL, "https://", 8) != 0)
    {
        CONSOLE("Dashboard upload off: DASHBOARD_URL must start with https://\n");
        setState("off", "DASHBOARD_URL must start with https://");
        return false;
    }
    if (!hasCertificate())
    {
        CONSOLE("Dashboard upload off: paste Caddy's root certificate into DASHBOARD_CA (README).\n");
        setState("no-certificate", "DASHBOARD_CA has no certificate");
        return false;
    }
    if (xTaskCreatePinnedToCoreWithCaps(uplinkTask, "uplink", STACK_BYTES, nullptr, 1, nullptr, 0, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT) != pdPASS)
    {
        CONSOLE("Dashboard upload off: could not start its task.\n");
        setState("no-memory", "could not start the uplink task");
        return false;
    }
    CONSOLE("Dashboard upload: %s as device %s\n", DASHBOARD_URL, DEVICE_ID);  // never the token
    return true;
}

uplink::Status uplink::status()
{
    if (!statusLock)
    {
        return Status{};
    }
    xSemaphoreTake(statusLock, portMAX_DELAY);
    const Status copy = current;
    xSemaphoreGive(statusLock);
    return copy;
}

int uplink::motionHeader(char *out, size_t size, float percent, bool active, uint16_t x, uint16_t y, uint16_t w, uint16_t h)
{
    const float clamped = percent < 0 ? 0 : (percent > 100 ? 100 : percent);
    if (!active)
    {
        x = y = w = h = 0;  // the contract sends 0,0,0,0 when nothing moves
    }
    return snprintf(out, size, "v1;percent=%.1f;active=%d;box=%u,%u,%u,%u", clamped, active ? 1 : 0, x, y, w, h);
}
```

- [ ] **Step 3: Wire it into the sketch**

`esp32s3-cam.ino`:
- `#include "uplink.h"`.
- First line of `setup()` after `Serial.begin(115200); delay(1500);` and the start message: `uplink::useTlsMemoryInPsram();` with the comment `// before Wi-Fi: TLS must not take the internal RAM the camera and Wi-Fi need`.
- In the anonymous namespace: `bool uplinkStarted = false;`.
- In `loop()`, inside `if (serversStarted)` before `announce()`: `if (!uplinkStarted) { uplinkStarted = true; uplink::begin(); }`.
- `announce()` gains one line, `CONSOLE("Dashboard:     %s\n", uplink::status().state);`.

- [ ] **Step 4: `/status` and the camera page**

`web_server.cpp` `sendStatus`: `#include "uplink.h"`, grow `body` to `char body[768]`, read `const uplink::Status up = uplink::status();`, and append before the final `}`:
```cpp
",\"uplink\":{\"state\":\"%s\",\"sent\":%lu,\"lastError\":\"%s\"}"
```
with arguments `up.state, static_cast<unsigned long>(up.sent), up.lastError` (`lastError` is already free of quotes and backslashes).

`web_page.h`: add `<div><dt>Dashboard</dt><dd id="uplink">-</dd></div>` as the last `<dl>` row. In `refreshStatus()`:
```js
      if (s.uplink) {
        const u = s.uplink;
        $('uplink').textContent = u.state === 'off' ? (u.lastError ? `off: ${u.lastError}` : 'off (standalone)')
          : u.state === 'sending' ? `sending · ${u.sent} frames${u.lastError ? ` · last problem: ${u.lastError}` : ''}`
          : `${u.state}${u.lastError ? `: ${u.lastError}` : ''}`;
      }
```

- [ ] **Step 5: README**

`firmware/esp32s3-cam/README.md`:
- The opening paragraph becomes: "Camera firmware for field tests. The board serves a camera page, a JPEG snapshot, a status JSON and an MJPEG stream on the local Wi-Fi, and can also send its picture and on-board motion to the NestTrace dashboard (optional). It never talks to the research pipeline."
- Add the `/status` row text "...free heap, dashboard upload (`uplink.state`, `uplink.sent`, `uplink.lastError`)".
- New section **Send to the dashboard**:
  1. On the dashboard (admin): **Live cameras > Add board camera**, give it a name, and copy the `secrets.h` lines shown once into `secrets.h` below the Wi-Fi lines. If the token is lost, use **Rotate token** in the Devices list.
  2. Copy Caddy's root certificate (in `dashboard/`): `docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt`. Paste the printed lines, from `-----BEGIN CERTIFICATE-----` to `-----END CERTIFICATE-----`, between `R"PEM(` and `)PEM"` in `secrets.h`. The board checks the dashboard against this certificate; there is no way to skip the check. If the Caddy volume is recreated, copy the new certificate.
  3. Board, laptop and phones must be on the same 2.4 GHz-capable Wi-Fi, and `DASHBOARD_URL` must use the laptop's address on that network (`LAN_HOST` in `dashboard/.env`).
  4. Upload. The Serial Monitor prints `Dashboard upload: https://... as device ...`. The camera page's **Dashboard** row shows `sending · N frames`, and the board appears under **Live cameras**.
  5. What it sends: the newest JPEG at most 5 times a second, and the header `X-NestTrace-Motion` (`schemas/esp32-frame.v1.md`). On errors it waits 2 s, doubling to 30 s; on HTTP 429 it waits 1 s. If the dashboard refuses the token (401/403), it stops and logs `Dashboard refused the token`. Fix `DEVICE_ID`/`DEVICE_TOKEN` and press reset.
  6. **If the Dashboard row says `no-memory` or a TLS memory error.** TLS needs about 40 KB. The firmware already moves mbedTLS to PSRAM and keeps the uplink stack there; only about 21 KB of internal RAM is left after the camera and Wi-Fi. If it still fails, choose one:
     - **A.** Remove `FRAMESIZE_QVGA` from `RAW_SIZES` in `camera.cpp`. The raw picture drops to 240×176 and frees about 66 KB of internal RAM.
     - **B.** Leave `DASHBOARD_URL` empty and use a phone as the live camera.
     There is no unencrypted or unchecked mode.
- Privacy section: add "The device token in `secrets.h` lets anyone who has it send pictures as this board. Keep `secrets.h` out of git (it is ignored) and rotate the token if it leaks."

- [ ] **Step 6: Compile and guard**

```bash
"/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli" compile -b "esp32:esp32:esp32s3:PSRAM=opi,FlashSize=8M,PartitionScheme=default_8MB,CDCOnBoot=cdc" firmware/esp32s3-cam
grep -rn "setInsecure" firmware/esp32s3-cam
grep -rn "DEVICE_TOKEN" firmware/esp32s3-cam --include=*.cpp --include=*.ino
```
Expected: the compile succeeds with no warnings from the new files. The first grep prints nothing. The second prints only the `authorization` line in `uplink.cpp`, so no `CONSOLE` line ever prints the token. Compile once with the local `secrets.h` having `DASHBOARD_URL ""` (standalone) and once with a filled block from Task 5 Step 2.

- [ ] **Step 7: Commit**

```bash
git add firmware/esp32s3-cam/uplink.h firmware/esp32s3-cam/uplink.cpp firmware/esp32s3-cam/esp32s3-cam.ino firmware/esp32s3-cam/web_server.cpp \
  firmware/esp32s3-cam/web_page.h firmware/esp32s3-cam/secrets.example.h firmware/esp32s3-cam/README.md
git status --short firmware   # secrets.h must not appear as staged
git commit -m "feat(firmware): send frames and on-board motion to the dashboard over verified HTTPS"
```

---

### Task 5: LAN_HOST, docs, end-to-end with a fake board, then the real board

**Files:**
- Modify: `dashboard/README.md`, `CLAUDE.md`, `agent.md`
- Local only (never committed): `dashboard/.env` (`LAN_HOST`), `firmware/esp32s3-cam/secrets.h`
- Scratchpad only: `<scratchpad>/plan-f/e2e.mjs`, `<scratchpad>/plan-f/root.crt`, screenshots

- [ ] **Step 1: LAN_HOST (local only)**

`dashboard/.env` must contain `LAN_HOST=10.47.138.152` (it already does at the time of writing; check with `grep '^LAN_HOST=' dashboard/.env`). Confirm the laptop's address on "San" with `ipconfig getifaddr en0`. If it changed, set `LAN_HOST` to the new address here and in the board's `DASHBOARD_URL`. Then `cd dashboard && docker compose up -d --build` (this recreates `caddy` with the new `LAN_HOST` and rebuilds `web` with the migration). Check with `curl --cacert <(docker compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt) -sI https://10.47.138.152:3443/login | head -1`. Expected: `HTTP/2 200`. **Never stage `dashboard/.env`.**

- [ ] **Step 2: Docs**

- `dashboard/README.md`, new section **ESP32 camera boards** after **Live phone cameras**:
  1. An admin opens **Live cameras > Add board camera** and names the board. The dialog shows the device id and a token **once**, as `secrets.h` lines with `DASHBOARD_URL` from `LAN_HOST`. Only a SHA-256 hash of the token is stored. **Rotate token** in the Devices list issues a new one (the old one stops working), and **Remove** stops the board. Both are audited (`device.create`, `device.rotate`, `device.remove`) without the token.
  2. Paste the lines into `firmware/esp32s3-cam/secrets.h`, add Caddy's root certificate (`docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt`), and upload the firmware (see `firmware/esp32s3-cam/README.md`).
  3. The board POSTs JPEGs to `/api/live/frame/<id>` with `Authorization: Bearer <token>` and the `X-NestTrace-Motion` header (`schemas/esp32-frame.v1.md`), at most 5 per second. It then behaves like a phone: tile, Motion view, recording, Source linking.
  4. Board tiles show **Moving x%** / **Still** and the motion box, labelled "Motion measured on the camera board". It is a viewing aid: no alerts, never the detector. The badge refreshes with the device list (about every 3 s).
  5. Board, laptop and phones must share one 2.4 GHz-capable network. `LAN_HOST` must be the laptop's address on it.
- `CLAUDE.md`, one paragraph after the phone paragraph: "ESP32 board: on `/live` an admin uses Add board camera, pastes the shown `secrets.h` lines plus Caddy's root certificate into `firmware/esp32s3-cam/secrets.h` (git-ignored, never staged), and compiles with the arduino-cli command in the firmware README. The board pushes frames with a bearer device token and the `esp32-frame.v1` motion header (`schemas/esp32-frame.v1.md`)."
- `agent.md`, Real dashboard paragraph, one sentence after the phone sentence: "ESP32 camera boards send the same kind of frames with a per-device token and an on-board motion header (`schemas/esp32-frame.v1.md`); their footage follows the same rules, and on-board motion is a viewing aid that never reaches the detector or raises alerts."

- [ ] **Step 3: End-to-end with a fake board (Playwright, through Caddy)**

Copy the CA for Node: `cd dashboard && docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt <scratchpad>/plan-f/root.crt`. Run the script with `NODE_EXTRA_CA_CERTS=<scratchpad>/plan-f/root.crt node <scratchpad>/plan-f/e2e.mjs`. The fake board verifies TLS exactly like the real one; nothing disables certificate checks in Node. The browser context uses `ignoreHTTPSErrors: true` only for the Playwright pages.

The script imports `chromium` from `/Users/segfault/Documents/islanderhack2026/nesttrace/node_modules/playwright/index.mjs` and reads `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` from `dashboard/.env`. Steps and assertions:
1. **Admin sign-in** (desktop context): goto `https://localhost:3443/login`, fill the two fields, press **Sign in**, then goto `/live`.
2. **Add board:** click **Add board camera**, fill **Board name** with `E2E board`, press **Add**. Read `Device id` and `Device token` from the dialog. Assert the token matches `/^[A-Za-z0-9_-]{43}$/` and the `secrets.h lines` contain `#define DASHBOARD_URL "https://10.47.138.152:3443"`. Press **Done**. Assert the token text is no longer in the page.
3. **Frames to send:** in the same page, `page.evaluate` draws twenty 320×240 canvases (grey sand colour, a dark 64×72 square moving 8 px per frame) and returns `canvas.toDataURL('image/jpeg', 0.7)` for each. Node decodes them to Buffers.
4. **Fake board:** `fetch('https://localhost:3443/api/live/frame/' + id, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'image/jpeg', 'x-nesttrace-motion': header }, body })` every 200 ms. For 8 s it sends `v1;percent=4.2;active=1;box=<x>,40,64,72` (x follows the square), then for 8 s `v1;percent=0.3;active=0;box=0,0,0,0`. Every response must be 200.
5. **Tile:** within 4 s an article `E2E board` appears. Its img `naturalWidth` is 320 and its `src` changes at least 3 times in 2 s. It shows `Moving 4.2%`, `Motion measured on the camera board` and an `svg rect` with `width="64"`. After the switch, `Still` appears within 5 s and the rect is gone.
6. **Refusals:** a POST with a fresh random 43-character token → 401. A POST to that id with no Authorization and no cookie → 401. A POST with the board's token and the header `x-nesttrace-motion: garbage` → 200.
7. **Rotate:** in the Devices list, **Rotate token for E2E board** → **Rotate**, and read the new token from the dialog. The old token → 401 and the new token → 200. Close with Escape.
8. **Recording:** within 40 s, `GET /api/live/recordings` (desktop context `request`) lists a recording with `deviceName: 'E2E board'`.
9. **Audit:** `docker compose exec -T db psql -U nesttrace -At -c "select action, details from \"AuditLog\" where action in ('device.create','device.rotate') order by \"createdAt\" desc limit 2"` shows both actions. Neither the old nor the new token, nor their SHA-256, appears in the output (the script checks this).
10. **Remove:** **Remove E2E board** → **Remove**. The new token → 401, and the tile disappears within 15 s.
11. Screenshots of steps 2, 5 (moving and still) and 7 go to `<scratchpad>/plan-f/`.

Expected: every assertion passes. On failure, fix the owning task's code (with a test) and rerun; do not loosen the assertions.

- [ ] **Step 4: Full verification**

```bash
cd dashboard/web && npm run db:test:prepare && npx vitest run && npx tsc --noEmit && npx next build
cd ../.. && npm test        # research suite, untouched by this plan, must still pass
"/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli" compile -b "esp32:esp32:esp32s3:PSRAM=opi,FlashSize=8M,PartitionScheme=default_8MB,CDCOnBoot=cdc" firmware/esp32s3-cam
git status --short          # no .env, secrets.h, recordings, artifacts, media or .superpowers entries staged
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/README.md CLAUDE.md agent.md
git commit -m "docs: ESP32 camera boards on the dashboard"
```

- [ ] **Step 6: Real board (with the user)**

Ask the user to do this, then record the results in the task notes:
1. Add a board named `Board 1` on `/live`. Paste the lines and the CA into `secrets.h` and upload with `arduino-cli upload -b "esp32:esp32:esp32s3:PSRAM=opi,FlashSize=8M,PartitionScheme=default_8MB,CDCOnBoot=cdc" -p <port> firmware/esp32s3-cam` (close the Serial Monitor first).
2. The Serial Monitor shows `Dashboard upload: https://10.47.138.152:3443 as device ...` and no token. `http://<board-ip>/status` shows `uplink.state: "sending"` with `sent` rising. Note `freeHeap` and whether `lastError` ever showed a memory error. If it did, apply README fallback A and repeat, and write down which fallback was used.
3. `/live` shows the `Board 1` tile. Waving a hand in front of the camera turns the badge to `Moving x%` with a box within about 3 s, and back to `Still` after.
4. Link the board to camera `E1` via **Source** (Setup > Cameras). The map panel for E1 shows **LIVE** with the board's picture.
5. After about 10 minutes (or a 10 s pause in sending), a recording for `Board 1` appears in **Recordings** and plays (mp4).
6. Rotate the token on `/live` without updating the board. The Serial Monitor logs `Dashboard refused the token (HTTP 401)...`, the camera page shows `refused`, and the tile goes offline. Paste the new token, upload again, and the tile returns.

---

## Self-review

**Spec coverage**
- §1 approach A (push, token instead of session, phone path unchanged after auth, motion in a versioned header): T1 (bearer path reuses `readCapped`/`isJpeg`/`FrameStore`/`touchDevice`/`Recorder`), contract file first (T1 Step 1). Boundaries: no simulator or private paths, motion raises no alerts and never reaches the detector (constraints, README wording T4/T5), same recording rules (unchanged recorder).
- §2 tokens:
  - `kind` + unique `tokenHash` → T1 schema; "phones never have a token" → T1 CHECK and test.
  - Add board camera (admin, shown once, device id, `secrets.h` block, `device.create`) → T2 actions + T3 dialog.
  - Rotate (shown once, audited) → T2/T3. Remove (existing `disabledAt` + `forget`) → unchanged `removePhone`, board copy in T3, and the removed-board 401 in T1.
  - Bearer accepted only for its own BOARD and not removed, constant time, 401 otherwise, other rules unchanged → T1.
  - Tokens never in logs, audit, snapshot or devices API → T1 boundary test + explicit `select`; T2 audit test.
- §3 header: exact format, optional, malformed or unknown ignored, stored in memory beside the frame, `motion: { percent, active, box, at }` for boards → T1. Badge "Moving 4.2%" / "Still", box when active, label → T3.
- §4 firmware:
  - `secrets.h` fields and empty URL = standalone → T4 Step 1, `uplink::begin`.
  - Task on core 0 at low priority, sequence-based, ≤ 5/s, HTTPS + bearer + header, keep-alive → T4 Step 2.
  - 401/403 stop + log, backoff 2 → 30 s, 429 waits 1 s → T4 Step 2.
  - CA verification with no insecure mode, README CA command → T4 Steps 2/5/6.
  - `/status` uplink and page → T4 Step 4.
- §5 network: `LAN_HOST` 10.47.138.152 (local `.env`), Caddy covers it, shared 2.4 GHz note → T5 Steps 1–2, firmware README.
- §6 testing:
  - Every dashboard bullet maps to a named test. Create (shown once, hash, audit without token) → T2. Bearer accepted for own board and rejected for another device, a phone, a removed board or a wrong token → T1. Constant time → T1 unit. Rotate invalidates → T2. Header parse cases → T1 unit. Devices API motion without token → T1. Admin-only → T2.
  - Firmware compile → T4; real-board checks (tile, badge, E1 LIVE, recording, refusal log) → T5 Step 6.
  - Playwright fake board through `https://localhost:3443` → T5 Step 3.
- §7 out of scope: no pulling, no object detection, no audio, no OTA; the stream server stays single-viewer.

**Placeholder scan:** no TBD/TODO. The migration folder name uses the timestamp Prisma generates; the plan gives its exact SQL and the `git add` glob. UI steps for T3 use explicit behaviour lists with DOM tests pinning the load-bearing parts, as in Plans C and E.

**Type consistency:**
- `BoardMotion` (frameStore) is produced by `parseMotionHeader` and consumed by `FrameStore.put/motion` and `listDevices`.
- `BoardMotionView` / `LiveDeviceView.kind/.motion` (types) are consumed by `LiveScreen` (`MotionBadge`, `MotionBox`, `DeviceRow`).
- `IssuedToken` (boards) → `IssuedTokenResult` (actions) → `AddBoardDialog` / `IssuedTokenDialog`.
- `FrameAccess.status` widened to `401 | 403 | 404`, used only in `postFrame`.
- Firmware: `uplink::Status` is read by `sendStatus`; `motionHeader` output matches the `V1` regex in `motionHeader.ts` (`%.1f`, `%d`, `%u`, no spaces).

**Review Focus:** each of the five items names its owning task and test file.

### Spec ambiguities resolved in this plan
1. A BOARD reached **without** a bearer token gets 401 for every session role, VIEWER included, as the spec's "missing token on a BOARD → 401" says. A request **with** a bearer token is judged only on the token; any session is ignored.
2. Every bearer failure is 401, including an unknown device id and a removed board. This does not reveal whether an id exists, and the board stops on it either way.
3. The motion header is read only on the bearer path. A phone that sends it gets `motion: null`.
4. Strict v1 grammar: fixed field order, exactly one decimal, box values ≤ 65535, at most 160 characters. Anything else is "malformed" and ignored.
5. A frame without a valid header clears the stored motion (it is stored *beside the newest frame*), so a stale "Moving" never sticks.
6. `registerDevice` matches `PHONE` rows only, so a phone named like a board never takes over the board.
7. A database CHECK enforces "boards have a hash, phones never do". This goes beyond the spec, which only says phones never have a token.
8. Audit details: `device.create` → `{ name, kind: 'BOARD' }` and `device.rotate` → `{ name }`, never the token or its hash.
9. `DASHBOARD_CA` is a raw-string array (`static const char DASHBOARD_CA[] = R"PEM(...)PEM";`) rather than a `#define`, because a PEM spans lines. An empty CA keeps the uplink off with state `no-certificate`; it never connects unverified.
10. An `http://` `DASHBOARD_URL` is refused at start (state `off` with a reason), so plain HTTP cannot be configured.
11. On 401/403 the uplink stays stopped until reset, so a rotated token never makes the board hammer the dashboard.
12. 413/415/other 4xx and 5xx are handled like network errors (backoff). The spec names only network errors, 429 and 401/403.
13. The box is sent as `0,0,0,0` whenever `active=0`, even if the board's last box is still in memory, matching "0,0,0,0 when none".
14. TLS memory: mbedTLS moves to PSRAM at boot, and the uplink stack lives in PSRAM. Fallbacks A (smaller raw picture) and B (standalone) are documented choices for the user. There is no insecure option.
15. The motion badge refreshes with the existing 3 s devices poll (the spec's channel); no motion is added to `GET frame`.
16. `LAN_HOST` is already `10.47.138.152` in the local `.env`. The plan verifies it and the address on "San" rather than committing anything.
17. The secrets block is generated in the server-action response only and is not cached in page props or the RSC payload. Closing the dialog drops it from client state.
