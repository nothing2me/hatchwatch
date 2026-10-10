# NestTrace Dashboard — Plan E: Live Phone Cameras — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in volunteer or admin opens `https://<LAN_HOST>:3443/cam` on a phone on the same Wi-Fi. The phone posts JPEG frames, and every role can watch them on a new **Live cameras** page, as live tiles or in a browser-side motion view. An admin can link a phone to any map camera; that camera's panel then shows the live picture. The `web` process records every online phone to 10-minute MP4 segments that are kept for 72 h.

**Architecture:** A `caddy` Compose service terminates HTTPS on `0.0.0.0:3443` (internal CA) and proxies to `web:3000`. `web` stays on `127.0.0.1:3000` and `db` on `127.0.0.1:5433`. Phones register a `LiveDevice` row and POST frames to `/api/live/frame/<id>`. The newest frame per device lives in an in-memory `FrameStore` (a `globalThis` singleton in the single `web` process). Viewers poll `GET /api/live/frame/<id>` at about 5 Hz with `If-None-Match`. The same POST hands each frame to a `Recorder` started from `instrumentation.ts`. The recorder lays frames on a 5 fps wall-clock timeline (`Segmenter`) and writes MJPEG AVI (`AviWriter`). On close it converts each segment with `ffmpeg` to H.264 MP4 and writes a JSON sidecar. Route handlers are thin: they call injected-dependency handlers in `src/lib/phones/*`, so integration tests drive them against the test database without mocking Next. Linking reuses the camera-edit pattern (`requireCurrentUser('ADMIN')`, `CameraEditError`, `AuditLog`, `publishChange('cameras')`).

**Tech Stack:** Next.js 16.4.0 App Router, React 19.3.0, TypeScript 5.9.3, Tailwind v4, Prisma 7.10.0 + Postgres 16, zod 4.6.5, Vitest 5.0.3 (node + jsdom projects), `caddy:2`, `ffmpeg` (Debian package in the web image), `qrcode` 1.5.4 + `@types/qrcode` 1.5.6 (new, exact pins), browser `getUserMedia` / canvas / Screen Wake Lock, Playwright (repo-root `node_modules/playwright`) with Chrome fake media for the end-to-end check.

**Spec:** `docs/superpowers/specs/2026-10-10-live-phone-cameras-design.md` (binding). Boundaries: `agent.md`, `CLAUDE.md`. Reference only (never merged or cherry-picked): `origin/live-phone-cameras` by elpaelpa, commits `3981767` and `4b313f1`. Files: `dashboard/server/recorder.mjs`, `dashboard/server/server.mjs`, `dashboard/src/camera/CameraSender.jsx`, `dashboard/src/motion/{MotionView.jsx,motionDifference.js}`, `dashboard/src/data/useLiveFrame.js`, `dashboard/src/components/{CamerasView,RecordingsPanel}.jsx`. Read them with `git show origin/live-phone-cameras:<path>`.

## Global Constraints

- **Frames:** body `image/jpeg`, **≤ 500 KB** (`500 * 1024` bytes; larger → 413, checked while streaming, not after buffering). Rate cap **10 frames/s per device** (sliding 1 s window; excess → 429). Newest frame per device kept **in memory in the one `web` process** (no second instance). `lastSeenAt` written **at most once per 5 s**. **Online = a frame within the last 10 s**; `GET` frame → 404 otherwise. `GET` frame: `Cache-Control: no-store`, `X-Frame-At`, `ETag` on the frame time, 304 on match.
- **Who may do what:** sending (register device, POST frame) needs VOLUNTEER or ADMIN. The caller must own the device or be ADMIN. A VIEWER gets 403 and signed-out callers get 401. Watching (GET frame, GET devices, `/live`, `/live/motion`) is open to any signed-in role. Linking a source, removing a phone, and the Recordings list and files are ADMIN only, with the role **re-read from the DB** (`requireCurrentUser('ADMIN')` / `currentUserOrNull()`).
- **Polling:** viewers poll frames at **~5 Hz** (object-URL swap, previous URL revoked; one spare kept). `/live` polls `GET /api/live/devices` **every 3 s**. The phone sends at most **5 frames/s**.
- **Phone page presets:** Standard **960×540 q0.7**, High **1280×720 q0.8**. Rear camera by default. The device name is remembered in `localStorage` key `nesttrace.phoneName`.
- **Recording:** MJPEG AVI at a fixed **5 fps** on the real clock. A gap is filled by repeating the last frame; a **gap over 10 s closes the segment**; a new file starts every **10 min**. The sidecar JSON holds device id and name, the linked camera code at start, the real start time, fps and frame count. On close, `ffmpeg` converts the segment to H.264 `.mp4` and deletes the `.avi`. Leftover `.avi` files are converted at start-up. Without ffmpeg the `.avi` stays. Layout: `RECORDINGS_ROOT/<deviceId>/<YYYY-MM-DD>/<HHMMSS>.mp4` (UTC). Retention is `RECORDING_RETENTION_HOURS` (default **72**), swept **hourly**. `RECORDING=off` disables recording.
- **Network:** `caddy` listens on **`0.0.0.0:3443`** and is the only service reachable from the LAN. `web` stays **`127.0.0.1:3000`** and `db` stays **`127.0.0.1:5433`**. Caddy uses `tls internal`, `flush_interval -1` (SSE unbuffered) and a request body limit of **1 MB**. Session cookies are `Secure` whenever `X-Forwarded-Proto: https`. `LAN_HOST` builds `https://${LAN_HOST}:3443/cam`.
- **Boundary:** nothing under `dashboard/` imports or references the simulator (`web/`), the research API (`scripts/server.mjs`, port 5174), seeds, `pipeline/`, or any `private/` path. Phone frames and recordings never reach any detector. Recordings are real beach footage: local disk only, git-ignored, never published or committed. Frozen research files (`pipeline/*`, `config/*`, `results/*`, `*RESULTS.md`) are untouched.
- **Alert wording unchanged:** `Digging activity detected; nesting unresolved.`
- **Commits:** only the user as author; **no `Co-Authored-By` and no AI attribution** in any message. Stage explicit paths only. **Never stage** `artifacts/`, `dashboard/media/`, `dashboard/recordings/`, `.superpowers/`, any `.env`. The first commit that ports teammate logic (Task 2) credits elpaelpa's commits `3981767` and `4b313f1` in its message **body** (plain sentence, not a trailer). Tasks 3–6 repeat that sentence because they port more of the same work.
- **Code style:** follow the existing files: Allman braces, 4-space indent, single quotes, `@/` imports, one-line comments only where the reason is not obvious.

## Review Focus

1. **The frame POST accepts what it should refuse.** Examples: a VIEWER, another volunteer's phone, a removed phone, a disabled user, an oversize body sent without `Content-Length` and buffered whole, or an 11th frame in one second. Pinned in **Task 2** `tests/integration/live-phones.test.ts` (`frames` block: auth matrix, streamed 413, 429) and `tests/unit/frameStore.test.ts`.
2. **The recording timeline drifts from real time.** Examples: gaps not filled with the last frame, two frames written into one slot, a 10 s gap not closing the segment, a missing 10-minute roll, or a camera code that changes mid-segment. Pinned in **Task 3** `tests/unit/segmenter.test.ts` (fake clock, fake sink).
3. **Unplayable files after a kill or without ffmpeg.** A `docker compose stop` or crash can leave `.avi.part` files with no index forever, a failed conversion can delete the only copy, or a sidecar can point at a missing file. Pinned in **Task 3** `tests/unit/avi.test.ts` (`repairAvi` on a truncated file) and **Task 4** `tests/unit/recorder.test.ts` (recovery at start-up, fake ffmpeg success/failure).
4. **The recordings route leaks files or footage.** Examples: path traversal (`..`, absolute, encoded, wrong extension, `.part`), non-admin access, or broken `Range`. Pinned in **Task 4** `tests/unit/recordingPaths.test.ts` and `tests/unit/recordings-http.test.ts`.
5. **Viewers leak memory or freeze on a dead phone.** Examples: object URLs never revoked on a tile left open for hours, or a map panel stuck on the last frame instead of "Phone offline" with the simulation loop. Pinned in **Task 6** `tests/unit/framePoller.test.ts` (revocation, 404 → offline) and **Task 7** `tests/unit/cameraPanelLive.test.tsx` (LIVE vs offline fallback).

---

## File Structure

```
dashboard/
  Caddyfile                                   T1  HTTPS :3443 → web:3000
  docker-compose.yml                          T1 caddy service; T4 recordings mount
  .env.example                                T1 LAN_HOST; T4 RECORDINGS_ROOT, RECORDING, RECORDING_RETENTION_HOURS
  .gitignore                                  T1 /recordings/
  README.md                                   T8 Live phone cameras section
  web/
    Dockerfile                                T8 + ffmpeg
    package.json, package-lock.json           T6 qrcode 1.5.4, @types/qrcode 1.5.6
    prisma/schema.prisma (+ migration)        T2 LiveDevice, Camera.liveDeviceId
    src/instrumentation.ts                    T4 start recorder
    src/lib/auth/requestSecurity.ts           T1 isHttpsRequest
    src/lib/auth/session.ts                   T1 sessionCookieOptions({ secure })
    src/lib/auth/safeNext.ts                  T5 login return path
    src/lib/phones/frameStore.ts              T2 FrameStore, limits
    src/lib/phones/body.ts                    T2 readCapped, isJpeg
    src/lib/phones/devices.ts                 T2 register/access/list; T7 removeDevice
    src/lib/phones/http.ts                    T2 route handlers (DI)
    src/lib/phones/avi.ts                     T3 MJPEG AVI writer, repair, jpegSize
    src/lib/phones/segmenter.ts               T3 5 fps wall-clock timeline
    src/lib/phones/recordingPaths.ts          T4 layout + path validation
    src/lib/phones/recorder.ts                T4 Recorder service, ffmpeg, retention, singleton
    src/lib/phones/recordingsHttp.ts          T4 list + file handlers
    src/lib/phones/connect.ts                 T6 connectUrl(LAN_HOST)
    src/lib/cameras/manage.ts                 T7 setCameraSource, CameraRow.liveDevice*
    src/lib/users/manage.ts                   T7 unlink on disable
    src/lib/types.ts                          T2 LiveDeviceView; T4 RecordingView; T7 CameraView.liveDevice
    src/server/snapshot.ts                    T7 camera.liveDevice
    src/app/api/live/devices/route.ts         T2
    src/app/api/live/frame/[deviceId]/route.ts T2
    src/app/api/live/recordings/route.ts      T4
    src/app/api/live/recordings/[...path]/route.ts T4
    src/app/cam/page.tsx                      T5 (outside (app): own sign-in redirect with next)
    src/app/(auth)/login/{page.tsx,LoginForm.tsx,actions.ts} T1 secure cookie; T5 next
    src/app/(app)/live/page.tsx               T6
    src/app/(app)/live/motion/page.tsx        T6
    src/app/(app)/live/actions.ts             T7 removePhone
    src/app/(app)/camera-actions.ts           T7 setCameraSource
    src/features/phones/camMessages.ts        T5
    src/features/phones/CamSender.tsx         T5
    src/features/phones/framePoller.ts        T6
    src/features/phones/useLiveFrame.ts       T6
    src/features/phones/useLiveDevices.ts     T6
    src/features/phones/LiveScreen.tsx        T6 (+T7 phones list)
    src/features/phones/ConnectPhone.tsx      T6
    src/features/phones/RecordingsPanel.tsx   T6
    src/features/phones/motion.ts             T6
    src/features/phones/MotionScreen.tsx      T6
    src/features/phones/SourceSelect.tsx      T7
    src/features/shell/TopBar.tsx             T6 Live cameras item
    src/features/cameras/CameraPanel.tsx      T7 LIVE / offline / Source
    src/features/cameras/CamerasScreen.tsx    T7 Source column
    src/features/map/MapScreen.tsx            T7 canEditSource
    tests/boundary.test.ts                    T1 skip recordings/
```

`src/lib/live/*` and `src/features/live/*` already belong to the simulator live-chunk feed. Phone code goes in `phones/` folders so the two are never confused. The URLs stay `/api/live/*` and `/live` as the spec says.

---

### Task 1: HTTPS on the LAN via Caddy, secure cookies, `LAN_HOST`, recordings ignored

**Files:**
- Create: `dashboard/Caddyfile`, `dashboard/web/src/lib/auth/requestSecurity.ts`, `dashboard/web/tests/unit/requestSecurity.test.ts`
- Modify: `dashboard/docker-compose.yml`, `dashboard/.env.example`, `dashboard/.gitignore`, `dashboard/web/src/lib/auth/session.ts`, `dashboard/web/src/app/(auth)/login/actions.ts`, `dashboard/web/tests/unit/session.test.ts`, `dashboard/web/tests/boundary.test.ts`

**Interfaces:**
- Consumes: `sessionCookieOptions()` (today, no args) in `src/lib/auth/session.ts`; `loginAction` in `src/app/(auth)/login/actions.ts`.
- Produces: `isHttpsRequest(headers: Headers): boolean`; `sessionCookieOptions(options?: { secure?: boolean }): { httpOnly: true; sameSite: 'lax'; secure: boolean; path: '/'; maxAge: number }`, where `secure` = `options.secure === true || (NODE_ENV === 'production' && INSECURE_COOKIES !== '1')`.

- [ ] **Step 1: Failing tests**

`tests/unit/requestSecurity.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isHttpsRequest } from '@/lib/auth/requestSecurity';

describe('isHttpsRequest', () =>
{
    it('trusts the first X-Forwarded-Proto value from Caddy', () =>
    {
        expect(isHttpsRequest(new Headers({ 'x-forwarded-proto': 'https' }))).toBe(true);
        expect(isHttpsRequest(new Headers({ 'x-forwarded-proto': 'HTTPS, http' }))).toBe(true);
        expect(isHttpsRequest(new Headers({ 'x-forwarded-proto': 'http' }))).toBe(false);
        expect(isHttpsRequest(new Headers())).toBe(false);
    });
});
```
Append to `tests/unit/session.test.ts` (merge `sessionCookieOptions` into the existing import from `@/lib/auth/session`):
```ts
describe('sessionCookieOptions', () =>
{
    it('is Secure for HTTPS requests even with INSECURE_COOKIES=1', () =>
    {
        const previous = process.env.INSECURE_COOKIES;
        process.env.INSECURE_COOKIES = '1';
        try
        {
            expect(sessionCookieOptions({ secure: true }).secure).toBe(true);
            expect(sessionCookieOptions().secure).toBe(false);
        }
        finally
        {
            if (previous === undefined) delete process.env.INSECURE_COOKIES; else process.env.INSECURE_COOKIES = previous;
        }
    });
});
```
Run: `cd dashboard/web && npx vitest run tests/unit/requestSecurity.test.ts tests/unit/session.test.ts`. Expected: FAIL (module not found; `sessionCookieOptions` takes no options).

- [ ] **Step 2: Implement**

`src/lib/auth/requestSecurity.ts`:
```ts
// Caddy terminates TLS on :3443 and sets X-Forwarded-Proto. Port 3000 is loopback-only, so the header is trusted.
export function isHttpsRequest(headers: Headers): boolean
{
    return (headers.get('x-forwarded-proto') ?? '').split(',')[0].trim().toLowerCase() === 'https';
}
```
`src/lib/auth/session.ts`: replace `sessionCookieOptions`:
```ts
export function sessionCookieOptions(options: { secure?: boolean } = {})
{
    return {
        httpOnly: true as const,
        sameSite: 'lax' as const,
        secure: options.secure === true || (process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== '1'),
        path: '/' as const,
        maxAge: SESSION_TTL_SECONDS,
    };
}
```
`src/app/(auth)/login/actions.ts`: `import { cookies, headers } from 'next/headers';`, `import { isHttpsRequest } from '@/lib/auth/requestSecurity';` and set the cookie with `sessionCookieOptions({ secure: isHttpsRequest(await headers()) })`.

`tests/boundary.test.ts`: add `'recordings'` to `skipDirectories`.

Run: `npx vitest run tests/unit` → PASS (all unit tests, including `login-action.test.ts`, which tests `authenticate` only).

- [ ] **Step 3: Caddy, Compose, env, ignore**

`dashboard/Caddyfile`:
```
{
	# Caddy's own CA; never contacts ACME. Phones see a one-time certificate warning (README).
	local_certs
	auto_https disable_redirects
	# Phones that open an IP address send no SNI; serve the LAN_HOST certificate to them.
	default_sni {$LAN_HOST}
}

https://{$LAN_HOST}:3443, https://localhost:3443 {
	tls internal
	request_body {
		max_size 1MB
	}
	reverse_proxy web:3000 {
		# Server-sent events (/api/stream) must not be buffered.
		flush_interval -1
	}
}
```
`dashboard/docker-compose.yml`: add this service and leave `db` and `web` ports unchanged. `web` already receives `LAN_HOST` through `env_file: .env`.
```yaml
  caddy:
    image: caddy:2
    environment:
      LAN_HOST: ${LAN_HOST:-127.0.0.1}
    ports:
      - "0.0.0.0:3443:3443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
    depends_on:
      - web
```
and `caddy_data:` under the top-level `volumes:`.

`dashboard/.env.example`: append
```bash
# Laptop LAN IP for phone cameras (macOS: ipconfig getifaddr en0). Phones open https://LAN_HOST:3443/cam.
LAN_HOST=192.168.1.20
```
Set the real value in your local `dashboard/.env` (never staged).

`dashboard/.gitignore`: add `/recordings/`.

- [ ] **Step 4: Verify through the proxy**

```bash
cd dashboard && docker compose up -d --build
curl -sk -o /dev/null -w '%{http_code}\n' https://localhost:3443/login                    # 200
curl -sk -o /dev/null -w '%{http_code}\n' https://$(ipconfig getifaddr en0):3443/login    # 200 (no SNI: default_sni path)
curl -s  -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/login                     # 200
docker compose ps --format '{{.Service}} {{.Ports}}'   # caddy 0.0.0.0:3443; web 127.0.0.1:3000; db 127.0.0.1:5433
curl -sk -o /dev/null -w '%{http_code}\n' -X POST --data-binary @<(head -c 1100000 /dev/zero) https://localhost:3443/api/health   # 413 from Caddy
```
Playwright check (scratchpad `plan-e/t1-proxy.mjs`, run with `set -a; . dashboard/.env; set +a; node <scratchpad>/plan-e/t1-proxy.mjs`). It imports `chromium` from `<repo>/node_modules/playwright/index.mjs`, opens a context with `ignoreHTTPSErrors: true`, logs in at `https://localhost:3443/login` with `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`, and asserts:
- the map loads (the login server action was accepted through the proxy);
- `(await context.cookies()).find(c => c.name === 'nt_session').secure === true`;
- SSE is unbuffered:
  ```js
  await page.evaluate(async () =>
  {
      const reader = (await fetch('/api/stream')).body.getReader();
      const t0 = performance.now();
      const { value } = await reader.read();
      return { ms: performance.now() - t0, text: new TextDecoder().decode(value) };
  })
  ```
  returns text containing `connected` in under 1000 ms.

Expected: all four pass. Delete nothing; the script stays in the scratchpad.

- [ ] **Step 5: Commit**

```bash
git add dashboard/Caddyfile dashboard/docker-compose.yml dashboard/.env.example dashboard/.gitignore dashboard/web/src/lib/auth/requestSecurity.ts dashboard/web/src/lib/auth/session.ts "dashboard/web/src/app/(auth)/login/actions.ts" dashboard/web/tests/unit/requestSecurity.test.ts dashboard/web/tests/unit/session.test.ts dashboard/web/tests/boundary.test.ts
git commit -m "feat(dashboard): HTTPS on the LAN through Caddy with secure session cookies"
```

---

### Task 2: LiveDevice model, frame store, device and frame routes

**Files:**
- Modify: `dashboard/web/prisma/schema.prisma` (+ generated migration `prisma/migrations/<ts>_live_phones/`), `dashboard/web/src/lib/types.ts`
- Create: `dashboard/web/src/lib/phones/{frameStore,body,devices,http}.ts`, `dashboard/web/src/app/api/live/devices/route.ts`, `dashboard/web/src/app/api/live/frame/[deviceId]/route.ts`
- Test: `dashboard/web/tests/unit/frameStore.test.ts`, `dashboard/web/tests/integration/live-phones.test.ts`

**Interfaces:**
- Consumes: `currentUserOrNull(): Promise<SessionUser | null>` (DB-backed, disabled users → null) from `@/lib/auth/guard`; `prisma` from `@/lib/db`; `createPrismaClient(url)`; `seedDatabase(prisma, { adminEmail, adminPassword })`.
- Produces:
  ```ts
  // frameStore.ts
  export const MAX_FRAME_BYTES = 500 * 1024; export const MAX_FRAMES_PER_SECOND = 10; export const ONLINE_MS = 10_000; export const TOUCH_EVERY_MS = 5_000;
  export type PutResult = { ok: true; at: number; touch: boolean } | { ok: false; reason: 'rate' };
  export class FrameStore { put(deviceId: string, jpeg: Buffer, now?: number): PutResult; latest(deviceId: string, now?: number): { jpeg: Buffer; at: number } | null; isOnline(deviceId: string, now?: number): boolean; onlineIds(now?: number): string[]; lastFrameAt(deviceId: string): number | null; forget(deviceId: string): void }
  export const frameStore: FrameStore; // globalThis.__nesttraceFrames
  // body.ts
  export function readCapped(request: Request, max: number): Promise<Buffer | 'too-large'>;
  export function isJpeg(body: Uint8Array): boolean;
  // devices.ts
  export const DEVICE_NAME_MAX = 60;
  export function cleanDeviceName(name: string): string | null;
  export function registerDevice(prisma: PrismaClient, ownerId: string, name: string): Promise<{ id: string; name: string; cameraCode: string | null; created: boolean }>;
  export type FrameAccess = { ok: true; device: { id: string; name: string; cameraCode: string | null } } | { ok: false; status: 403 | 404 };
  export function frameAccess(prisma: PrismaClient, deviceId: string, user: SessionUser): Promise<FrameAccess>;
  export function touchDevice(prisma: PrismaClient, deviceId: string, at: Date): Promise<void>;
  export function listDevices(prisma: PrismaClient, store: FrameStore, options: { all: boolean; isRecording?: (deviceId: string) => boolean; now?: number }): Promise<LiveDeviceView[]>;
  // http.ts
  export interface FrameRecorder { addFrame(deviceId: string, jpeg: Buffer, at: number, meta: { deviceName: string; cameraCode: string | null }): void; isRecording(deviceId: string): boolean }
  export interface PhoneDeps { prisma: PrismaClient; user: SessionUser | null; store: FrameStore; recorder?: FrameRecorder | null; now?: () => number }
  export function postDevice(deps: PhoneDeps, request: Request): Promise<Response>;               // 201 created | 200 reused, { id, name, cameraCode }
  export function getDevices(deps: PhoneDeps): Promise<Response>;                                 // { devices: LiveDeviceView[] }
  export function postFrame(deps: PhoneDeps, deviceId: string, request: Request): Promise<Response>; // 200 { at, cameraCode, recording }
  export function getFrame(deps: Pick<PhoneDeps, 'user' | 'store' | 'now'>, deviceId: string, request: Request): Response;
  // types.ts
  export interface LiveDeviceView { id: string; name: string; ownerName: string; cameraCode: string | null; online: boolean; recording: boolean; lastSeenAt: string }
  ```
- HTTP: `POST /api/live/devices` `{ name }`; `GET /api/live/devices`; `POST|GET /api/live/frame/<deviceId>`. Status codes: 401 signed out; 403 VIEWER / not owner / removed; 404 unknown device or no frame in 10 s; 413 > 500 KB; 415 not JPEG; 429 > 10/s; 304 unchanged.

- [ ] **Step 1: Schema and migration**

`prisma/schema.prisma`: add the model and relations:
```prisma
model LiveDevice {
  id         String    @id @default(cuid())
  name       String
  ownerId    String
  owner      User      @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  lastSeenAt DateTime  @default(now())
  createdAt  DateTime  @default(now())
  /// Set when an admin removes the phone; it then takes no frames and is hidden from lists.
  disabledAt DateTime?
  camera     Camera?

  @@index([ownerId])
}
```
`model Camera` add:
```prisma
  /// Phone whose live picture this camera shows; a phone feeds at most one camera.
  liveDeviceId String?     @unique
  liveDevice   LiveDevice? @relation(fields: [liveDeviceId], references: [id], onDelete: SetNull)
```
`model User` add `liveDevices LiveDevice[]`.
Run: `cd dashboard && docker compose up -d db && cd web && npx prisma migrate dev --name live_phones && npm run db:test:prepare`. Expected: a new migration folder `*_live_phones` and "Your database is now in sync".

- [ ] **Step 2: Failing frame-store unit test**

`tests/unit/frameStore.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { FrameStore, MAX_FRAME_BYTES, MAX_FRAMES_PER_SECOND, ONLINE_MS, TOUCH_EVERY_MS } from '@/lib/phones/frameStore';

const jpeg = (n: number) => Buffer.from([0xff, 0xd8, n]);

describe('FrameStore', () =>
{
    it('pins the spec limits', () =>
    {
        expect(MAX_FRAME_BYTES).toBe(500 * 1024);
        expect(MAX_FRAMES_PER_SECOND).toBe(10);
        expect(ONLINE_MS).toBe(10_000);
        expect(TOUCH_EVERY_MS).toBe(5_000);
    });

    it('keeps only the newest frame per device', () =>
    {
        const store = new FrameStore();
        store.put('d1', jpeg(1), 1_000);
        store.put('d1', jpeg(2), 1_200);
        store.put('d2', jpeg(9), 1_300);
        expect(store.latest('d1', 1_300)).toEqual({ jpeg: jpeg(2), at: 1_200 });
        expect(store.latest('d2', 1_300)?.jpeg).toEqual(jpeg(9));
    });

    it('goes offline 10 s after the last frame', () =>
    {
        const store = new FrameStore();
        store.put('d1', jpeg(1), 0);
        expect(store.latest('d1', 9_999)).not.toBeNull();
        expect(store.isOnline('d1', 10_000)).toBe(true);
        expect(store.latest('d1', 10_001)).toBeNull();
        expect(store.onlineIds(10_001)).toEqual([]);
        expect(store.lastFrameAt('d1')).toBe(0);
    });

    it('accepts 10 frames in any one second per device and refuses the 11th', () =>
    {
        const store = new FrameStore();
        for (let i = 0; i < 10; i++)
        {
            expect(store.put('d1', jpeg(i), 5_000 + i * 50).ok).toBe(true);
        }
        expect(store.put('d1', jpeg(10), 5_500)).toEqual({ ok: false, reason: 'rate' });
        expect(store.latest('d1', 5_500)?.jpeg).toEqual(jpeg(9));
        expect(store.put('d1', jpeg(11), 6_001).ok).toBe(true);
        expect(store.put('d2', jpeg(0), 5_500).ok).toBe(true);
    });

    it('asks for a lastSeenAt write at most once per 5 s', () =>
    {
        const store = new FrameStore();
        const touches = [0, 1_000, 4_999, 5_000, 9_000, 10_100].map(t =>
        {
            const result = store.put('d1', jpeg(0), t);
            return result.ok && result.touch;
        });
        expect(touches).toEqual([true, false, false, true, false, true]);
    });

    it('gives every stored frame a strictly later time so ETags change', () =>
    {
        const store = new FrameStore();
        const a = store.put('d1', jpeg(1), 2_000);
        const b = store.put('d1', jpeg(2), 2_000);
        expect(a.ok && b.ok && b.at > a.at).toBe(true);
    });

    it('forgets a removed device and prunes devices silent for a minute', () =>
    {
        const store = new FrameStore();
        store.put('d1', jpeg(1), 0);
        store.put('d2', jpeg(1), 0);
        store.forget('d1');
        expect(store.latest('d1', 1)).toBeNull();
        store.onlineIds(60_001);
        expect(store.lastFrameAt('d2')).toBeNull();
    });
});
```
Run: `npx vitest run tests/unit/frameStore.test.ts`. Expected: FAIL (cannot find `@/lib/phones/frameStore`).

- [ ] **Step 3: Implement `frameStore.ts` and `body.ts`**

`src/lib/phones/frameStore.ts`:
```ts
export const MAX_FRAME_BYTES = 500 * 1024;
export const MAX_FRAMES_PER_SECOND = 10;
export const ONLINE_MS = 10_000;
export const TOUCH_EVERY_MS = 5_000;
const PRUNE_MS = 60_000;

interface Entry
{
    jpeg: Buffer;
    at: number;
    recent: number[];
    touchedAt: number;
}

export type PutResult = { ok: true; at: number; touch: boolean } | { ok: false; reason: 'rate' };

// Newest JPEG per phone, held in memory by the single web process (spec §3). Not shared across instances.
export class FrameStore
{
    private entries = new Map<string, Entry>();

    put(deviceId: string, jpeg: Buffer, now: number = Date.now()): PutResult
    {
        const entry = this.entries.get(deviceId);
        const recent = (entry?.recent ?? []).filter(t => now - t < 1000);
        if (recent.length >= MAX_FRAMES_PER_SECOND)
        {
            if (entry)
            {
                entry.recent = recent;
            }
            return { ok: false, reason: 'rate' };
        }
        recent.push(now);
        const at = entry && now <= entry.at ? entry.at + 1 : now;
        const touch = !entry || now - entry.touchedAt >= TOUCH_EVERY_MS;
        this.entries.set(deviceId, { jpeg, at, recent, touchedAt: touch || !entry ? now : entry.touchedAt });
        return { ok: true, at, touch };
    }

    latest(deviceId: string, now: number = Date.now()): { jpeg: Buffer; at: number } | null
    {
        const entry = this.entries.get(deviceId);
        return entry && now - entry.at <= ONLINE_MS ? { jpeg: entry.jpeg, at: entry.at } : null;
    }

    isOnline(deviceId: string, now: number = Date.now()): boolean
    {
        return this.latest(deviceId, now) !== null;
    }

    onlineIds(now: number = Date.now()): string[]
    {
        for (const [id, entry] of this.entries)
        {
            if (now - entry.at > PRUNE_MS)
            {
                this.entries.delete(id);
            }
        }
        return [...this.entries.keys()].filter(id => this.isOnline(id, now));
    }

    lastFrameAt(deviceId: string): number | null
    {
        return this.entries.get(deviceId)?.at ?? null;
    }

    forget(deviceId: string): void
    {
        this.entries.delete(deviceId);
    }
}

const globalStore = globalThis as unknown as { __nesttraceFrames?: FrameStore };
export const frameStore = globalStore.__nesttraceFrames ??= new FrameStore();
```
`src/lib/phones/body.ts`:
```ts
// Reads a request body, giving up as soon as it passes `max` bytes (Content-Length may be absent or wrong).
export async function readCapped(request: Request, max: number): Promise<Buffer | 'too-large'>
{
    const declared = Number(request.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > max)
    {
        return 'too-large';
    }
    if (!request.body)
    {
        return Buffer.alloc(0);
    }
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;)
    {
        const { done, value } = await reader.read();
        if (done)
        {
            break;
        }
        size += value.byteLength;
        if (size > max)
        {
            await reader.cancel();
            return 'too-large';
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks);
}

// Every JPEG starts with FF D8.
export function isJpeg(body: Uint8Array): boolean
{
    return body.length >= 4 && body[0] === 0xff && body[1] === 0xd8;
}
```
Run the unit test → PASS (7).

- [ ] **Step 4: Failing integration tests**

`tests/integration/live-phones.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@/lib/auth/session';
import { createPrismaClient } from '@/lib/db';
import { FrameStore } from '@/lib/phones/frameStore';
import { getDevices, getFrame, postDevice, postFrame, type FrameRecorder } from '@/lib/phones/http';
import type { LiveDeviceView } from '@/lib/types';
import { seedDatabase } from '../../prisma/seed';

const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
let admin: SessionUser;
let volunteer: SessionUser;
let other: SessionUser;
let viewer: SessionUser;

beforeAll(async () =>
{
    const [{ current_database: name }] = await prisma.$queryRawUnsafe<{ current_database: string }[]>('SELECT current_database()');
    if (!name.endsWith('_test'))
    {
        throw new Error(`Refusing to run against ${name}`);
    }
});
beforeEach(async () =>
{
    await prisma.$executeRawUnsafe('TRUNCATE "LiveDevice","SiteEvent","LiveChunk","AuditLog","AlertStatusChange","AlertNote","Alert","Track","Job","Video","Camera","Zone","User" CASCADE');
    await seedDatabase(prisma, { adminEmail: 'admin@test.local', adminPassword: 'pw-for-tests' });
    const row = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.local' } });
    admin = { id: row.id, email: row.email, name: row.name, role: 'ADMIN' };
    const make = async (email: string, role: 'VOLUNTEER' | 'VIEWER'): Promise<SessionUser> =>
    {
        const user = await prisma.user.create({ data: { email, name: email.split('@')[0], role, passwordHash: 'unused' } });
        return { id: user.id, email, name: user.name, role };
    };
    volunteer = await make('vol@test.local', 'VOLUNTEER');
    other = await make('other@test.local', 'VOLUNTEER');
    viewer = await make('view@test.local', 'VIEWER');
});
afterAll(async () => { await prisma.$disconnect(); });

const T0 = Date.UTC(2026, 9, 10, 20, 0, 0);
const jpeg = (size = 64) => { const body = Buffer.alloc(size, 7); body[0] = 0xff; body[1] = 0xd8; return body; };
const named = (name: unknown) => new Request('https://x/api/live/devices', { method: 'POST', body: JSON.stringify({ name }), headers: { 'content-type': 'application/json' } });
const frame = (body: Uint8Array) => new Request('https://x/api/live/frame/id', { method: 'POST', body, headers: { 'content-type': 'image/jpeg' } });

async function register(user: SessionUser, name = 'Pixel 7'): Promise<string>
{
    const response = await postDevice({ prisma, user, store: new FrameStore() }, named(name));
    return ((await response.json()) as { id: string }).id;
}

describe('device registration', () =>
{
    it('creates one device per owner and name, then reuses it', async () =>
    {
        const store = new FrameStore();
        const first = await postDevice({ prisma, user: volunteer, store }, named('  Pixel   7 '));
        expect(first.status).toBe(201);
        const { id, name } = await first.json() as { id: string; name: string };
        expect(name).toBe('Pixel 7');
        const again = await postDevice({ prisma, user: volunteer, store }, named('Pixel 7'));
        expect(again.status).toBe(200);
        expect((await again.json() as { id: string }).id).toBe(id);
        expect((await postDevice({ prisma, user: other, store }, named('Pixel 7'))).status).toBe(201);
        expect(await prisma.liveDevice.count()).toBe(2);
    });

    it('refuses signed-out callers, viewers and bad names', async () =>
    {
        const store = new FrameStore();
        expect((await postDevice({ prisma, user: null, store }, named('A'))).status).toBe(401);
        expect((await postDevice({ prisma, user: viewer, store }, named('A'))).status).toBe(403);
        expect((await postDevice({ prisma, user: volunteer, store }, named('   '))).status).toBe(400);
        expect((await postDevice({ prisma, user: volunteer, store }, named('x'.repeat(61)))).status).toBe(400);
        expect((await postDevice({ prisma, user: volunteer, store }, named(42))).status).toBe(400);
        expect(await prisma.liveDevice.count()).toBe(0);
    });

    it('registers a fresh device after an admin removed the old one', async () =>
    {
        const id = await register(volunteer);
        await prisma.liveDevice.update({ where: { id }, data: { disabledAt: new Date() } });
        expect(await register(volunteer)).not.toBe(id);
    });
});

describe('frames', () =>
{
    let now: number;
    const deps = (user: SessionUser | null, store: FrameStore, recorder: FrameRecorder | null = null) => ({ prisma, user, store, recorder, now: () => (now += 200) });
    beforeEach(() => { now = T0; });

    it('lets the owner and an admin send, and refuses everyone else', async () =>
    {
        const id = await register(volunteer);
        const store = new FrameStore();
        expect((await postFrame(deps(volunteer, store), id, frame(jpeg()))).status).toBe(200);
        expect((await postFrame(deps(admin, store), id, frame(jpeg()))).status).toBe(200);
        expect((await postFrame(deps(other, store), id, frame(jpeg()))).status).toBe(403);
        expect((await postFrame(deps(viewer, store), id, frame(jpeg()))).status).toBe(403);
        expect((await postFrame(deps(null, store), id, frame(jpeg()))).status).toBe(401);
        expect((await postFrame(deps(volunteer, store), 'no-such-device', frame(jpeg()))).status).toBe(404);
        await prisma.liveDevice.update({ where: { id }, data: { disabledAt: new Date() } });
        expect((await postFrame(deps(volunteer, store), id, frame(jpeg()))).status).toBe(403);
    });

    it('refuses frames over 500 KB, even streamed without Content-Length, and non-JPEG bodies', async () =>
    {
        const id = await register(volunteer);
        const store = new FrameStore();
        expect((await postFrame(deps(volunteer, store), id, frame(jpeg(500 * 1024)))).status).toBe(200);
        expect((await postFrame(deps(volunteer, store), id, frame(jpeg(500 * 1024 + 1)))).status).toBe(413);
        const streamed = new Request('https://x/f', {
            method: 'POST',
            body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(jpeg(300 * 1024)); controller.enqueue(new Uint8Array(300 * 1024)); controller.close(); } }),
            duplex: 'half',
        } as RequestInit);
        expect(streamed.headers.get('content-length')).toBeNull();
        expect((await postFrame(deps(volunteer, store), id, streamed)).status).toBe(413);
        expect((await postFrame(deps(volunteer, store), id, frame(Buffer.from('hello world')))).status).toBe(415);
    });

    it('answers 429 past 10 frames a second', async () =>
    {
        const id = await register(volunteer);
        const store = new FrameStore();
        const fast = { prisma, user: volunteer, store, now: () => (now += 50) };
        const statuses: number[] = [];
        for (let i = 0; i < 11; i++)
        {
            statuses.push((await postFrame(fast, id, frame(jpeg()))).status);
        }
        expect(statuses).toEqual([...Array(10).fill(200), 429]);
    });

    it('writes lastSeenAt at most once per 5 s and hands frames to the recorder', async () =>
    {
        const id = await register(volunteer);
        const store = new FrameStore();
        const added: { at: number; meta: unknown }[] = [];
        const recorder: FrameRecorder = { addFrame: (_d, _j, at, meta) => added.push({ at, meta }), isRecording: () => true };
        const response = await postFrame(deps(volunteer, store, recorder), id, frame(jpeg()));
        expect(await response.json()).toEqual({ at: T0 + 200, cameraCode: null, recording: true });
        const seen = async () => (await prisma.liveDevice.findUniqueOrThrow({ where: { id } })).lastSeenAt.getTime();
        expect(await seen()).toBe(T0 + 200);
        await postFrame(deps(volunteer, store, recorder), id, frame(jpeg()));
        expect(await seen()).toBe(T0 + 200);
        now = T0 + 5_200 - 200;
        await postFrame(deps(volunteer, store, recorder), id, frame(jpeg()));
        expect(await seen()).toBe(T0 + 5_200);
        expect(added).toHaveLength(3);
        expect(added[0].meta).toEqual({ deviceName: 'Pixel 7', cameraCode: null });
    });

    it('serves the newest frame with an ETag, 304 when unchanged, 404 after 10 s', async () =>
    {
        const id = await register(volunteer);
        const store = new FrameStore();
        await postFrame(deps(volunteer, store), id, frame(jpeg(10)));
        const get = (headers: Record<string, string> = {}, at = T0 + 1_000) => getFrame({ user: viewer, store, now: () => at }, id, new Request('https://x', { headers }));
        const ok = get();
        expect(ok.status).toBe(200);
        expect(ok.headers.get('content-type')).toBe('image/jpeg');
        expect(ok.headers.get('cache-control')).toBe('no-store');
        expect(ok.headers.get('x-frame-at')).toBe(String(T0 + 200));
        expect(Buffer.from(await ok.arrayBuffer())).toEqual(jpeg(10));
        expect(get({ 'if-none-match': ok.headers.get('etag')! }).status).toBe(304);
        expect(get({}, T0 + 200 + 10_001).status).toBe(404);
        expect(getFrame({ user: null, store }, id, new Request('https://x')).status).toBe(401);
    });

    it('lists online phones for everyone and every phone for admins', async () =>
    {
        const online = await register(volunteer, 'Dune');
        const silent = await register(other, 'Pier');
        const store = new FrameStore();
        await postFrame(deps(volunteer, store), online, frame(jpeg()));
        const list = async (user: SessionUser) => ((await (await getDevices({ prisma, user, store, now: () => T0 + 1_000 })).json()) as { devices: LiveDeviceView[] }).devices;
        expect((await list(viewer)).map(d => [d.id, d.online, d.ownerName])).toEqual([[online, true, 'vol']]);
        expect((await list(admin)).map(d => [d.id, d.online])).toEqual([[online, true], [silent, false]]);
        expect((await getDevices({ prisma, user: null, store })).status).toBe(401);
    });
});
```
Run: `npx vitest run tests/integration/live-phones.test.ts`. Expected: FAIL (cannot find `@/lib/phones/http`).

- [ ] **Step 5: Implement `devices.ts`, `http.ts`, types and routes**

`src/lib/types.ts` add:
```ts
export interface LiveDeviceView
{
    id: string;
    name: string;
    ownerName: string;
    cameraCode: string | null;
    online: boolean;
    recording: boolean;
    lastSeenAt: string;
}
```
`src/lib/phones/devices.ts`:
```ts
import type { PrismaClient } from '@/generated/prisma/client';
import type { SessionUser } from '@/lib/auth/session';
import type { LiveDeviceView } from '@/lib/types';
import type { FrameStore } from './frameStore';

export const DEVICE_NAME_MAX = 60;

export function cleanDeviceName(name: string): string | null
{
    const clean = name.replace(/\s+/g, ' ').trim();
    return clean.length >= 1 && clean.length <= DEVICE_NAME_MAX ? clean : null;
}

// One phone per owner and name while it is not removed; the phone re-registers on every Start.
export async function registerDevice(prisma: PrismaClient, ownerId: string, name: string)
{
    const existing = await prisma.liveDevice.findFirst({ where: { ownerId, name, disabledAt: null }, orderBy: { createdAt: 'asc' }, include: { camera: { select: { code: true } } } });
    if (existing)
    {
        return { id: existing.id, name: existing.name, cameraCode: existing.camera?.code ?? null, created: false };
    }
    const row = await prisma.liveDevice.create({ data: { ownerId, name } });
    return { id: row.id, name: row.name, cameraCode: null, created: true };
}

export type FrameAccess = { ok: true; device: { id: string; name: string; cameraCode: string | null } } | { ok: false; status: 403 | 404 };

// The owner or an admin may send for a phone; a removed phone takes no frames.
export async function frameAccess(prisma: PrismaClient, deviceId: string, user: SessionUser): Promise<FrameAccess>
{
    const row = await prisma.liveDevice.findUnique({ where: { id: deviceId }, select: { id: true, name: true, ownerId: true, disabledAt: true, camera: { select: { code: true } } } });
    if (!row)
    {
        return { ok: false, status: 404 };
    }
    if (row.disabledAt || (row.ownerId !== user.id && user.role !== 'ADMIN'))
    {
        return { ok: false, status: 403 };
    }
    return { ok: true, device: { id: row.id, name: row.name, cameraCode: row.camera?.code ?? null } };
}

export async function touchDevice(prisma: PrismaClient, deviceId: string, at: Date): Promise<void>
{
    await prisma.liveDevice.updateMany({ where: { id: deviceId }, data: { lastSeenAt: at } });
}

// Online phones for everyone; admins (all: true) also get silent ones, for the Source picker and the phones list.
export async function listDevices(prisma: PrismaClient, store: FrameStore, options: { all: boolean; isRecording?: (deviceId: string) => boolean; now?: number }): Promise<LiveDeviceView[]>
{
    const now = options.now ?? Date.now();
    const online = new Set(store.onlineIds(now));
    const rows = await prisma.liveDevice.findMany({
        where: options.all ? { disabledAt: null } : { disabledAt: null, id: { in: [...online] } },
        orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
        include: { owner: { select: { name: true } }, camera: { select: { code: true } } },
    });
    return rows.map(row =>
    {
        const frameAt = store.lastFrameAt(row.id);
        return {
            id: row.id,
            name: row.name,
            ownerName: row.owner.name,
            cameraCode: row.camera?.code ?? null,
            online: online.has(row.id),
            recording: options.isRecording?.(row.id) ?? false,
            lastSeenAt: new Date(Math.max(frameAt ?? 0, row.lastSeenAt.getTime())).toISOString(),
        };
    });
}
```
`src/lib/phones/http.ts`:
```ts
import type { PrismaClient } from '@/generated/prisma/client';
import type { SessionUser } from '@/lib/auth/session';
import { isJpeg, readCapped } from './body';
import { cleanDeviceName, DEVICE_NAME_MAX, frameAccess, listDevices, registerDevice, touchDevice } from './devices';
import { MAX_FRAME_BYTES, type FrameStore } from './frameStore';

export interface FrameRecorder
{
    addFrame(deviceId: string, jpeg: Buffer, at: number, meta: { deviceName: string; cameraCode: string | null }): void;
    isRecording(deviceId: string): boolean;
}

export interface PhoneDeps
{
    prisma: PrismaClient;
    user: SessionUser | null;
    store: FrameStore;
    recorder?: FrameRecorder | null;
    now?: () => number;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const canSend = (user: SessionUser) => user.role === 'VOLUNTEER' || user.role === 'ADMIN';

export async function postDevice(deps: PhoneDeps, request: Request): Promise<Response>
{
    if (!deps.user)
    {
        return json({ error: 'Sign in first.' }, 401);
    }
    if (!canSend(deps.user))
    {
        return json({ error: 'Your account can watch but not send.' }, 403);
    }
    const body = await request.json().catch(() => null) as { name?: unknown } | null;
    const name = typeof body?.name === 'string' ? cleanDeviceName(body.name) : null;
    if (!name)
    {
        return json({ error: `Give the phone a name of 1 to ${DEVICE_NAME_MAX} characters.` }, 400);
    }
    const device = await registerDevice(deps.prisma, deps.user.id, name);
    return json({ id: device.id, name: device.name, cameraCode: device.cameraCode }, device.created ? 201 : 200);
}

export async function getDevices(deps: PhoneDeps): Promise<Response>
{
    if (!deps.user)
    {
        return json({ error: 'Sign in first.' }, 401);
    }
    const devices = await listDevices(deps.prisma, deps.store, {
        all: deps.user.role === 'ADMIN',
        isRecording: id => deps.recorder?.isRecording(id) ?? false,
        now: deps.now?.(),
    });
    return json({ devices });
}

export async function postFrame(deps: PhoneDeps, deviceId: string, request: Request): Promise<Response>
{
    if (!deps.user)
    {
        return json({ error: 'Sign in first.' }, 401);
    }
    if (!canSend(deps.user))
    {
        return json({ error: 'Your account can watch but not send.' }, 403);
    }
    const access = await frameAccess(deps.prisma, deviceId, deps.user);
    if (!access.ok)
    {
        return json({ error: access.status === 404 ? 'Unknown phone.' : 'This phone cannot send here.' }, access.status);
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
    const put = deps.store.put(deviceId, body, now);
    if (!put.ok)
    {
        return json({ error: 'More than 10 frames a second.' }, 429);
    }
    if (put.touch)
    {
        await touchDevice(deps.prisma, deviceId, new Date(now));
    }
    deps.recorder?.addFrame(deviceId, body, put.at, { deviceName: access.device.name, cameraCode: access.device.cameraCode });
    return json({ at: put.at, cameraCode: access.device.cameraCode, recording: deps.recorder?.isRecording(deviceId) ?? false });
}

export function getFrame(deps: Pick<PhoneDeps, 'user' | 'store' | 'now'>, deviceId: string, request: Request): Response
{
    if (!deps.user)
    {
        return new Response('Unauthorized', { status: 401 });
    }
    const frame = deps.store.latest(deviceId, deps.now?.() ?? Date.now());
    if (!frame)
    {
        return new Response('No frame in the last 10 s', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    const etag = `"${frame.at}"`;
    const headers = { 'Cache-Control': 'no-store', ETag: etag, 'X-Frame-At': String(frame.at) };
    if (request.headers.get('if-none-match') === etag)
    {
        return new Response(null, { status: 304, headers });
    }
    return new Response(new Uint8Array(frame.jpeg), { status: 200, headers: { ...headers, 'Content-Type': 'image/jpeg', 'Content-Length': String(frame.jpeg.length) } });
}
```
`src/app/api/live/devices/route.ts`:
```ts
import { currentUserOrNull } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { frameStore } from '@/lib/phones/frameStore';
import { getDevices, postDevice } from '@/lib/phones/http';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response>
{
    return postDevice({ prisma, user: await currentUserOrNull(), store: frameStore }, request);
}

export async function GET(): Promise<Response>
{
    return getDevices({ prisma, user: await currentUserOrNull(), store: frameStore });
}
```
`src/app/api/live/frame/[deviceId]/route.ts`:
```ts
import { currentUserOrNull } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { frameStore } from '@/lib/phones/frameStore';
import { getFrame, postFrame } from '@/lib/phones/http';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ deviceId: string }> };

export async function POST(request: Request, context: Context): Promise<Response>
{
    return postFrame({ prisma, user: await currentUserOrNull(), store: frameStore }, (await context.params).deviceId, request);
}

export async function GET(request: Request, context: Context): Promise<Response>
{
    return getFrame({ user: await currentUserOrNull(), store: frameStore }, (await context.params).deviceId, request);
}
```
Run: `npx vitest run tests/integration/live-phones.test.ts tests/unit/frameStore.test.ts` → PASS. Then `npx vitest run && npx tsc --noEmit` → PASS (other integration files TRUNCATE `"User" CASCADE`, which also clears `LiveDevice`).

- [ ] **Step 6: Commit (credits the teammate)**

```bash
git add dashboard/web/prisma/schema.prisma dashboard/web/prisma/migrations dashboard/web/src/lib/types.ts dashboard/web/src/lib/phones/frameStore.ts dashboard/web/src/lib/phones/body.ts dashboard/web/src/lib/phones/devices.ts dashboard/web/src/lib/phones/http.ts dashboard/web/src/app/api/live/devices/route.ts "dashboard/web/src/app/api/live/frame/[deviceId]/route.ts" dashboard/web/tests/unit/frameStore.test.ts dashboard/web/tests/integration/live-phones.test.ts
git commit -m "feat(dashboard): phone devices and a live JPEG frame relay" -m "Ports the frame relay from elpaelpa's live-phone-cameras work (commits 3981767 and 4b313f1): newest frame kept in memory, ETag polling with 304, 10 s online window. Phones now sign in with a normal account instead of a shared key."
```

---

### Task 3: MJPEG AVI writer and the 5 fps segmenter

**Files:**
- Create: `dashboard/web/src/lib/phones/avi.ts`, `dashboard/web/src/lib/phones/segmenter.ts`
- Test: `dashboard/web/tests/unit/aviTestUtils.ts` (helpers, not collected), `dashboard/web/tests/unit/avi.test.ts`, `dashboard/web/tests/unit/segmenter.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure + `node:fs/promises`).
- Produces:
  ```ts
  // avi.ts
  export const AVI_HEADER_BYTES = 224; export const MAX_SEGMENT_BYTES = 900 * 1024 * 1024;
  export function jpegSize(jpeg: Uint8Array): { width: number; height: number } | null;
  export function aviHeader(width: number, height: number, fps: number): Buffer;
  export class AviWriter { static create(path: string, width: number, height: number, fps: number): Promise<AviWriter>; readonly frameCount: number; readonly bytes: number; write(jpeg: Buffer): void; flush(): Promise<void>; finish(): Promise<void>; abandon(): Promise<void> }
  export function repairAvi(path: string, fps: number): Promise<{ frameCount: number } | null>;
  // segmenter.ts
  export interface SegmentMeta { deviceName: string; cameraCode: string | null }
  export interface SegmentStart extends SegmentMeta { deviceId: string; startedAt: number; width: number; height: number; fps: number }
  export interface SegmentSink { readonly bytes: number; write(jpeg: Buffer): void; close(frameCount: number): void }
  export interface SegmenterOptions { fps: number; segmentMs: number; maxGapMs: number; maxBytes: number; open(start: SegmentStart): SegmentSink }
  export class Segmenter { constructor(options: SegmenterOptions); addFrame(deviceId: string, jpeg: Buffer, at: number, meta: SegmentMeta): void; closeIdle(now: number): void; closeAll(): void; isRecording(deviceId: string): boolean }
  ```

- [ ] **Step 1: Test helpers**

`tests/unit/aviTestUtils.ts`:
```ts
import { expect } from 'vitest';

// Smallest buffer jpegSize() accepts: SOI, then an SOF0 segment with height and width; the last byte tags the frame.
export function fakeJpeg(width: number, height: number, tag: number, extra = 0): Buffer
{
    return Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        Buffer.alloc(extra, 0x55),
        Buffer.from([tag]),
    ]);
}

// Walks a finished file the way a reader would: header counts, movi chunks, idx1.
export function parseAvi(file: Buffer)
{
    const moviEnd = 220 + file.readUInt32LE(216);
    const frames: Buffer[] = [];
    for (let at = 224; at < moviEnd;)
    {
        expect(file.toString('latin1', at, at + 4)).toBe('00dc');
        const length = file.readUInt32LE(at + 4);
        frames.push(file.subarray(at + 8, at + 8 + length));
        at += 8 + length + (length % 2);
    }
    const entries = file.readUInt32LE(moviEnd + 4) / 16;
    const offsets = Array.from({ length: entries }, (_, i) => file.readUInt32LE(moviEnd + 8 + i * 16 + 8));
    return {
        riff: file.toString('latin1', 0, 4), form: file.toString('latin1', 8, 12), riffSize: file.readUInt32LE(4), size: file.length,
        microsPerFrame: file.readUInt32LE(32), totalFrames: file.readUInt32LE(48), width: file.readUInt32LE(64), height: file.readUInt32LE(68),
        handler: file.toString('latin1', 112, 116), rate: file.readUInt32LE(132), streamLength: file.readUInt32LE(140),
        movi: file.toString('latin1', 220, 224), idx1: file.toString('latin1', moviEnd, moviEnd + 4), offsets, frames,
    };
}
```

- [ ] **Step 2: Failing AVI tests**

`tests/unit/avi.test.ts`:
```ts
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AVI_HEADER_BYTES, AviWriter, jpegSize, repairAvi } from '@/lib/phones/avi';
import { fakeJpeg, parseAvi } from './aviTestUtils';

const dir = () => mkdtempSync(join(tmpdir(), 'nt-avi-'));

describe('jpegSize', () =>
{
    it('reads width and height from the SOF marker and rejects non-JPEG', () =>
    {
        expect(jpegSize(fakeJpeg(960, 540, 1))).toEqual({ width: 960, height: 540 });
        expect(jpegSize(Buffer.from('not a jpeg at all, really'))).toBeNull();
    });
});

describe('AviWriter', () =>
{
    it('writes a 5 fps MJPEG AVI with counts, padding and an idx1 index', async () =>
    {
        const path = join(dir(), 'a.avi');
        const writer = await AviWriter.create(path, 960, 540, 5);
        const frames = [fakeJpeg(960, 540, 1), fakeJpeg(960, 540, 2, 1), fakeJpeg(960, 540, 3)];
        frames.forEach(frame => writer.write(frame));
        await writer.finish();
        const avi = parseAvi(readFileSync(path));
        expect(avi).toMatchObject({ riff: 'RIFF', form: 'AVI ', movi: 'movi', idx1: 'idx1', handler: 'MJPG', microsPerFrame: 200_000, rate: 5, totalFrames: 3, streamLength: 3, width: 960, height: 540 });
        expect(avi.riffSize).toBe(avi.size - 8);
        expect(avi.frames).toEqual(frames);
        expect(avi.offsets[0]).toBe(AVI_HEADER_BYTES - 220);
        expect(writer.frameCount).toBe(3);
    });

    it('repairs a file cut off mid-write so it reads like a finished one', async () =>
    {
        const path = join(dir(), 'b.avi.part');
        const writer = await AviWriter.create(path, 640, 360, 5);
        const frames = [1, 2, 3].map(tag => fakeJpeg(640, 360, tag));
        frames.forEach(frame => writer.write(frame));
        await writer.flush();
        await writer.abandon();
        appendFileSync(path, Buffer.from([0x30, 0x30, 0x64, 0x63, 0x40, 0, 0, 0, 1, 2, 3]));   // half a fourth chunk
        expect(await repairAvi(path, 5)).toEqual({ frameCount: 3 });
        const avi = parseAvi(readFileSync(path));
        expect(avi.totalFrames).toBe(3);
        expect(avi.idx1).toBe('idx1');
        expect(avi.frames).toEqual(frames);
        expect(await repairAvi(path, 5)).toEqual({ frameCount: 3 });   // idempotent
    });

    it('refuses to repair something that is not one of our AVI files', async () =>
    {
        const path = join(dir(), 'c.avi.part');
        appendFileSync(path, Buffer.alloc(300, 1));
        expect(await repairAvi(path, 5)).toBeNull();
    });
});
```
Run: `npx vitest run tests/unit/avi.test.ts`. Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement `avi.ts`** (port of `recorder.mjs` `aviHeader`/`finishAvi`/`jpegSize`, plus repair)

```ts
import { open, type FileHandle } from 'node:fs/promises';

// MJPEG in AVI 1.0: the phone's JPEGs stored as-is (no encoder), readable by ffmpeg and OpenCV.
export const AVI_HEADER_BYTES = 224;
const MOVI_FOURCC_AT = 220;
// AVI 1.0 files must stay under 1 GB for many readers.
export const MAX_SEGMENT_BYTES = 900 * 1024 * 1024;

interface IndexEntry
{
    offset: number;
    length: number;
}

export function jpegSize(jpeg: Uint8Array): { width: number; height: number } | null
{
    const view = Buffer.from(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength);
    if (view[0] !== 0xff || view[1] !== 0xd8)
    {
        return null;
    }
    let at = 2;
    while (at + 9 < view.length)
    {
        if (view[at] !== 0xff)
        {
            return null;
        }
        const marker = view[at + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        {
            return { height: view.readUInt16BE(at + 5), width: view.readUInt16BE(at + 7) };
        }
        at += 2 + view.readUInt16BE(at + 2);
    }
    return null;
}

// RIFF/AVI header for one MJPEG stream; counts stay zero until finalize().
export function aviHeader(width: number, height: number, fps: number): Buffer
{
    const header = Buffer.alloc(AVI_HEADER_BYTES);
    let at = 0;
    const fourcc = (text: string) => { header.write(text, at, 'latin1'); at += 4; };
    const u32 = (value: number) => { header.writeUInt32LE(value >>> 0, at); at += 4; };
    const u16 = (value: number) => { header.writeUInt16LE(value, at); at += 2; };

    fourcc('RIFF'); u32(0); fourcc('AVI ');
    fourcc('LIST'); u32(192); fourcc('hdrl');
    fourcc('avih'); u32(56);
    u32(Math.round(1_000_000 / fps)); u32(0); u32(0); u32(0x10); u32(0); u32(0); u32(1); u32(0); u32(width); u32(height);
    at += 16;
    fourcc('LIST'); u32(116); fourcc('strl');
    fourcc('strh'); u32(56); fourcc('vids'); fourcc('MJPG');
    u32(0); u16(0); u16(0); u32(0); u32(1); u32(fps); u32(0); u32(0); u32(0); u32(0xffffffff); u32(0);
    u16(0); u16(0); u16(width); u16(height);
    fourcc('strf'); u32(40);
    u32(40); u32(width); u32(height); u16(1); u16(24); fourcc('MJPG'); u32(width * height * 3);
    at += 16;
    fourcc('LIST'); u32(0); fourcc('movi');
    return header;
}

function aviIndex(entries: IndexEntry[]): Buffer
{
    const index = Buffer.alloc(8 + entries.length * 16);
    index.write('idx1', 0, 'latin1');
    index.writeUInt32LE(entries.length * 16, 4);
    entries.forEach((entry, i) =>
    {
        const at = 8 + i * 16;
        index.write('00dc', at, 'latin1');
        index.writeUInt32LE(0x10, at + 4);   // keyframe: every JPEG stands alone
        index.writeUInt32LE(entry.offset, at + 8);
        index.writeUInt32LE(entry.length, at + 12);
    });
    return index;
}

// Writes idx1 after the last chunk and patches the sizes and counts only known at the end.
async function finalize(handle: FileHandle, index: IndexEntry[], moviEnd: number, largest: number, fps: number): Promise<void>
{
    const tail = aviIndex(index);
    await handle.write(tail, 0, tail.length, moviEnd);
    const buffer = largest + 8;
    const patches: [number, number][] = [
        [4, moviEnd + tail.length - 8], [36, Math.ceil(buffer * fps)], [48, index.length], [60, buffer],
        [140, index.length], [144, buffer], [216, moviEnd - MOVI_FOURCC_AT],
    ];
    for (const [at, value] of patches)
    {
        const field = Buffer.alloc(4);
        field.writeUInt32LE(value >>> 0);
        await handle.write(field, 0, 4, at);
    }
}

export class AviWriter
{
    frameCount = 0;
    bytes = AVI_HEADER_BYTES;
    private largest = 0;
    private index: IndexEntry[] = [];
    private chain: Promise<unknown> = Promise.resolve();
    private failed: Error | null = null;

    private constructor(private handle: FileHandle, private fps: number) {}

    static async create(path: string, width: number, height: number, fps: number): Promise<AviWriter>
    {
        const handle = await open(path, 'w');
        await handle.write(aviHeader(width, height, fps), 0, AVI_HEADER_BYTES, 0);
        return new AviWriter(handle, fps);
    }

    // Queued so frames land in order; a write error (full disk) stops this file only.
    write(jpeg: Buffer): void
    {
        const pad = jpeg.length % 2;
        const head = Buffer.alloc(8);
        head.write('00dc', 0, 'latin1');
        head.writeUInt32LE(jpeg.length, 4);
        const position = this.bytes;
        this.index.push({ offset: position - MOVI_FOURCC_AT, length: jpeg.length });
        this.bytes += 8 + jpeg.length + pad;
        this.frameCount += 1;
        this.largest = Math.max(this.largest, jpeg.length);
        const parts = pad ? [head, jpeg, Buffer.alloc(1)] : [head, jpeg];
        this.enqueue(() => this.handle.writev(parts, position));
    }

    async flush(): Promise<void>
    {
        await this.chain;
    }

    async finish(): Promise<void>
    {
        this.enqueue(() => finalize(this.handle, this.index, this.bytes, this.largest, this.fps));
        await this.chain;
        await this.handle.close();
        if (this.failed)
        {
            throw this.failed;
        }
    }

    // Closes without an index, as a killed process would; tests use it to exercise repairAvi.
    async abandon(): Promise<void>
    {
        await this.chain;
        await this.handle.close();
    }

    private enqueue(task: () => Promise<unknown>): void
    {
        this.chain = this.chain.then(() => (this.failed ? undefined : task())).catch((error: unknown) => { this.failed = error as Error; });
    }
}

// Finishes a segment left without an index (process killed): keeps every whole chunk, drops a torn last one.
export async function repairAvi(path: string, fps: number): Promise<{ frameCount: number } | null>
{
    const handle = await open(path, 'r+');
    try
    {
        const { size } = await handle.stat();
        const head = Buffer.alloc(AVI_HEADER_BYTES);
        await handle.read(head, 0, AVI_HEADER_BYTES, 0);
        if (size < AVI_HEADER_BYTES || head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'AVI ' || head.toString('latin1', MOVI_FOURCC_AT, AVI_HEADER_BYTES) !== 'movi')
        {
            return null;
        }
        const index: IndexEntry[] = [];
        const chunk = Buffer.alloc(8);
        let position = AVI_HEADER_BYTES;
        let largest = 0;
        while (position + 8 <= size)
        {
            await handle.read(chunk, 0, 8, position);
            if (chunk.toString('latin1', 0, 4) !== '00dc')
            {
                break;
            }
            const length = chunk.readUInt32LE(4);
            const next = position + 8 + length + (length % 2);
            if (next > size)
            {
                break;
            }
            index.push({ offset: position - MOVI_FOURCC_AT, length });
            largest = Math.max(largest, length);
            position = next;
        }
        await handle.truncate(position);
        await finalize(handle, index, position, largest, fps);
        return { frameCount: index.length };
    }
    finally
    {
        await handle.close();
    }
}
```
Run avi tests → PASS (4).

- [ ] **Step 4: Failing segmenter tests**

`tests/unit/segmenter.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { Segmenter, type SegmentStart, type SegmenterOptions } from '@/lib/phones/segmenter';
import { fakeJpeg } from './aviTestUtils';

const T0 = Date.UTC(2026, 9, 10, 7, 5, 9);
const meta = { deviceName: 'Dune phone', cameraCode: 'E1' };

function harness(overrides: Partial<SegmenterOptions> = {})
{
    const segments: { start: SegmentStart; frames: number[]; closed: number | null }[] = [];
    const segmenter = new Segmenter({
        fps: 5, segmentMs: 600_000, maxGapMs: 10_000, maxBytes: 900 * 1024 * 1024, ...overrides,
        open(start)
        {
            const record = { start, frames: [] as number[], closed: null as number | null };
            segments.push(record);
            return { bytes: 0, write: jpeg => record.frames.push(jpeg[jpeg.length - 1]), close: count => { record.closed = count; } };
        },
    });
    const add = (tag: number, at: number, m = meta, size: [number, number] = [960, 540]) => segmenter.addFrame('d1', fakeJpeg(size[0], size[1], tag), at, m);
    return { segmenter, segments, add };
}

describe('Segmenter', () =>
{
    it('lays frames on a 5 fps wall-clock timeline, repeating the newest frame into empty slots', () =>
    {
        const { segments, add } = harness();
        add(1, T0);
        add(2, T0 + 100);   // same 200 ms slot: not written, but becomes the newest frame
        add(3, T0 + 600);   // slot 3: slots 1 and 2 repeat frame 2
        expect(segments).toHaveLength(1);
        expect(segments[0].frames).toEqual([1, 2, 2, 3]);
        expect(segments[0].start).toMatchObject({ deviceId: 'd1', startedAt: T0, fps: 5, width: 960, height: 540, deviceName: 'Dune phone', cameraCode: 'E1' });
    });

    it('fills a 10 s gap but closes the segment on a longer one', () =>
    {
        const { segments, add } = harness();
        add(1, T0);
        add(2, T0 + 10_000);
        expect(segments[0].frames).toHaveLength(51);
        expect(segments[0].frames.slice(-2)).toEqual([1, 2]);
        add(3, T0 + 20_001);
        expect(segments[0].closed).toBe(51);
        expect(segments[1].start.startedAt).toBe(T0 + 20_001);
        expect(segments[1].frames).toEqual([3]);
    });

    it('starts a new file every 10 minutes', () =>
    {
        const { segments, add } = harness();
        for (let t = 0; t <= 600_000; t += 200)
        {
            add(t / 200 % 250, T0 + t);
        }
        expect(segments).toHaveLength(2);
        expect(segments[0].closed).toBe(3000);
        expect(segments[1].start.startedAt).toBe(T0 + 600_000);
    });

    it('keeps the camera code from the segment start, and splits on a new picture size', () =>
    {
        const { segments, add } = harness();
        add(1, T0);
        add(2, T0 + 200, { deviceName: 'Dune phone', cameraCode: 'B1' });
        expect(segments[0].start.cameraCode).toBe('E1');
        add(3, T0 + 400, meta, [1280, 720]);
        expect(segments).toHaveLength(2);
        expect(segments[0].closed).toBe(2);
        expect(segments[1].start).toMatchObject({ width: 1280, height: 720 });
    });

    it('closes idle segments after 10 s of silence, and all of them on shutdown', () =>
    {
        const { segmenter, segments, add } = harness();
        add(1, T0);
        segmenter.closeIdle(T0 + 10_000);
        expect(segmenter.isRecording('d1')).toBe(true);
        segmenter.closeIdle(T0 + 10_001);
        expect(segmenter.isRecording('d1')).toBe(false);
        expect(segments[0].closed).toBe(1);
        add(2, T0 + 20_000);
        segmenter.closeAll();
        expect(segments[1].closed).toBe(1);
    });

    it('rolls over before a segment passes the size cap, and ignores non-JPEG input', () =>
    {
        const { segmenter, segments, add } = harness({ maxBytes: -1 });
        add(1, T0);
        add(2, T0 + 200);
        expect(segments).toHaveLength(2);
        segmenter.addFrame('d2', Buffer.from('nope'), T0, meta);
        expect(segmenter.isRecording('d2')).toBe(false);
    });
});
```
Run: `npx vitest run tests/unit/segmenter.test.ts`. Expected: FAIL (cannot find module).

- [ ] **Step 5: Implement `segmenter.ts`** (port of `recorder.mjs` `addFrame`/idle close)

```ts
import { jpegSize } from './avi';

export interface SegmentMeta
{
    deviceName: string;
    cameraCode: string | null;
}

export interface SegmentStart extends SegmentMeta
{
    deviceId: string;
    startedAt: number;
    width: number;
    height: number;
    fps: number;
}

export interface SegmentSink
{
    readonly bytes: number;
    write(jpeg: Buffer): void;
    close(frameCount: number): void;
}

export interface SegmenterOptions
{
    fps: number;
    segmentMs: number;
    maxGapMs: number;
    maxBytes: number;
    open(start: SegmentStart): SegmentSink;
}

interface OpenSegment
{
    start: SegmentStart;
    sink: SegmentSink;
    frameCount: number;
    lastFrame: Buffer;
    lastFrameAt: number;
}

// Frames arrive whenever the phone manages to send them. Each segment is a fixed-rate timeline on the
// wall clock: a slot with no new frame repeats the newest one, so a video second is a real second.
export class Segmenter
{
    private segments = new Map<string, OpenSegment>();

    constructor(private options: SegmenterOptions) {}

    addFrame(deviceId: string, jpeg: Buffer, at: number, meta: SegmentMeta): void
    {
        const size = jpegSize(jpeg);
        if (!size)
        {
            return;
        }
        let segment = this.segments.get(deviceId);
        if (segment && (at - segment.lastFrameAt > this.options.maxGapMs
            || at - segment.start.startedAt >= this.options.segmentMs
            || segment.sink.bytes > this.options.maxBytes
            || size.width !== segment.start.width
            || size.height !== segment.start.height))
        {
            this.close(deviceId);
            segment = undefined;
        }
        if (!segment)
        {
            const start: SegmentStart = { deviceId, startedAt: at, width: size.width, height: size.height, fps: this.options.fps, deviceName: meta.deviceName, cameraCode: meta.cameraCode };
            segment = { start, sink: this.options.open(start), frameCount: 0, lastFrame: jpeg, lastFrameAt: at };
            this.segments.set(deviceId, segment);
        }
        const slot = Math.floor((at - segment.start.startedAt) * this.options.fps / 1000);
        while (segment.frameCount < slot)
        {
            segment.sink.write(segment.lastFrame);
            segment.frameCount += 1;
        }
        if (segment.frameCount === slot)
        {
            segment.sink.write(jpeg);
            segment.frameCount += 1;
        }
        segment.lastFrame = jpeg;
        segment.lastFrameAt = at;
    }

    closeIdle(now: number): void
    {
        for (const [deviceId, segment] of [...this.segments])
        {
            if (now - segment.lastFrameAt > this.options.maxGapMs)
            {
                this.close(deviceId);
            }
        }
    }

    closeAll(): void
    {
        for (const deviceId of [...this.segments.keys()])
        {
            this.close(deviceId);
        }
    }

    isRecording(deviceId: string): boolean
    {
        return this.segments.has(deviceId);
    }

    private close(deviceId: string): void
    {
        const segment = this.segments.get(deviceId);
        if (segment)
        {
            this.segments.delete(deviceId);
            segment.sink.close(segment.frameCount);
        }
    }
}
```
Run: `npx vitest run tests/unit/avi.test.ts tests/unit/segmenter.test.ts` → PASS (10). `npx tsc --noEmit` → PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/web/src/lib/phones/avi.ts dashboard/web/src/lib/phones/segmenter.ts dashboard/web/tests/unit/aviTestUtils.ts dashboard/web/tests/unit/avi.test.ts dashboard/web/tests/unit/segmenter.test.ts
git commit -m "feat(dashboard): MJPEG AVI writer and 5 fps wall-clock segmenter for phone recordings" -m "Ports the recorder timeline and AVI writer from elpaelpa's live-phone-cameras work (commits 3981767 and 4b313f1), adding repair of segments cut off by a killed process."
```

---

### Task 4: Recorder service (ffmpeg, retention, start-up recovery) and the recordings API

**Files:**
- Create: `dashboard/web/src/lib/phones/recordingPaths.ts`, `dashboard/web/src/lib/phones/recorder.ts`, `dashboard/web/src/lib/phones/recordingsHttp.ts`, `dashboard/web/src/app/api/live/recordings/route.ts`, `dashboard/web/src/app/api/live/recordings/[...path]/route.ts`
- Modify: `dashboard/web/src/instrumentation.ts`, `dashboard/web/src/lib/types.ts`, `dashboard/web/src/app/api/live/devices/route.ts`, `dashboard/web/src/app/api/live/frame/[deviceId]/route.ts`, `dashboard/docker-compose.yml`, `dashboard/.env.example`
- Test: `dashboard/web/tests/unit/recordingPaths.test.ts`, `dashboard/web/tests/unit/recorder.test.ts`, `dashboard/web/tests/unit/recordings-http.test.ts`

**Interfaces:**
- Consumes: `AviWriter`, `repairAvi`, `AVI_HEADER_BYTES`, `MAX_SEGMENT_BYTES` (Task 3); `Segmenter`, `SegmentStart`, `SegmentSink` (Task 3); `FrameRecorder` (Task 2); `parseRange(header, size)` from `@/lib/range`.
- Produces:
  ```ts
  // types.ts
  export interface RecordingView { path: string; deviceId: string; deviceName: string; cameraCode: string | null; startedAt: string; durationS: number; sizeBytes: number; playable: boolean }
  // recordingPaths.ts
  export function recordingsRoot(env?: NodeJS.ProcessEnv): string;                 // RECORDINGS_ROOT or ../recordings, resolved from cwd
  export function segmentBase(deviceId: string, startedAt: number): string;         // '<id>/<YYYY-MM-DD>/<HHMMSS>' in UTC
  export function resolveRecordingPath(root: string, relativePath: string): string | null;
  // recorder.ts
  export interface RecorderOptions { root: string; fps: number; segmentMinutes: number; retentionHours: number; ffmpegPath: string }
  export interface Sidecar { schema: 'nesttrace.recording'; version: 1; deviceId: string; deviceName: string; cameraCode: string | null; startedAt: string; endedAt: string | null; durationS: number; fps: number; frameCount: number; width: number; height: number; file: string }
  export function recorderSettings(env?: NodeJS.ProcessEnv): RecorderOptions | null;   // null when RECORDING=off
  export function canRun(command: string, args: string[]): Promise<boolean>;
  export class Recorder implements FrameRecorder { constructor(options: RecorderOptions, hasFfmpeg: boolean); readonly options; readonly hasFfmpeg; addFrame(...); isRecording(id); closeIdle(now?: number): void; recover(): Promise<void>; sweep(now?: number): Promise<number>; list(limit?: number): Promise<RecordingView[]>; settled(): Promise<void>; closeAll(): Promise<void> }
  export function startRecorder(options: RecorderOptions): Promise<Recorder>;   // once per process; timers; signal handlers
  export function getRecorder(): Recorder | null;
  // recordingsHttp.ts
  export function getRecordingList(deps: { user: SessionUser | null; recorder: Pick<Recorder, 'list' | 'hasFfmpeg'> | null }): Promise<Response>;
  export function getRecordingFile(deps: { user: SessionUser | null; root: string }, relativePath: string, request: Request): Promise<Response>;
  ```
- HTTP: `GET /api/live/recordings` (ADMIN) → `{ enabled, convertsToMp4, recordings: RecordingView[] }`; `GET /api/live/recordings/<deviceId>/<date>/<HHMMSS>.mp4[?download=1]` (ADMIN, Range).

- [ ] **Step 1: Failing path tests**

`tests/unit/recordingPaths.test.ts`:
```ts
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recordingsRoot, resolveRecordingPath, segmentBase } from '@/lib/phones/recordingPaths';

const root = '/srv/recordings';

describe('recording paths', () =>
{
    it('lays segments out by device and UTC date and time', () =>
    {
        expect(segmentBase('ckd1', Date.UTC(2026, 9, 10, 7, 5, 9))).toBe('ckd1/2026-10-10/070509');
    });

    it('accepts only our own layout inside the root', () =>
    {
        expect(resolveRecordingPath(root, 'ckd1/2026-10-10/070509.mp4')).toBe(join(root, 'ckd1/2026-10-10/070509.mp4'));
        expect(resolveRecordingPath(root, 'ckd1/2026-10-10/070509-2.avi')).toBe(join(root, 'ckd1/2026-10-10/070509-2.avi'));
        for (const bad of ['../etc/passwd', '/etc/passwd', 'ckd1/../../x.mp4', 'ckd1/2026-10-10/070509.json', 'ckd1/2026-10-10/070509.avi.part',
            'ckd1/2026-10-10/%2e%2e.mp4', 'CKD1/2026-10-10/070509.mp4', 'ckd1\\2026-10-10\\070509.mp4', 'ckd1/2026-10-10/070509.mp4/..', ''])
        {
            expect(resolveRecordingPath(root, bad)).toBeNull();
        }
    });

    it('defaults to dashboard/recordings beside the web folder', () =>
    {
        expect(recordingsRoot({ RECORDINGS_ROOT: '/recordings' } as NodeJS.ProcessEnv)).toBe('/recordings');
        expect(recordingsRoot({} as NodeJS.ProcessEnv)).toBe(join(process.cwd(), '..', 'recordings'));
    });
});
```
Run → FAIL (module missing).

- [ ] **Step 2: Implement `recordingPaths.ts`**

```ts
import { isAbsolute, relative, resolve, sep } from 'node:path';

const LAYOUT = /^[a-z0-9]{1,40}\/\d{4}-\d{2}-\d{2}\/\d{6}(-\d{1,3})?\.(mp4|avi)$/;

export function recordingsRoot(env: NodeJS.ProcessEnv = process.env): string
{
    return resolve(process.cwd(), env.RECORDINGS_ROOT || '../recordings');
}

export function segmentBase(deviceId: string, startedAt: number): string
{
    const iso = new Date(startedAt).toISOString();
    return `${deviceId}/${iso.slice(0, 10)}/${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}`;
}

// Only finished segment files in our own layout; nothing outside the root.
export function resolveRecordingPath(root: string, relativePath: string): string | null
{
    if (!LAYOUT.test(relativePath))
    {
        return null;
    }
    const full = resolve(root, relativePath);
    const inside = relative(root, full);
    if (!inside || inside.startsWith('..') || isAbsolute(inside) || inside.split(sep).includes('..'))
    {
        return null;
    }
    return full;
}
```
Run → PASS.

- [ ] **Step 3: Failing recorder tests**

`tests/unit/recorder.test.ts`:
```ts
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Recorder, recorderSettings, type RecorderOptions, type Sidecar } from '@/lib/phones/recorder';
import { fakeJpeg, parseAvi } from './aviTestUtils';

const T0 = Date.UTC(2026, 9, 10, 7, 5, 9);
const meta = { deviceName: 'Dune phone', cameraCode: 'E1' };

function setup(ffmpeg: 'none' | 'ok' | 'fail' = 'none')
{
    const root = mkdtempSync(join(tmpdir(), 'nt-rec-'));
    const ffmpegPath = join(root, '..', `fake-ffmpeg-${ffmpeg}-${Math.random().toString(36).slice(2)}`);
    // Stands in for ffmpeg: answers -version, then writes "mp4" to its last argument (or fails).
    writeFileSync(ffmpegPath, ffmpeg === 'fail'
        ? '#!/bin/sh\nif [ "$1" = "-version" ]; then exit 0; fi\nexit 1\n'
        : '#!/bin/sh\nif [ "$1" = "-version" ]; then exit 0; fi\nfor last; do :; done\nprintf mp4 > "$last"\n');
    chmodSync(ffmpegPath, 0o755);
    const options: RecorderOptions = { root, fps: 5, segmentMinutes: 10, retentionHours: 72, ffmpegPath };
    return { root, options, make: () => new Recorder(options, ffmpeg !== 'none') };
}

const sidecar = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Sidecar;
const base = 'd1/2026-10-10/070509';

describe('Recorder', () =>
{
    it('writes an AVI and a sidecar per segment, keeping the .avi without ffmpeg', async () =>
    {
        const { root, make } = setup('none');
        const recorder = make();
        recorder.addFrame('d1', fakeJpeg(960, 540, 1), T0, meta);
        recorder.addFrame('d1', fakeJpeg(960, 540, 2), T0 + 600, { ...meta, cameraCode: 'B1' });
        expect(recorder.isRecording('d1')).toBe(true);
        await recorder.closeAll();
        expect(parseAvi(readFileSync(join(root, `${base}.avi`))).totalFrames).toBe(4);
        expect(sidecar(join(root, `${base}.json`))).toEqual({
            schema: 'nesttrace.recording', version: 1, deviceId: 'd1', deviceName: 'Dune phone', cameraCode: 'E1',
            startedAt: new Date(T0).toISOString(), endedAt: new Date(T0 + 800).toISOString(), durationS: 0.8, fps: 5, frameCount: 4, width: 960, height: 540, file: '070509.avi',
        });
        const [listed] = await recorder.list();
        expect(listed).toMatchObject({ path: `${base}.avi`, deviceId: 'd1', cameraCode: 'E1', durationS: 0.8, playable: false });
    });

    it('converts with ffmpeg, then points the sidecar at the mp4 and deletes the avi', async () =>
    {
        const { root, make } = setup('ok');
        const recorder = make();
        recorder.addFrame('d1', fakeJpeg(960, 540, 1), T0, meta);
        await recorder.closeAll();
        expect(readFileSync(join(root, `${base}.mp4`), 'utf8')).toBe('mp4');
        expect(existsSync(join(root, `${base}.avi`))).toBe(false);
        expect(sidecar(join(root, `${base}.json`)).file).toBe('070509.mp4');
        expect((await recorder.list())[0]).toMatchObject({ path: `${base}.mp4`, playable: true, sizeBytes: 3 });
    });

    it('keeps the avi when ffmpeg fails', async () =>
    {
        const { root, make } = setup('fail');
        const recorder = make();
        recorder.addFrame('d1', fakeJpeg(960, 540, 1), T0, meta);
        await recorder.closeAll();
        expect(existsSync(join(root, `${base}.avi`))).toBe(true);
        expect(existsSync(join(root, `${base}.mp4`))).toBe(false);
        expect(sidecar(join(root, `${base}.json`)).file).toBe('070509.avi');
    });

    it('repairs and converts a segment a killed process left behind', async () =>
    {
        const { root, make } = setup('ok');
        const killed = make();
        for (let i = 0; i < 3; i++)
        {
            killed.addFrame('d1', fakeJpeg(960, 540, i), T0 + i * 200, meta);
        }
        await killed.settled();
        expect(sidecar(join(root, `${base}.json`)).file).toBe('070509.avi.part');
        expect(await killed.list()).toEqual([]);

        const next = make();
        await next.recover();
        await next.settled();
        const repaired = sidecar(join(root, `${base}.json`));
        expect(repaired).toMatchObject({ file: '070509.mp4', frameCount: 3, endedAt: new Date(T0 + 600).toISOString() });
        expect(existsSync(join(root, `${base}.avi.part`))).toBe(false);
    });

    it('never reuses a file name when a device starts twice in one second', async () =>
    {
        const { root, make } = setup('none');
        const recorder = make();
        recorder.addFrame('d1', fakeJpeg(960, 540, 1), T0, meta);
        recorder.addFrame('d1', fakeJpeg(1280, 720, 2), T0 + 300, meta);
        await recorder.closeAll();
        expect(existsSync(join(root, `${base}.avi`))).toBe(true);
        expect(existsSync(join(root, `${base}-2.avi`))).toBe(true);
    });

    it('deletes recordings that ended more than 72 h ago', async () =>
    {
        const { root, make } = setup('none');
        const recorder = make();
        const write = (name: string, endedAt: number) =>
        {
            mkdirSync(join(root, 'd1/2026-10-01'), { recursive: true });
            writeFileSync(join(root, `d1/2026-10-01/${name}.mp4`), 'x');
            writeFileSync(join(root, `d1/2026-10-01/${name}.json`), JSON.stringify({ schema: 'nesttrace.recording', version: 1, deviceId: 'd1', deviceName: 'p', cameraCode: null, startedAt: new Date(endedAt - 600_000).toISOString(), endedAt: new Date(endedAt).toISOString(), durationS: 600, fps: 5, frameCount: 3000, width: 960, height: 540, file: `${name}.mp4` }));
        };
        write('old', T0 - 73 * 3_600_000);
        write('new', T0 - 71 * 3_600_000);
        expect(await recorder.sweep(T0)).toBe(1);
        expect(existsSync(join(root, 'd1/2026-10-01/old.mp4'))).toBe(false);
        expect(existsSync(join(root, 'd1/2026-10-01/old.json'))).toBe(false);
        expect(existsSync(join(root, 'd1/2026-10-01/new.mp4'))).toBe(true);
    });
});

describe('recorderSettings', () =>
{
    it('reads the environment', () =>
    {
        expect(recorderSettings({ RECORDING: 'off' } as NodeJS.ProcessEnv)).toBeNull();
        expect(recorderSettings({ RECORDINGS_ROOT: '/recordings' } as NodeJS.ProcessEnv)).toEqual({ root: '/recordings', fps: 5, segmentMinutes: 10, retentionHours: 72, ffmpegPath: 'ffmpeg' });
        expect(recorderSettings({ RECORDINGS_ROOT: '/r', RECORDING_RETENTION_HOURS: '24', FFMPEG_PATH: '/usr/bin/ffmpeg' } as NodeJS.ProcessEnv)).toMatchObject({ retentionHours: 24, ffmpegPath: '/usr/bin/ffmpeg' });
        expect(recorderSettings({ RECORDINGS_ROOT: '/r', RECORDING_RETENTION_HOURS: 'soon' } as NodeJS.ProcessEnv)?.retentionHours).toBe(72);
    });
});
```
Run: `npx vitest run tests/unit/recorder.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 4: Implement `recorder.ts`** (port of `recorder.mjs` conversion, listing, retention, start-up conversion)

```ts
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import type { RecordingView } from '@/lib/types';
import { AVI_HEADER_BYTES, AviWriter, MAX_SEGMENT_BYTES, repairAvi } from './avi';
import type { FrameRecorder } from './http';
import { recordingsRoot, segmentBase } from './recordingPaths';
import { Segmenter, type SegmentMeta, type SegmentSink, type SegmentStart } from './segmenter';

export interface RecorderOptions
{
    root: string;
    fps: number;
    segmentMinutes: number;
    retentionHours: number;
    ffmpegPath: string;
}

// Written when a segment opens (file = .avi.part) and rewritten when it closes or converts.
export interface Sidecar
{
    schema: 'nesttrace.recording';
    version: 1;
    deviceId: string;
    deviceName: string;
    cameraCode: string | null;
    startedAt: string;
    endedAt: string | null;
    durationS: number;
    fps: number;
    frameCount: number;
    width: number;
    height: number;
    file: string;
}

const MAX_GAP_MS = 10_000;

export function recorderSettings(env: NodeJS.ProcessEnv = process.env): RecorderOptions | null
{
    if (env.RECORDING === 'off')
    {
        return null;
    }
    const hours = Number(env.RECORDING_RETENTION_HOURS ?? 72);
    return { root: recordingsRoot(env), fps: 5, segmentMinutes: 10, retentionHours: Number.isFinite(hours) && hours > 0 ? hours : 72, ffmpegPath: env.FFMPEG_PATH || 'ffmpeg' };
}

export function canRun(command: string, args: string[]): Promise<boolean>
{
    return new Promise(resolve =>
    {
        const child = spawn(command, args, { stdio: 'ignore' });
        child.on('error', () => resolve(false));
        child.on('exit', code => resolve(code === 0));
    });
}

async function findSidecars(root: string): Promise<string[]>
{
    const entries = await readdir(root, { withFileTypes: true, recursive: true }).catch(() => []);
    return entries.filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => join(entry.parentPath, entry.name));
}

async function readSidecar(path: string): Promise<Sidecar | null>
{
    try
    {
        const value = JSON.parse(await readFile(path, 'utf8')) as Sidecar;
        return value.schema === 'nesttrace.recording' && typeof value.file === 'string' && typeof value.startedAt === 'string' ? value : null;
    }
    catch
    {
        return null;
    }
}

async function writeSidecar(base: string, sidecar: Sidecar): Promise<void>
{
    await writeFile(`${base}.json.tmp`, JSON.stringify(sidecar, null, 2));
    await rename(`${base}.json.tmp`, `${base}.json`);
}

function sidecarOf(start: SegmentStart, frameCount: number, file: string, closed: boolean): Sidecar
{
    const durationS = frameCount / start.fps;
    return {
        schema: 'nesttrace.recording', version: 1, deviceId: start.deviceId, deviceName: start.deviceName, cameraCode: start.cameraCode,
        startedAt: new Date(start.startedAt).toISOString(), endedAt: closed ? new Date(start.startedAt + durationS * 1000).toISOString() : null,
        durationS, fps: start.fps, frameCount, width: start.width, height: start.height, file,
    };
}

export class Recorder implements FrameRecorder
{
    private segmenter: Segmenter;
    private pending = new Set<Promise<void>>();
    private conversions: Promise<void> = Promise.resolve();
    private bases = new Set<string>();

    constructor(readonly options: RecorderOptions, readonly hasFfmpeg: boolean)
    {
        this.segmenter = new Segmenter({ fps: options.fps, segmentMs: options.segmentMinutes * 60_000, maxGapMs: MAX_GAP_MS, maxBytes: MAX_SEGMENT_BYTES, open: start => this.openSink(start) });
    }

    addFrame(deviceId: string, jpeg: Buffer, at: number, meta: SegmentMeta): void
    {
        this.segmenter.addFrame(deviceId, jpeg, at, meta);
    }

    isRecording(deviceId: string): boolean
    {
        return this.segmenter.isRecording(deviceId);
    }

    closeIdle(now: number = Date.now()): void
    {
        this.segmenter.closeIdle(now);
    }

    async closeAll(): Promise<void>
    {
        this.segmenter.closeAll();
        await this.settled();
    }

    // Resolves when every queued file write, close and conversion has finished.
    async settled(): Promise<void>
    {
        while (this.pending.size > 0)
        {
            await Promise.all([...this.pending]);
        }
        await this.conversions;
    }

    // Start-up: finish segments a killed process left as .avi.part, and convert leftover .avi files.
    async recover(): Promise<void>
    {
        for (const path of await findSidecars(this.options.root))
        {
            const sidecar = await readSidecar(path);
            const base = path.slice(0, -'.json'.length);
            if (sidecar?.file.endsWith('.avi.part'))
            {
                const repaired = await repairAvi(`${base}.avi.part`, sidecar.fps).catch(() => null);
                if (!repaired)
                {
                    continue;
                }
                await rename(`${base}.avi.part`, `${base}.avi`);
                const start = Date.parse(sidecar.startedAt);
                const durationS = repaired.frameCount / sidecar.fps;
                await writeSidecar(base, { ...sidecar, frameCount: repaired.frameCount, durationS, endedAt: new Date(start + durationS * 1000).toISOString(), file: `${basename(base)}.avi` });
                this.queueConversion(base);
            }
            else if (sidecar?.file.endsWith('.avi'))
            {
                this.queueConversion(base);
            }
        }
    }

    // Deletes every recording that ended more than retentionHours before `now`. Returns how many.
    async sweep(now: number = Date.now()): Promise<number>
    {
        const cutoff = now - this.options.retentionHours * 3_600_000;
        let removed = 0;
        for (const path of await findSidecars(this.options.root))
        {
            const sidecar = await readSidecar(path);
            if (!sidecar)
            {
                continue;
            }
            const end = sidecar.endedAt ? Date.parse(sidecar.endedAt) : Date.parse(sidecar.startedAt) + this.options.segmentMinutes * 60_000;
            if (end >= cutoff)
            {
                continue;
            }
            const base = path.slice(0, -'.json'.length);
            await Promise.all(['.avi.part', '.avi', '.mp4', '.json'].map(extension => rm(base + extension, { force: true })));
            removed += 1;
        }
        return removed;
    }

    // Finished segments, newest first; `path` is relative to the root with forward slashes.
    async list(limit = 200): Promise<RecordingView[]>
    {
        const views: RecordingView[] = [];
        for (const path of await findSidecars(this.options.root))
        {
            const sidecar = await readSidecar(path);
            if (!sidecar || sidecar.file.endsWith('.part'))
            {
                continue;
            }
            const video = join(dirname(path), sidecar.file);
            const info = await stat(video).catch(() => null);
            if (!info?.isFile())
            {
                continue;
            }
            views.push({
                path: relative(this.options.root, video).split(sep).join('/'), deviceId: sidecar.deviceId, deviceName: sidecar.deviceName, cameraCode: sidecar.cameraCode,
                startedAt: sidecar.startedAt, durationS: sidecar.durationS, sizeBytes: info.size, playable: sidecar.file.endsWith('.mp4'),
            });
        }
        return views.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
    }

    private baseFor(start: SegmentStart): string
    {
        const plain = join(this.options.root, segmentBase(start.deviceId, start.startedAt));
        for (let n = 1; ; n++)
        {
            const candidate = n === 1 ? plain : `${plain}-${n}`;
            if (!this.bases.has(candidate) && !existsSync(`${candidate}.json`))
            {
                this.bases.add(candidate);
                return candidate;
            }
        }
    }

    private openSink(start: SegmentStart): SegmentSink
    {
        const base = this.baseFor(start);
        const name = basename(base);
        const ready = (async () =>
        {
            await mkdir(dirname(base), { recursive: true });
            await writeSidecar(base, sidecarOf(start, 0, `${name}.avi.part`, false));
            return AviWriter.create(`${base}.avi.part`, start.width, start.height, start.fps);
        })();
        const sink = {
            bytes: AVI_HEADER_BYTES,
            write: (jpeg: Buffer) =>
            {
                sink.bytes += 8 + jpeg.length + (jpeg.length % 2);
                // Tracked until the bytes are on disk, so settled() means "nothing in flight".
                this.track(ready.then(writer => { writer.write(jpeg); return writer.flush(); }));
            },
            close: (frameCount: number) =>
            {
                this.track((async () =>
                {
                    const writer = await ready;
                    await writer.finish();
                    await rename(`${base}.avi.part`, `${base}.avi`);
                    await writeSidecar(base, sidecarOf(start, frameCount, `${name}.avi`, true));
                    this.queueConversion(base);
                })());
            },
        };
        return sink;
    }

    // One conversion at a time so phones never fight for CPU. The sidecar moves to the mp4 before the avi goes.
    private queueConversion(base: string): void
    {
        if (!this.hasFfmpeg)
        {
            return;
        }
        this.conversions = this.conversions.then(async () =>
        {
            const ok = await canRun(this.options.ffmpegPath, [
                '-y', '-loglevel', 'error', '-i', `${base}.avi`,
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p',
                '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-movflags', '+faststart', `${base}.mp4`,
            ]);
            if (!ok)
            {
                console.error(`Could not convert ${base}.avi to mp4; keeping the .avi.`);
                await rm(`${base}.mp4`, { force: true });
                return;
            }
            const sidecar = await readSidecar(`${base}.json`);
            if (sidecar)
            {
                await writeSidecar(base, { ...sidecar, file: `${basename(base)}.mp4` });
            }
            await rm(`${base}.avi`, { force: true });
        }).catch((error: unknown) => { console.error('Recording conversion failed:', (error as Error).message); });
    }

    private track(work: Promise<unknown>): void
    {
        const tracked: Promise<void> = work.then(() => undefined, (error: unknown) => { console.error('Recording write failed:', (error as Error).message); })
            .finally(() => { this.pending.delete(tracked); });
        this.pending.add(tracked);
    }
}

const globalRecorder = globalThis as unknown as { __nesttraceRecorder?: Recorder };

export function getRecorder(): Recorder | null
{
    return globalRecorder.__nesttraceRecorder ?? null;
}

// Called once from instrumentation.ts in the web process.
export async function startRecorder(options: RecorderOptions): Promise<Recorder>
{
    if (globalRecorder.__nesttraceRecorder)
    {
        return globalRecorder.__nesttraceRecorder;
    }
    await mkdir(options.root, { recursive: true });
    const recorder = new Recorder(options, await canRun(options.ffmpegPath, ['-version']));
    globalRecorder.__nesttraceRecorder = recorder;
    await recorder.recover();
    void recorder.sweep();
    setInterval(() => recorder.closeIdle(), 5_000).unref();
    setInterval(() => { void recorder.sweep(); }, 3_600_000).unref();
    // Best effort: finish open files on stop (5 s cap). Anything cut off is repaired by recover() next start.
    const stop = () => { void Promise.race([recorder.closeAll(), new Promise(resolve => setTimeout(resolve, 5_000))]).finally(() => process.exit(0)); };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    console.log(`Recording phones to ${options.root}${recorder.hasFfmpeg ? ' (converted to mp4)' : ' as .avi (ffmpeg not found)'}`);
    return recorder;
}
```
Add `RecordingView` to `src/lib/types.ts`:
```ts
export interface RecordingView
{
    path: string;
    deviceId: string;
    deviceName: string;
    cameraCode: string | null;
    startedAt: string;
    durationS: number;
    sizeBytes: number;
    playable: boolean;
}
```
Run recorder tests → PASS (7).

- [ ] **Step 5: Failing recordings-route tests**

`tests/unit/recordings-http.test.ts`:
```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@/lib/auth/session';
import { getRecordingFile, getRecordingList } from '@/lib/phones/recordingsHttp';

const user = (role: SessionUser['role']): SessionUser => ({ id: 'u', email: 'u@x.y', name: 'U', role });
const root = mkdtempSync(join(tmpdir(), 'nt-rhttp-'));
mkdirSync(join(root, 'ckd1/2026-10-10'), { recursive: true });
writeFileSync(join(root, 'ckd1/2026-10-10/070509.mp4'), '0123456789');
writeFileSync(join(root, 'secret.mp4'), 'nope');
const get = (path: string, role: SessionUser['role'] | null = 'ADMIN', headers: Record<string, string> = {}, query = '') =>
    getRecordingFile({ user: role ? user(role) : null, root }, path, new Request(`https://x/api/live/recordings/${path}${query}`, { headers }));

describe('recordings routes', () =>
{
    it('are for admins only', async () =>
    {
        expect((await get('ckd1/2026-10-10/070509.mp4', null)).status).toBe(401);
        expect((await get('ckd1/2026-10-10/070509.mp4', 'VOLUNTEER')).status).toBe(403);
        expect((await get('ckd1/2026-10-10/070509.mp4', 'VIEWER')).status).toBe(403);
        expect((await getRecordingList({ user: user('VIEWER'), recorder: null })).status).toBe(403);
        expect((await getRecordingList({ user: null, recorder: null })).status).toBe(401);
    });

    it('serves a file with ranges and an optional download name', async () =>
    {
        const full = await get('ckd1/2026-10-10/070509.mp4');
        expect(full.status).toBe(200);
        expect(full.headers.get('content-type')).toBe('video/mp4');
        expect(await full.text()).toBe('0123456789');
        const part = await get('ckd1/2026-10-10/070509.mp4', 'ADMIN', { range: 'bytes=2-4' });
        expect(part.status).toBe(206);
        expect(part.headers.get('content-range')).toBe('bytes 2-4/10');
        expect(await part.text()).toBe('234');
        expect((await get('ckd1/2026-10-10/070509.mp4', 'ADMIN', { range: 'bytes=50-' })).status).toBe(416);
        expect((await get('ckd1/2026-10-10/070509.mp4', 'ADMIN', {}, '?download=1')).headers.get('content-disposition')).toBe('attachment; filename="ckd1_2026-10-10_070509.mp4"');
    });

    it('refuses anything outside the layout, and missing files', async () =>
    {
        for (const bad of ['../secret.mp4', 'secret.mp4', 'ckd1/../secret.mp4', 'ckd1/2026-10-10/070509.json', 'ckd1/2026-10-10/999999.mp4'])
        {
            expect((await get(bad)).status).toBe(404);
        }
    });

    it('lists recordings, or says recording is off', async () =>
    {
        const off = await getRecordingList({ user: user('ADMIN'), recorder: null });
        expect(await off.json()).toEqual({ enabled: false, convertsToMp4: false, recordings: [] });
        const on = await getRecordingList({ user: user('ADMIN'), recorder: { hasFfmpeg: true, list: async () => [] } });
        expect(await on.json()).toEqual({ enabled: true, convertsToMp4: true, recordings: [] });
    });
});
```
Run → FAIL (module missing).

- [ ] **Step 6: Implement `recordingsHttp.ts`, routes, wiring, instrumentation, Compose**

`src/lib/phones/recordingsHttp.ts`:
```ts
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import type { SessionUser } from '@/lib/auth/session';
import { parseRange } from '@/lib/range';
import type { Recorder } from './recorder';
import { resolveRecordingPath } from './recordingPaths';

function adminCheck(user: SessionUser | null): Response | null
{
    if (!user)
    {
        return new Response('Unauthorized', { status: 401 });
    }
    return user.role === 'ADMIN' ? null : new Response('Forbidden', { status: 403 });
}

export async function getRecordingList(deps: { user: SessionUser | null; recorder: Pick<Recorder, 'list' | 'hasFfmpeg'> | null }): Promise<Response>
{
    const refused = adminCheck(deps.user);
    if (refused)
    {
        return refused;
    }
    if (!deps.recorder)
    {
        return Response.json({ enabled: false, convertsToMp4: false, recordings: [] }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({ enabled: true, convertsToMp4: deps.recorder.hasFfmpeg, recordings: await deps.recorder.list() }, { headers: { 'Cache-Control': 'no-store' } });
}

// One recording file, with byte ranges so the player can seek. The path must match our layout inside the root.
export async function getRecordingFile(deps: { user: SessionUser | null; root: string }, relativePath: string, request: Request): Promise<Response>
{
    const refused = adminCheck(deps.user);
    if (refused)
    {
        return refused;
    }
    const full = resolveRecordingPath(deps.root, relativePath);
    const info = full ? await stat(full).catch(() => null) : null;
    if (!full || !info?.isFile())
    {
        return new Response('Not found', { status: 404 });
    }
    const size = info.size;
    const headers = new Headers({ 'Content-Type': extname(full) === '.mp4' ? 'video/mp4' : 'video/x-msvideo', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store' });
    if (new URL(request.url).searchParams.get('download') === '1')
    {
        headers.set('Content-Disposition', `attachment; filename="${relativePath.split('/').join('_')}"`);
    }
    const range = parseRange(request.headers.get('range'), size);
    if (range === 'unsatisfiable')
    {
        headers.set('Content-Range', `bytes */${size}`);
        return new Response(null, { status: 416, headers });
    }
    const { start, end } = range ?? { start: 0, end: size - 1 };
    headers.set('Content-Length', String(end - start + 1));
    if (range)
    {
        headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    return new Response(Readable.toWeb(createReadStream(full, { start, end })) as ReadableStream, { status: range ? 206 : 200, headers });
}
```
`src/app/api/live/recordings/route.ts`:
```ts
import { currentUserOrNull } from '@/lib/auth/guard';
import { getRecorder } from '@/lib/phones/recorder';
import { getRecordingList } from '@/lib/phones/recordingsHttp';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response>
{
    return getRecordingList({ user: await currentUserOrNull(), recorder: getRecorder() });
}
```
`src/app/api/live/recordings/[...path]/route.ts`:
```ts
import { currentUserOrNull } from '@/lib/auth/guard';
import { getRecorder } from '@/lib/phones/recorder';
import { recordingsRoot } from '@/lib/phones/recordingPaths';
import { getRecordingFile } from '@/lib/phones/recordingsHttp';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response>
{
    const { path } = await context.params;
    return getRecordingFile({ user: await currentUserOrNull(), root: getRecorder()?.options.root ?? recordingsRoot() }, path.join('/'), request);
}
```
Wire the recorder into both phone routes: in `api/live/devices/route.ts` `GET` and `api/live/frame/[deviceId]/route.ts` `POST`, add `recorder: getRecorder()` to the deps (`import { getRecorder } from '@/lib/phones/recorder';`).

`src/instrumentation.ts`:
```ts
export async function register()
{
    if (process.env.NEXT_RUNTIME !== 'nodejs')
    {
        return;
    }
    if (process.env.LIVE_FEED === '1')
    {
        const { prisma } = await import('@/lib/db');
        const { liveSettings, startLiveWatcher } = await import('@/lib/live/watcher');
        startLiveWatcher(prisma, liveSettings());
    }
    const { recorderSettings, startRecorder } = await import('@/lib/phones/recorder');
    const settings = recorderSettings();
    if (settings)
    {
        await startRecorder(settings);
    }
}
```
`dashboard/docker-compose.yml` `web`: add `RECORDINGS_ROOT: /recordings` under `environment` and `- ./recordings:/recordings` under `volumes`.
`dashboard/.env.example`: append
```bash
# Phone recordings (git-ignored). Host path outside Docker; Compose mounts ./recordings at /recordings.
RECORDINGS_ROOT=../recordings
# Delete recordings older than this many hours (swept hourly).
RECORDING_RETENTION_HOURS=72
# Set RECORDING=off to stop recording phones (live view still works).
RECORDING=
```

Run: `npx vitest run tests/unit/recordingPaths.test.ts tests/unit/recorder.test.ts tests/unit/recordings-http.test.ts && npx vitest run && npx tsc --noEmit` → PASS.
Smoke on the host: `npm run dev`, then confirm that `ls ../recordings` exists and the dev log shows `Recording phones to …/dashboard/recordings as .avi (ffmpeg not found)` (the host has no ffmpeg; Docker gets it in Task 8).

- [ ] **Step 7: Commit**

```bash
git add dashboard/web/src/lib/phones/recordingPaths.ts dashboard/web/src/lib/phones/recorder.ts dashboard/web/src/lib/phones/recordingsHttp.ts dashboard/web/src/lib/types.ts dashboard/web/src/app/api/live/recordings dashboard/web/src/app/api/live/devices/route.ts "dashboard/web/src/app/api/live/frame/[deviceId]/route.ts" dashboard/web/src/instrumentation.ts dashboard/docker-compose.yml dashboard/.env.example dashboard/web/tests/unit/recordingPaths.test.ts dashboard/web/tests/unit/recorder.test.ts dashboard/web/tests/unit/recordings-http.test.ts
git commit -m "feat(dashboard): record phones to 10-minute segments with mp4 conversion and 72 h retention" -m "Ports segment conversion, listing and retention from elpaelpa's live-phone-cameras work (commits 3981767 and 4b313f1). Recordings stay on local disk under RECORDINGS_ROOT and are served to admins only."
```

---

### Task 5: `/cam` phone page

**Files:**
- Create: `dashboard/web/src/app/cam/page.tsx`, `dashboard/web/src/features/phones/CamSender.tsx`, `dashboard/web/src/features/phones/camMessages.ts`, `dashboard/web/src/lib/auth/safeNext.ts`, `dashboard/web/src/app/(auth)/login/LoginForm.tsx`
- Modify: `dashboard/web/src/app/(auth)/login/page.tsx` (becomes a server wrapper), `dashboard/web/src/app/(auth)/login/actions.ts`
- Test: `dashboard/web/tests/unit/camMessages.test.ts`, `dashboard/web/tests/unit/safeNext.test.ts`, `dashboard/web/tests/unit/camSender.test.tsx`

**Interfaces:**
- Consumes: `POST /api/live/devices` → `{ id, name, cameraCode }`; `POST /api/live/frame/<id>` → `{ at, cameraCode, recording }` or 401/403/413/415/429 (Task 2); `currentUserOrNull()`.
- Produces:
  ```ts
  // camMessages.ts
  export type QualityName = 'standard' | 'high';
  export const QUALITY_PRESETS: Record<QualityName, { label: string; width: number; height: number; jpegQuality: number }>;
  export const SEND_FPS = 5; export const PHONE_NAME_KEY = 'nesttrace.phoneName';
  export const MESSAGES: { https: string; permission: string; noCamera: string; busy: string; signedOut: string; refused: string; tooLarge: string; offline: string; viewer: string };
  export function describeMediaError(error: unknown): string;
  export function describeFrameStatus(status: number): string | null;   // null: retry quietly (429)
  // safeNext.ts
  export function safeNext(value: unknown): string | null;
  // CamSender.tsx
  export function CamSender(props: { user: { name: string; role: Role } }): JSX.Element;
  ```

- [ ] **Step 1: Failing tests**

`tests/unit/camMessages.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { describeFrameStatus, describeMediaError, MESSAGES, QUALITY_PRESETS, SEND_FPS } from '@/features/phones/camMessages';

describe('phone page messages', () =>
{
    it('pins the presets and send rate', () =>
    {
        expect(QUALITY_PRESETS.standard).toMatchObject({ width: 960, height: 540, jpegQuality: 0.7 });
        expect(QUALITY_PRESETS.high).toMatchObject({ width: 1280, height: 720, jpegQuality: 0.8 });
        expect(SEND_FPS).toBe(5);
    });

    it('explains camera errors in plain words', () =>
    {
        expect(describeMediaError(new DOMException('x', 'NotAllowedError'))).toBe(MESSAGES.permission);
        expect(describeMediaError(new DOMException('x', 'SecurityError'))).toBe(MESSAGES.permission);
        expect(describeMediaError(new DOMException('x', 'NotFoundError'))).toBe(MESSAGES.noCamera);
        expect(describeMediaError(new DOMException('x', 'OverconstrainedError'))).toBe(MESSAGES.noCamera);
        expect(describeMediaError(new DOMException('x', 'NotReadableError'))).toBe(MESSAGES.busy);
        expect(describeMediaError(new Error('boom'))).toBe('Could not open the camera (Error).');
    });

    it('explains refused frames, and retries quietly when too fast', () =>
    {
        expect(describeFrameStatus(401)).toBe(MESSAGES.signedOut);
        expect(describeFrameStatus(403)).toBe(MESSAGES.refused);
        expect(describeFrameStatus(413)).toBe(MESSAGES.tooLarge);
        expect(describeFrameStatus(429)).toBeNull();
        expect(describeFrameStatus(500)).toBe('The server refused a frame (error 500).');
    });
});
```
`tests/unit/safeNext.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { safeNext } from '@/lib/auth/safeNext';

describe('safeNext', () =>
{
    it('allows only same-site absolute paths', () =>
    {
        expect(safeNext('/cam')).toBe('/cam');
        expect(safeNext('/live/motion?device=ck1')).toBe('/live/motion?device=ck1');
        for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'cam', '/ cam', '', null, undefined, 42, `/${'a'.repeat(300)}`])
        {
            expect(safeNext(bad)).toBeNull();
        }
    });
});
```
`tests/unit/camSender.test.tsx`:
```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CamSender } from '@/features/phones/CamSender';
import { MESSAGES } from '@/features/phones/camMessages';

afterEach(() =>
{
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
});

const volunteer = { name: 'Vo', role: 'VOLUNTEER' as const };

describe('CamSender', () =>
{
    it('tells a viewer they can watch but not send', () =>
    {
        render(<CamSender user={{ name: 'Vi', role: 'VIEWER' }} />);
        expect(screen.getByText(MESSAGES.viewer)).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
    });

    it('remembers the phone name and defaults to the rear camera and Standard quality', () =>
    {
        localStorage.setItem('nesttrace.phoneName', 'Dune phone');
        render(<CamSender user={volunteer} />);
        expect((screen.getByLabelText('Phone name') as HTMLInputElement).value).toBe('Dune phone');
        expect((screen.getByLabelText('Camera') as HTMLSelectElement).value).toBe('environment');
        expect((screen.getByLabelText('Quality') as HTMLSelectElement).value).toBe('standard');
    });

    it('explains that the page must be on HTTPS', async () =>
    {
        vi.stubGlobal('isSecureContext', false);
        render(<CamSender user={volunteer} />);
        fireEvent.change(screen.getByLabelText('Phone name'), { target: { value: 'Dune phone' } });
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        expect((await screen.findByRole('alert')).textContent).toBe(MESSAGES.https);
    });

    it('explains a refused camera permission and does not register the phone', async () =>
    {
        vi.stubGlobal('isSecureContext', true);
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError')) } });
        render(<CamSender user={volunteer} />);
        fireEvent.change(screen.getByLabelText('Phone name'), { target: { value: 'Dune phone' } });
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        expect((await screen.findByRole('alert')).textContent).toBe(MESSAGES.permission);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
```
Run: `npx vitest run tests/unit/camMessages.test.ts tests/unit/safeNext.test.ts tests/unit/camSender.test.tsx`. Expected: FAIL (modules missing).

- [ ] **Step 2: Implement helpers**

`src/features/phones/camMessages.ts`:
```ts
export type QualityName = 'standard' | 'high';

export const QUALITY_PRESETS: Record<QualityName, { label: string; width: number; height: number; jpegQuality: number }> = {
    standard: { label: 'Standard (960×540)', width: 960, height: 540, jpegQuality: 0.7 },
    high: { label: 'High (1280×720)', width: 1280, height: 720, jpegQuality: 0.8 },
};

// Matches the 5 fps recording timeline and stays under the server's 10 frames/s cap.
export const SEND_FPS = 5;
export const PHONE_NAME_KEY = 'nesttrace.phoneName';

export const MESSAGES = {
    https: 'This page is not on HTTPS, so the browser blocks the camera. Open the https:// address from the Connect phone QR code.',
    permission: 'Camera permission was denied. Allow camera access for this site in the browser settings, then press Start again.',
    noCamera: 'No camera was found on this device.',
    busy: 'The camera is in use by another app. Close it and press Start again.',
    signedOut: 'You were signed out. Sign in again to keep sending.',
    refused: 'The server refused this phone: your account cannot send, or an admin removed this phone.',
    tooLarge: 'A frame was larger than 500 KB. Choose Standard quality and press Start again.',
    offline: 'Connection lost. Retrying…',
    viewer: 'Your account can watch but not send.',
};

export function describeMediaError(error: unknown): string
{
    const name = error instanceof Error || error instanceof DOMException ? error.name : 'Error';
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError')
    {
        return MESSAGES.permission;
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError')
    {
        return MESSAGES.noCamera;
    }
    if (name === 'NotReadableError' || name === 'TrackStartError')
    {
        return MESSAGES.busy;
    }
    return `Could not open the camera (${name}).`;
}

export function describeFrameStatus(status: number): string | null
{
    if (status === 429)
    {
        return null;
    }
    if (status === 401)
    {
        return MESSAGES.signedOut;
    }
    if (status === 403)
    {
        return MESSAGES.refused;
    }
    if (status === 413)
    {
        return MESSAGES.tooLarge;
    }
    return `The server refused a frame (error ${status}).`;
}
```
`src/lib/auth/safeNext.ts`:
```ts
// A same-site path to return to after sign-in (e.g. the phone's /cam); anything else is ignored.
export function safeNext(value: unknown): string | null
{
    return typeof value === 'string' && value.length <= 200 && /^\/(?![/\\])[\x21-\x7e]*$/.test(value) ? value : null;
}
```

- [ ] **Step 3: Login returns to `next`**

- Move the current client component in `src/app/(auth)/login/page.tsx` to `LoginForm.tsx` as `export function LoginForm({ next }: { next: string | null })`, unchanged except for `{next && <input type="hidden" name="next" value={next} />}` inside the form.
- New `page.tsx` (server):
  ```tsx
  import { safeNext } from '@/lib/auth/safeNext';
  import { LoginForm } from './LoginForm';

  export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> })
  {
      const { next } = await searchParams;
      return <LoginForm next={safeNext(typeof next === 'string' ? next : null)} />;
  }
  ```
- `actions.ts`: replace `redirect('/')` with `redirect(safeNext(form.get('next')) ?? '/')`.

- [ ] **Step 4: `/cam` page and `CamSender`**

`src/app/cam/page.tsx` (outside `(app)` so the sign-in redirect can carry `next`):
```tsx
import { redirect } from 'next/navigation';
import { currentUserOrNull } from '@/lib/auth/guard';
import { CamSender } from '@/features/phones/CamSender';

export const dynamic = 'force-dynamic';

export default async function CamPage()
{
    const user = await currentUserOrNull();
    if (!user)
    {
        redirect('/login?next=/cam');
    }
    return <CamSender user={{ name: user.name, role: user.role }} />;
}
```
`src/features/phones/CamSender.tsx` (`'use client'`). The structure follows the teammate's `CameraSender.jsx`. Behaviour list; every item is verifiable in the tests above or by hand on a phone:
1. Full-height dark page in the dashboard's visual language (`bg-night-950`, `GlassPanel`), phone-first: one column, 16 px gutters, at least 44 px tall controls, no horizontal scroll at 360 px. Header "NestTrace camera" and "Signed in as <name>".
2. **VIEWER:** shows `MESSAGES.viewer` and a link "Back to the dashboard" (`/`). No form, no camera access.
3. **Form (VOLUNTEER/ADMIN):** `Phone name` text input (`maxLength 60`, required, initial value from `localStorage[PHONE_NAME_KEY]` read in a `try`), `Camera` select (`environment` "Rear (default)" / `user` "Front"), `Quality` select from `QUALITY_PRESETS` (default `standard`), button **Start**.
4. **Start** runs in this order; each failure shows its message in a `role="alert"` paragraph and stays on the form:
   1. If `!window.isSecureContext || !navigator.mediaDevices?.getUserMedia`, show `MESSAGES.https`.
   2. Call `getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: preset.width }, height: { ideal: preset.height } } })`; on rejection show `describeMediaError(error)`.
   3. `POST /api/live/devices` with `{ name }`. A non-OK response shows `describeFrameStatus(status)` (400 shows the server's `error` text) and stops the stream tracks.
   4. Save the name to localStorage (in a `try`), attach the stream to a muted `playsInline` `<video>`, `await video.play()`, and request a Screen Wake Lock (`navigator.wakeLock?.request('screen')`, failure ignored).
5. **Send loop**, cancelled by a run counter like the teammate's `runIdRef`:
   - Draw the video into a canvas scaled to `min(1, preset.width / videoWidth)`, keeping the aspect ratio, then `toBlob('image/jpeg', preset.jpegQuality)`.
   - A blob over 500 KB is re-encoded once at quality 0.6; if it is still too large the frame is skipped.
   - POST the blob to `/api/live/frame/<id>` (`Content-Type: image/jpeg`), one request at a time, then wait out the rest of `1000 / SEND_FPS` ms.
   - On 200, read `{ cameraCode }`, count frames sent in the last second, and clear any retry message.
   - On 429, wait one interval and continue silently.
   - On 401/403/413, stop and show `describeFrameStatus`; 401 adds a link to `/login?next=/cam`.
   - On other statuses, show `describeFrameStatus` and retry after 2 s.
   - On a network error, show `MESSAGES.offline` and retry after 2 s.
6. **While sending:** the form is replaced by the live preview (16:9 box, `object-contain`), a status line ("Live · linked to B1" when `cameraCode` is set, otherwise "Live · not linked yet"), a frames-per-second readout (`5 fps sent`), the hint "Keep this page open with the screen on and the phone charging.", and a **Stop** button.
7. **Stop** (and unmount) bumps the run counter, stops every track, releases the wake lock and returns to the form. A `visibilitychange` to visible while sending re-requests the wake lock.

Run: the three test files → PASS. `npx vitest run && npx tsc --noEmit` → PASS.
Manual: in `npm run dev`, open `http://localhost:3000/cam` signed out; it redirects to `/login?next=/cam`, and after sign-in it returns to `/cam`. Desktop Chrome on `localhost` counts as a secure context: press Start, allow the camera, and the status line shows "Live · not linked yet" with about 5 fps sent.

- [ ] **Step 5: Commit**

```bash
git add dashboard/web/src/app/cam/page.tsx dashboard/web/src/features/phones/CamSender.tsx dashboard/web/src/features/phones/camMessages.ts dashboard/web/src/lib/auth/safeNext.ts "dashboard/web/src/app/(auth)/login/page.tsx" "dashboard/web/src/app/(auth)/login/LoginForm.tsx" "dashboard/web/src/app/(auth)/login/actions.ts" dashboard/web/tests/unit/camMessages.test.ts dashboard/web/tests/unit/safeNext.test.ts dashboard/web/tests/unit/camSender.test.tsx
git commit -m "feat(dashboard): /cam page that sends a phone camera as JPEG frames" -m "Ports the phone sender from elpaelpa's live-phone-cameras work (commits 3981767 and 4b313f1), signed in with a normal account instead of a shared key. Sign-in now returns to /cam."
```

---

### Task 6: `/live` tiles, motion view, top-bar item, Connect phone QR, Recordings list

**Files:**
- Create: `dashboard/web/src/features/phones/{framePoller,useLiveFrame,useLiveDevices,motion}.ts`, `dashboard/web/src/features/phones/{LiveScreen,ConnectPhone,RecordingsPanel,MotionScreen}.tsx`, `dashboard/web/src/lib/phones/connect.ts`, `dashboard/web/src/app/(app)/live/page.tsx`, `dashboard/web/src/app/(app)/live/motion/page.tsx`
- Modify: `dashboard/web/src/features/shell/TopBar.tsx`, `dashboard/web/package.json`, `dashboard/web/package-lock.json`, `dashboard/web/tests/unit/analyticsScreen.test.tsx` (TopBar describe)
- Test: `dashboard/web/tests/unit/framePoller.test.ts`, `dashboard/web/tests/unit/motion.test.ts`, `dashboard/web/tests/unit/connect.test.ts`, `dashboard/web/tests/unit/liveScreen.test.tsx`

**Interfaces:**
- Consumes: `GET /api/live/devices` → `{ devices: LiveDeviceView[] }`; `GET /api/live/frame/<id>` (200/304/401/404); `GET /api/live/recordings` → `{ enabled, convertsToMp4, recordings: RecordingView[] }`; recording files at `/api/live/recordings/<path>`; `getMapSnapshot()` and the TopBar props pattern from `src/app/(app)/setup/page.tsx`.
- Produces:
  ```ts
  // framePoller.ts
  export type LiveFrameState = 'loading' | 'live' | 'offline' | 'signed-out';
  export interface PollerDeps { fetch: typeof fetch; createObjectURL(blob: Blob): string; revokeObjectURL(url: string): void }
  export class FramePoller { constructor(deviceId: string, deps: PollerDeps); url: string | null; state: LiveFrameState; poll(): Promise<boolean>; stop(): void }
  // useLiveFrame.ts
  export function useLiveFrame(deviceId: string | null, fps?: number): { url: string | null; state: LiveFrameState | 'idle' };
  // useLiveDevices.ts
  export function useLiveDevices(intervalMs?: number): { devices: LiveDeviceView[]; error: string | null; refresh(): void };
  // motion.ts
  export type MotionMode = 'background' | 'previous';
  export const BACKGROUND_RATE = 0.1; export const DEFAULT_THRESHOLD = 20; export const ANALYSIS_WIDTH = 320;
  export function toBlurredGray(rgba: Uint8ClampedArray, width: number, height: number): Float32Array;
  export function isSameFrame(a: Float32Array | null, b: Float32Array): boolean;
  export function updateBackground(background: Float32Array, frame: Float32Array, rate?: number): void;
  export function paintDifference(frame: Float32Array, reference: Float32Array, output: Uint8ClampedArray, threshold: number): number;
  // connect.ts
  export function connectUrl(lanHost: string | undefined): string | null;
  // TopBar.tsx
  export type Page = 'map' | 'analytics' | 'live' | 'setup' | 'users';
  // LiveScreen.tsx
  export function LiveScreen(props: { user: SessionUser; bar: TopBarCounts; connect: { url: string | null; qrSvg: string | null } | null }): JSX.Element;
  ```
  `TopBarCounts` = `{ camerasOnline: number; camerasTotal: number; activeSites: number; dangerCount?: number; firstDangerId?: string | null }`, the same shape `CamerasScreen` takes as `bar`.

- [ ] **Step 1: Dependency**

`cd dashboard/web && npm install --save-exact qrcode@1.5.4 && npm install --save-dev --save-exact @types/qrcode@1.5.6`. Expected: `package.json` gains `"qrcode": "1.5.4"` and `"@types/qrcode": "1.5.6"`; the lockfile updates.

- [ ] **Step 2: Failing pure tests**

`tests/unit/framePoller.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { FramePoller } from '@/features/phones/framePoller';

function harness(responses: Response[])
{
    const created: string[] = [];
    const revoked: string[] = [];
    const fetchMock = vi.fn(async () => responses.shift()!);
    const poller = new FramePoller('ck1', {
        fetch: fetchMock as unknown as typeof fetch,
        createObjectURL: () => { const url = `blob:${created.length + 1}`; created.push(url); return url; },
        revokeObjectURL: url => revoked.push(url),
    });
    return { poller, fetchMock, revoked };
}
const frame = (at: number) => new Response(new Blob([new Uint8Array([0xff, 0xd8, at])]), { status: 200, headers: { ETag: `"${at}"` } });

describe('FramePoller', () =>
{
    it('swaps object URLs, keeps one spare and revokes the rest', async () =>
    {
        const { poller, fetchMock, revoked } = harness([frame(1), new Response(null, { status: 304 }), frame(2), frame(3)]);
        expect(await poller.poll()).toBe(true);
        expect(poller).toMatchObject({ url: 'blob:1', state: 'live' });
        expect(await poller.poll()).toBe(false);
        expect((fetchMock.mock.calls[1] as unknown[])[1]).toMatchObject({ headers: { 'If-None-Match': '"1"' } });
        await poller.poll();
        await poller.poll();
        expect(poller.url).toBe('blob:3');
        expect(revoked).toEqual(['blob:1']);
        poller.stop();
        expect(revoked).toEqual(['blob:1', 'blob:2', 'blob:3']);
        expect(poller.url).toBeNull();
    });

    it('reports offline on 404 and signed-out on 401', async () =>
    {
        const { poller } = harness([frame(1), new Response(null, { status: 404 }), new Response(null, { status: 401 })]);
        await poller.poll();
        expect(await poller.poll()).toBe(true);
        expect(poller.state).toBe('offline');
        await poller.poll();
        expect(poller.state).toBe('signed-out');
    });

    it('asks for the frame of its own device without caching', async () =>
    {
        const { poller, fetchMock } = harness([frame(1)]);
        await poller.poll();
        expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe('/api/live/frame/ck1');
        expect((fetchMock.mock.calls[0] as unknown[])[1]).toMatchObject({ cache: 'no-store' });
    });
});
```
`tests/unit/motion.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { BACKGROUND_RATE, DEFAULT_THRESHOLD, isSameFrame, paintDifference, toBlurredGray, updateBackground } from '@/features/phones/motion';

const rgba = (values: number[]) => new Uint8ClampedArray(values.flatMap(v => [v, v, v, 255]));
const flat = (value: number, n = 9) => new Float32Array(n).fill(value);

describe('motion maths', () =>
{
    it('converts to grey and softens with a 3×3 box blur', () =>
    {
        expect([...toBlurredGray(rgba(Array(9).fill(100)), 3, 3)]).toEqual(Array(9).fill(100));
        const spot = toBlurredGray(rgba([0, 0, 0, 0, 255, 0, 0, 0, 0]), 3, 3);
        expect(spot[4]).toBeCloseTo(255 / 9, 3);
        expect(spot[0]).toBeCloseTo(255 / 4, 3);
    });

    it('paints black below the threshold, amber at it and white at four times it', () =>
    {
        const out = new Uint8ClampedArray(3 * 4);
        const share = paintDifference(new Float32Array([19, 20, 80]), new Float32Array(3), out, 20);
        expect(share).toBeCloseTo(2 / 3, 5);
        expect([...out.slice(0, 4)]).toEqual([0, 0, 0, 255]);
        expect([...out.slice(4, 8)]).toEqual([255, 120, 0, 255]);
        expect([...out.slice(8, 12)]).toEqual([255, 255, 255, 255]);
    });

    it('against background: a still object fades below the threshold within 3 s at 5 fps', () =>
    {
        expect(BACKGROUND_RATE).toBe(0.1);
        const background = flat(0);
        const object = flat(100);
        const out = new Uint8ClampedArray(9 * 4);
        updateBackground(background, object);
        expect(paintDifference(object, background, out, 25)).toBe(1);
        for (let i = 1; i < 15; i++)
        {
            updateBackground(background, object);
        }
        expect(paintDifference(object, background, out, 25)).toBe(0);
    });

    it('since last frame: an unchanged picture shows no motion, and repeated frames are detected', () =>
    {
        const out = new Uint8ClampedArray(9 * 4);
        expect(paintDifference(flat(50), flat(50), out, DEFAULT_THRESHOLD)).toBe(0);
        expect(isSameFrame(null, flat(1))).toBe(false);
        expect(isSameFrame(flat(1), flat(1))).toBe(true);
        expect(isSameFrame(flat(1), flat(2))).toBe(false);
    });
});
```
`tests/unit/connect.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { connectUrl } from '@/lib/phones/connect';

describe('connectUrl', () =>
{
    it('builds the phone address from LAN_HOST', () =>
    {
        expect(connectUrl('192.168.1.20')).toBe('https://192.168.1.20:3443/cam');
        expect(connectUrl(' laptop.local ')).toBe('https://laptop.local:3443/cam');
        for (const bad of [undefined, '', 'evil.example/x', 'a b', 'host:99', 'javascript:alert(1)'])
        {
            expect(connectUrl(bad)).toBeNull();
        }
    });
});
```
Run → FAIL (modules missing).

- [ ] **Step 3: Implement pure modules**

`src/features/phones/framePoller.ts`:
```ts
export type LiveFrameState = 'loading' | 'live' | 'offline' | 'signed-out';

export interface PollerDeps
{
    fetch: typeof fetch;
    createObjectURL(blob: Blob): string;
    revokeObjectURL(url: string): void;
}

// One device's newest frame as an object URL. Short polls instead of a held stream: browsers allow
// only six HTTP/1.1 connections per site, and a grid of open streams would stall new pages.
export class FramePoller
{
    url: string | null = null;
    state: LiveFrameState = 'loading';
    private spare: string | null = null;
    private etag: string | null = null;

    constructor(private deviceId: string, private deps: PollerDeps) {}

    // One request; true when the picture or the state changed.
    async poll(): Promise<boolean>
    {
        const response = await this.deps.fetch(`/api/live/frame/${encodeURIComponent(this.deviceId)}`, { cache: 'no-store', headers: this.etag ? { 'If-None-Match': this.etag } : {} });
        if (response.status === 304)
        {
            return this.setState('live');
        }
        if (response.status === 401)
        {
            return this.setState('signed-out');
        }
        if (!response.ok)
        {
            this.etag = null;
            return this.setState('offline');
        }
        const next = this.deps.createObjectURL(await response.blob());
        // Keep one spare: an <img> still decoding the previous frame must not lose it.
        if (this.spare)
        {
            this.deps.revokeObjectURL(this.spare);
        }
        this.spare = this.url;
        this.url = next;
        this.etag = response.headers.get('ETag');
        this.state = 'live';
        return true;
    }

    stop(): void
    {
        for (const url of [this.spare, this.url])
        {
            if (url)
            {
                this.deps.revokeObjectURL(url);
            }
        }
        this.spare = null;
        this.url = null;
    }

    private setState(state: LiveFrameState): boolean
    {
        const changed = state !== this.state;
        this.state = state;
        return changed;
    }
}
```
`src/features/phones/motion.ts`: port `toBlurredGray`, `isSameFrame`, `updateBackground` and `paintDifference` from the teammate's `motionDifference.js` into TypeScript, keeping the same arithmetic (typed `Float32Array`/`Uint8ClampedArray` parameters as in the interface), with these changes:
- `export const BACKGROUND_RATE = 0.1;` is the default `rate` of `updateBackground`. The teammate's 0.03 needs about 10 s at 5 fps; the spec wants still objects gone "within a few seconds".
- `export const DEFAULT_THRESHOLD = 20; export const ANALYSIS_WIDTH = 320; export type MotionMode = 'background' | 'previous';`.
- The header comment states it is a viewing aid, not the detector.

`src/lib/phones/connect.ts`:
```ts
const HOST = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)$/i;

// The address phones open, from LAN_HOST (the laptop's Wi-Fi IP). Null when unset or malformed.
export function connectUrl(lanHost: string | undefined): string | null
{
    const host = lanHost?.trim();
    return host && HOST.test(host) ? `https://${host}:3443/cam` : null;
}
```
Run the three pure tests → PASS.

- [ ] **Step 4: Hooks**

- `useLiveFrame(deviceId, fps = 5)`: returns `{ url: null, state: 'idle' }` when `deviceId` is null. Otherwise it creates a `FramePoller` with `{ fetch, createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL }` and loops while mounted:
  - It skips the request while `document.visibilityState !== 'visible'`.
  - It calls `poll()` and sets state only when it returns true. A thrown network error counts as `'offline'`.
  - Between polls it waits `max(0, 1000/fps − elapsed)`, or 1000 ms while offline or signed out.
  - Unmount or a `deviceId` change stops the loop and calls `poller.stop()`.
- `useLiveDevices(intervalMs = 3000)`: fetches `/api/live/devices` on mount and every `intervalMs` while the tab is visible. A non-OK response sets `error` ("Could not load phones.") and keeps the last list. `refresh()` fetches now.

- [ ] **Step 5: Top bar**

`TopBar.tsx`: `export type Page = 'map' | 'analytics' | 'live' | 'setup' | 'users';` and insert `{ page: 'live', href: '/live', label: 'Live cameras' }` after Analytics in `NAV`. Inside the link, render the label as `Live<span className="max-sm:hidden"> cameras</span>` for that item so the admin bar still fits a 360 px phone; the accessible name stays "Live cameras" via `aria-label`.
Add to the `TopBar` describe in `tests/unit/analyticsScreen.test.tsx`:
```tsx
    it('shows Live cameras to every role, between Analytics and Setup', () =>
    {
        const { rerender } = render(<TopBar user={viewer} current="live" camerasOnline={1} camerasTotal={2} activeSites={0} />);
        const nav = screen.getByRole('navigation', { name: 'Main' });
        expect(within(nav).getAllByRole('link').map(link => link.getAttribute('aria-label') ?? link.textContent)).toEqual(['Map', 'Analytics', 'Live cameras']);
        expect(within(nav).getByRole('link', { name: 'Live cameras' }).getAttribute('href')).toBe('/live');
        expect(within(nav).getByRole('link', { name: 'Live cameras' }).getAttribute('aria-current')).toBe('page');
        rerender(<TopBar user={{ ...viewer, role: 'ADMIN' }} current="map" camerasOnline={1} camerasTotal={2} activeSites={0} />);
        expect(within(nav).getAllByRole('link').map(link => link.getAttribute('aria-label') ?? link.textContent)).toEqual(['Map', 'Analytics', 'Live cameras', 'Setup', 'Users']);
    });
```
(import `within` from `@testing-library/react` alongside the existing imports; `viewer` is the fixture already used in that describe). `textContent` of the other links equals their label, so give only the Live link an `aria-label`.

- [ ] **Step 6: Pages and screens**

`src/app/(app)/live/page.tsx` (server, `dynamic = 'force-dynamic'`) has the same shape as `setup/page.tsx`. It calls `requireCurrentUser()` and `getMapSnapshot()` for the bar counts (`activeSites`, `dangerCount`, `firstDangerId` computed exactly as on the Setup page). Admins get `url = connectUrl(process.env.LAN_HOST)` and `qrSvg = url ? await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) : null` (`import QRCode from 'qrcode'`). It renders `<LiveScreen user bar connect={user.role === 'ADMIN' ? { url, qrSvg } : null} />`.

`src/app/(app)/live/motion/page.tsx` (server): calls `requireCurrentUser()`, reads `searchParams.device` (string or null), and renders `<MotionScreen user bar deviceId={…} />` with the same bar counts.

`LiveScreen` (client) behaviour list:
1. `TopBar current="live"` in a sticky header, as on Setup. Page title "Live cameras" with the subtitle "Phones sending over the local Wi-Fi. Pictures refresh about five times a second."
2. Online phones come from `useLiveDevices(3000)`: everyone sees `online` devices; admins receive all devices but the grid shows only online ones. The grid has 1 column on phones, 2 from `md`, 3 from `xl`.
3. **Tile:** a 16:9 picture (`<img alt="Live picture from <name>">` with `useLiveFrame(id)` URL and `object-contain`; a spinner while loading; "Phone offline" when the poll reports offline before the next device poll drops the tile). Then the device name (bold), "by <ownerName>", the linked camera ("Camera B1" or "Not linked to a map camera"), and a red **REC** badge (`bg-alarm`, dot + text) when `recording`. Buttons: **Motion view** (link to `/live/motion?device=<id>`) and **Expand**.
4. **Expand** opens a full-viewport overlay (`role="dialog"`, `aria-modal`, labelled by the device name) with the same live picture as large as fits and a Close button. **Escape** closes it, and focus returns to the Expand button.
5. **Empty state** (no online phones) shows "No phones are sending right now." Admins also see "Open **Connect phone**, scan the QR code with a phone on the same Wi-Fi, sign in as a volunteer or admin, and press Start." Other roles see "Ask an admin for the Connect phone QR code, or open https://<this host>:3443/cam on a phone on the same Wi-Fi."
6. **Admin only:** a **Connect phone** button in the page header opens `ConnectPhone`, a dialog that closes on Escape. It shows the QR (`dangerouslySetInnerHTML={{ __html: qrSvg }}`; the SVG comes from the qrcode library on the server, not from user input), the URL as copyable monospace text with a **Copy** button, and the steps: "1. Join the laptop's Wi-Fi. 2. Scan this code. 3. Accept the one-time certificate warning. 4. Sign in. 5. Press Start." When `url` is null it shows "Set LAN_HOST in dashboard/.env to this laptop's Wi-Fi address (macOS: ipconfig getifaddr en0) and restart the dashboard."
7. **Admin only:** the `RecordingsPanel` sits below the grid. It fetches `/api/live/recordings` on mount and every 30 s.
   - When `enabled` is false: "Recording is off (RECORDING=off)."
   - Otherwise it shows a table (stacked cards below `md`) with Device, Camera (or "—"), Start (local date and time), Length ("4 min 12 s"/"38 s"), Size ("12.4 MB"/"830 KB"), **Play**, **Download**.
   - **Play** (mp4 only) opens an inline `<video controls autoPlay src="/api/live/recordings/<path>">` under the row. AVI rows show "AVI · download only" in its place, with "(install ffmpeg to convert)" when `convertsToMp4` is false.
   - **Download** is `<a href="/api/live/recordings/<path>?download=1">`. An empty list shows "No recordings yet. Phones are recorded while they send."

`MotionScreen` (client) behaviour list (port of the teammate's `MotionView.jsx`):
1. Title "Motion view · <device name>" (name from `useLiveDevices`; "Unknown phone" if absent). A back link to `/live`. With no `device` param it shows "Choose a phone on Live cameras." and a link.
2. The banner "Viewing aid only. This is not the digging detector and raises no alerts." is always visible.
3. Two panes (stacked on phones, side by side from `md`): **Live** (`<img>` from `useLiveFrame(device, 5)`) and **Motion** (`<canvas>` `ANALYSIS_WIDTH` wide, height following the picture's aspect ratio).
4. Every 200 ms while live:
   - Draw the image into an offscreen canvas (`willReadFrequently`), then `toBlurredGray`.
   - Skip when `isSameFrame`. The first frame seeds both `previous` and `background`.
   - Otherwise `paintDifference` against `previous` (mode **Since last frame**) or `background` (mode **Against background**, the default) and `putImageData`.
   - Then `updateBackground` (both modes, so switching is instant), set `previous`, and show "N % of the picture moving".
   - History resets when the device or the picture size changes.
5. Controls: a segmented toggle for the two modes (`aria-pressed`), and a threshold slider (`input type="range"`, 5–80, default `DEFAULT_THRESHOLD`) labelled "Threshold: brightness change that counts as motion" with its value shown. **Reset background** copies the current frame into `background`.
6. Offline (frame 404) shows "Phone offline. The motion view resumes when it sends again." and stops analysis.

`tests/unit/liveScreen.test.tsx` (dom): mock `@/features/phones/useLiveFrame` to return `{ url: null, state: 'loading' }` and `@/app/(app)/actions` (`logoutAction: vi.fn()`), and stub `fetch` by URL:
```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/features/phones/useLiveFrame', () => ({ useLiveFrame: () => ({ url: null, state: 'loading' }) }));
vi.mock('@/app/(app)/actions', () => ({ logoutAction: vi.fn() }));
const { LiveScreen } = await import('@/features/phones/LiveScreen');

const bar = { camerasOnline: 1, camerasTotal: 2, activeSites: 0 };
const admin = { id: 'a', email: 'a@x.y', name: 'Ad', role: 'ADMIN' as const };
const viewer = { ...admin, id: 'v', role: 'VIEWER' as const };
const phone = { id: 'ck1', name: 'Dune phone', ownerName: 'Vo', cameraCode: 'B1', online: true, recording: true, lastSeenAt: '2026-10-10T20:00:00.000Z' };

function stubFetch(devices: unknown[])
{
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.startsWith('/api/live/devices')
        ? Response.json({ devices })
        : Response.json({ enabled: true, convertsToMp4: true, recordings: [] })));
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('LiveScreen', () =>
{
    it('explains how to connect a phone when none is sending', async () =>
    {
        stubFetch([]);
        render(<LiveScreen user={viewer} bar={bar} connect={null} />);
        expect(await screen.findByText('No phones are sending right now.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Connect phone' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Recordings' })).toBeNull();
    });

    it('shows a tile per online phone with owner, camera, REC and actions', async () =>
    {
        stubFetch([phone, { ...phone, id: 'ck2', name: 'Silent', online: false, recording: false }]);
        render(<LiveScreen user={viewer} bar={bar} connect={null} />);
        expect(await screen.findByText('Dune phone')).toBeTruthy();
        expect(screen.queryByText('Silent')).toBeNull();
        expect(screen.getByText('by Vo')).toBeTruthy();
        expect(screen.getByText('Camera B1')).toBeTruthy();
        expect(screen.getByText('REC')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Motion view' }).getAttribute('href')).toBe('/live/motion?device=ck1');
        fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
        expect(screen.getByRole('dialog', { name: 'Dune phone' })).toBeTruthy();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('gives admins Connect phone with the QR and the Recordings list', async () =>
    {
        stubFetch([]);
        render(<LiveScreen user={admin} bar={bar} connect={{ url: 'https://192.168.1.20:3443/cam', qrSvg: '<svg data-testid="qr"></svg>' }} />);
        fireEvent.click(screen.getByRole('button', { name: 'Connect phone' }));
        expect(screen.getByText('https://192.168.1.20:3443/cam')).toBeTruthy();
        expect(screen.getByTestId('qr')).toBeTruthy();
        expect(await screen.findByRole('heading', { name: 'Recordings' })).toBeTruthy();
        expect(await screen.findByText('No recordings yet. Phones are recorded while they send.')).toBeTruthy();
    });
});
```
Run: `npx vitest run tests/unit/framePoller.test.ts tests/unit/motion.test.ts tests/unit/connect.test.ts tests/unit/liveScreen.test.tsx tests/unit/analyticsScreen.test.tsx` → PASS. Then `npx vitest run && npx tsc --noEmit && npx next build` → PASS.
Manual (host `npm run dev`, one desktop tab on `/cam` sending):
- `/live` shows the tile, and REC appears within 1 s.
- Expand opens and Escape closes the overlay.
- Motion view shows heat where you wave a hand; in Against background mode, a still hand fades within about 3 s.
- Recordings lists a segment about 15 s after Stop (10 s gap + 5 s idle tick).

- [ ] **Step 7: Commit**

```bash
git add dashboard/web/package.json dashboard/web/package-lock.json dashboard/web/src/features/phones/framePoller.ts dashboard/web/src/features/phones/useLiveFrame.ts dashboard/web/src/features/phones/useLiveDevices.ts dashboard/web/src/features/phones/motion.ts dashboard/web/src/features/phones/LiveScreen.tsx dashboard/web/src/features/phones/ConnectPhone.tsx dashboard/web/src/features/phones/RecordingsPanel.tsx dashboard/web/src/features/phones/MotionScreen.tsx dashboard/web/src/lib/phones/connect.ts "dashboard/web/src/app/(app)/live" dashboard/web/src/features/shell/TopBar.tsx dashboard/web/tests/unit/framePoller.test.ts dashboard/web/tests/unit/motion.test.ts dashboard/web/tests/unit/connect.test.ts dashboard/web/tests/unit/liveScreen.test.tsx dashboard/web/tests/unit/analyticsScreen.test.tsx
git commit -m "feat(dashboard): Live cameras page with tiles, motion view, connect QR and recordings" -m "Ports the live tiles, frame polling hook, motion difference and recordings panel from elpaelpa's live-phone-cameras work (commits 3981767 and 4b313f1)."
```

---

### Task 7: Link phones to map cameras (admin), map panel LIVE/offline, unlink on disable/remove

**Files:**
- Modify: `dashboard/web/src/lib/cameras/manage.ts`, `dashboard/web/src/app/(app)/camera-actions.ts`, `dashboard/web/src/lib/users/manage.ts`, `dashboard/web/src/lib/phones/devices.ts`, `dashboard/web/src/lib/types.ts`, `dashboard/web/src/server/snapshot.ts`, `dashboard/web/src/features/cameras/CameraPanel.tsx`, `dashboard/web/src/features/cameras/CamerasScreen.tsx`, `dashboard/web/src/app/(app)/setup/cameras/page.tsx`, `dashboard/web/src/features/map/MapScreen.tsx`, `dashboard/web/src/features/phones/LiveScreen.tsx`, plus snapshot test fixtures that build camera rows (`tests/unit/snapshot.test.ts`, and `bounds`/`mapScreen` fixtures only if `tsc` flags them)
- Create: `dashboard/web/src/app/(app)/live/actions.ts`, `dashboard/web/src/features/phones/SourceSelect.tsx`
- Test: `dashboard/web/tests/integration/camera-source.test.ts`, extend `dashboard/web/tests/unit/camera-actions-guard.test.ts`, create `dashboard/web/tests/unit/cameraPanelLive.test.tsx`. Update the mocks that now reach `setCameraSource`/`removePhone` through new imports:
  - `tests/unit/mapScreen.test.tsx` and `tests/unit/camerasScreen.test.tsx`: add `setCameraSource: vi.fn()` to their `@/app/(app)/camera-actions` mock factories.
  - `tests/unit/expandedFeed.test.tsx`: add `vi.mock('@/app/(app)/camera-actions', () => ({ setCameraSource: vi.fn() }))`.
  - `tests/unit/liveScreen.test.tsx`: add `vi.mock('@/app/(app)/live/actions', () => ({ removePhone: vi.fn() }))`.

**Interfaces:**
- Consumes: `CameraEditError`, `run()` and the action pattern in `camera-actions.ts`; `setDisabled(prisma, actorId, userId, disabled)`; `listDevices` and `frameStore` (Task 2); `useLiveFrame` (Task 6); `LiveDeviceView`.
- Produces:
  ```ts
  // cameras/manage.ts
  export function setCameraSource(prisma: PrismaClient, actorId: string, code: string, deviceId: string | null): Promise<{ code: string }>;   // AuditLog 'camera.source', publishChange('cameras')
  // CameraRow += liveDeviceId: string | null; liveDeviceName: string | null
  // camera-actions.ts
  export async function setCameraSource(code: string, deviceId: string | null): Promise<CameraActionResult>;
  // phones/devices.ts
  export function removeDevice(prisma: PrismaClient, actorId: string, deviceId: string): Promise<{ unlinked: string | null }>;   // disabledAt, unlink, AuditLog 'device.remove'
  // live/actions.ts
  export async function removePhone(deviceId: string): Promise<{ ok: true } | { ok: false; error: string }>;
  // types.ts: CameraView += liveDevice: { id: string; name: string } | null
  // CameraPanel props += canEditSource?: boolean
  // SourceSelect
  export function SourceSelect(props: { cameraCode: string; value: string | null; devices?: LiveDeviceView[] }): JSX.Element;
  ```

- [ ] **Step 1: Failing integration tests**

`tests/integration/camera-source.test.ts` (boilerplate as in `camera-actions.test.ts`; TRUNCATE adds `"LiveDevice"`):
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@/lib/db';
import { onChange } from '@/lib/changes';
import { CameraEditError, listCameras, setCameraSource } from '@/lib/cameras/manage';
import { registerDevice, removeDevice } from '@/lib/phones/devices';
import { setDisabled } from '@/lib/users/manage';
import { seedDatabase } from '../../prisma/seed';

const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
let adminId: string;
let volunteerId: string;

beforeAll(async () =>
{
    const [{ current_database: name }] = await prisma.$queryRawUnsafe<{ current_database: string }[]>('SELECT current_database()');
    if (!name.endsWith('_test'))
    {
        throw new Error(`Refusing to run against ${name}`);
    }
});
beforeEach(async () =>
{
    await prisma.$executeRawUnsafe('TRUNCATE "LiveDevice","SiteEvent","LiveChunk","AuditLog","AlertStatusChange","AlertNote","Alert","Track","Job","Video","Camera","Zone","User" CASCADE');
    await seedDatabase(prisma, { adminEmail: 'admin@test.local', adminPassword: 'pw-for-tests' });
    adminId = (await prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.local' } })).id;
    volunteerId = (await prisma.user.create({ data: { email: 'vol@test.local', name: 'Vol', role: 'VOLUNTEER', passwordHash: 'unused' } })).id;
});
afterAll(async () => { await prisma.$disconnect(); });

const linked = async (code: string) => (await prisma.camera.findUniqueOrThrow({ where: { code } })).liveDeviceId;
const refusal = async (promise: Promise<unknown>) =>
{
    const error = await promise.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(CameraEditError);
    return (error as Error).message;
};

describe('camera source', () =>
{
    it('links a phone to a camera and back to the simulation loop, audited and published', async () =>
    {
        const { id } = await registerDevice(prisma, volunteerId, 'Dune phone');
        const reasons: string[] = [];
        const off = onChange(reason => reasons.push(reason));
        await setCameraSource(prisma, adminId, 'B1', id);
        expect(await linked('B1')).toBe(id);
        expect((await listCameras(prisma)).cameras.find(c => c.code === 'B1')).toMatchObject({ liveDeviceId: id, liveDeviceName: 'Dune phone' });
        await setCameraSource(prisma, adminId, 'B1', null);
        off();
        expect(await linked('B1')).toBeNull();
        const audits = await prisma.auditLog.findMany({ where: { action: 'camera.source' }, orderBy: { createdAt: 'asc' } });
        expect(audits.map(a => a.details)).toEqual([
            { code: 'B1', from: null, to: id, deviceName: 'Dune phone' },
            { code: 'B1', from: id, to: null, deviceName: null },
        ]);
        expect(reasons).toEqual(['cameras', 'cameras']);
    });

    it('refuses a phone that already feeds another camera, a removed phone and an unknown camera', async () =>
    {
        const { id } = await registerDevice(prisma, volunteerId, 'Dune phone');
        await setCameraSource(prisma, adminId, 'B1', id);
        expect(await refusal(setCameraSource(prisma, adminId, 'C1', id))).toBe('Dune phone already feeds camera B1; set B1 back to Simulation loop first.');
        expect(await refusal(setCameraSource(prisma, adminId, 'Z9', null))).toBe('Camera Z9 no longer exists.');
        const { id: gone } = await registerDevice(prisma, volunteerId, 'Old phone');
        await removeDevice(prisma, adminId, gone);
        expect(await refusal(setCameraSource(prisma, adminId, 'C1', gone))).toBe('That phone was removed.');
        await expect(prisma.camera.update({ where: { code: 'C1' }, data: { liveDeviceId: id } })).rejects.toThrow();
    });

    it('unlinks every phone of a user who is disabled', async () =>
    {
        const { id } = await registerDevice(prisma, volunteerId, 'Dune phone');
        await setCameraSource(prisma, adminId, 'B1', id);
        await setDisabled(prisma, adminId, volunteerId, true);
        expect(await linked('B1')).toBeNull();
        expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.disable' } })).details).toEqual({ unlinkedCameras: ['B1'] });
    });

    it('removing a phone unlinks it and frees its name', async () =>
    {
        const { id } = await registerDevice(prisma, volunteerId, 'Dune phone');
        await setCameraSource(prisma, adminId, 'B1', id);
        expect(await removeDevice(prisma, adminId, id)).toEqual({ unlinked: 'B1' });
        expect(await linked('B1')).toBeNull();
        expect((await prisma.liveDevice.findUniqueOrThrow({ where: { id } })).disabledAt).not.toBeNull();
        expect(await prisma.auditLog.count({ where: { action: 'device.remove', targetId: id } })).toBe(1);
        expect((await registerDevice(prisma, volunteerId, 'Dune phone')).id).not.toBe(id);
    });
});
```
In `tests/unit/camera-actions-guard.test.ts`, add `setCameraSource: vi.fn()` to `manage` and `['camera source', () => actions.setCameraSource('B1', 'ck1')]` to `calls`.
Run: `npx vitest run tests/integration/camera-source.test.ts tests/unit/camera-actions-guard.test.ts`. Expected: FAIL (missing exports).

- [ ] **Step 2: Implement the data side**

`src/lib/cameras/manage.ts`:
```ts
// Shows a phone's live picture on a camera (deviceId) or returns it to the simulation loop (null).
export async function setCameraSource(prisma: PrismaClient, actorId: string, code: string, deviceId: string | null): Promise<{ code: string }>
{
    try
    {
        await prisma.$transaction(async tx =>
        {
            const camera = await tx.camera.findUnique({ where: { code }, include: { liveDevice: { select: { id: true } } } });
            if (!camera)
            {
                throw new CameraEditError(`Camera ${code} no longer exists.`);
            }
            let deviceName: string | null = null;
            if (deviceId)
            {
                const device = await tx.liveDevice.findUnique({ where: { id: deviceId }, include: { camera: { select: { code: true } } } });
                if (!device || device.disabledAt)
                {
                    throw new CameraEditError('That phone was removed.');
                }
                if (device.camera && device.camera.code !== code)
                {
                    throw new CameraEditError(`${device.name} already feeds camera ${device.camera.code}; set ${device.camera.code} back to Simulation loop first.`);
                }
                deviceName = device.name;
            }
            await tx.camera.update({ where: { id: camera.id }, data: { liveDeviceId: deviceId } });
            await tx.auditLog.create({ data: { userId: actorId, action: 'camera.source', targetType: 'Camera', targetId: camera.id, details: { code, from: camera.liveDevice?.id ?? null, to: deviceId, deviceName } } });
        });
    }
    catch (error)
    {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        {
            throw new CameraEditError('That phone was just linked to another camera; try again.');
        }
        throw error;
    }
    publishChange('cameras');
    return { code };
}
```
Extend `CameraRow` with `liveDeviceId: string | null; liveDeviceName: string | null` and `listCameras` with `include: { …, liveDevice: { select: { id: true, name: true } } }` mapping to those fields.

`src/app/(app)/camera-actions.ts`:
```ts
export async function setCameraSource(code: string, deviceId: string | null): Promise<CameraActionResult>
{
    await requireCurrentUser('ADMIN');
    const parsed = z.object({ code: cameraCodeSchema, deviceId: z.string().min(1).max(40).nullable() }).safeParse({ code, deviceId });
    if (!parsed.success)
    {
        return { ok: false, error: 'That source could not be read.' };
    }
    return run(actorId => saveSource(prisma, actorId, parsed.data.code, parsed.data.deviceId));
}
```
(import `setCameraSource as saveSource` from `@/lib/cameras/manage`; `run` already revalidates `/setup/cameras`).

`src/lib/users/manage.ts` `setDisabled`: inside the transaction, when `disabled`:
```ts
const cameras = await tx.camera.findMany({ where: { liveDevice: { ownerId: userId } }, select: { code: true } });
await tx.camera.updateMany({ where: { liveDevice: { ownerId: userId } }, data: { liveDeviceId: null } });
```
and write the audit row with `details: disabled ? { unlinkedCameras: cameras.map(c => c.code) } : undefined`. After the transaction it publishes `'users'` (existing) and, when any camera was unlinked, `'cameras'`.

`src/lib/phones/devices.ts`:
```ts
import { publishChange } from '@/lib/changes';
import { CameraEditError } from '@/lib/cameras/manage';

// Admin removal: the phone takes no more frames, leaves every list, and its camera returns to the simulation loop.
export async function removeDevice(prisma: PrismaClient, actorId: string, deviceId: string): Promise<{ unlinked: string | null }>
{
    const result = await prisma.$transaction(async tx =>
    {
        const device = await tx.liveDevice.findUnique({ where: { id: deviceId }, include: { camera: { select: { id: true, code: true } } } });
        if (!device || device.disabledAt)
        {
            throw new CameraEditError('That phone was already removed.');
        }
        if (device.camera)
        {
            await tx.camera.update({ where: { id: device.camera.id }, data: { liveDeviceId: null } });
        }
        await tx.liveDevice.update({ where: { id: deviceId }, data: { disabledAt: new Date() } });
        await tx.auditLog.create({ data: { userId: actorId, action: 'device.remove', targetType: 'LiveDevice', targetId: deviceId, details: { name: device.name, unlinked: device.camera?.code ?? null } } });
        return { unlinked: device.camera?.code ?? null };
    });
    publishChange('cameras');
    return result;
}
```
`src/app/(app)/live/actions.ts`:
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireCurrentUser } from '@/lib/auth/guard';
import { CameraEditError } from '@/lib/cameras/manage';
import { prisma } from '@/lib/db';
import { removeDevice } from '@/lib/phones/devices';
import { frameStore } from '@/lib/phones/frameStore';

export async function removePhone(deviceId: string): Promise<{ ok: true } | { ok: false; error: string }>
{
    const actor = await requireCurrentUser('ADMIN');
    const parsed = z.string().min(1).max(40).safeParse(deviceId);
    if (!parsed.success)
    {
        return { ok: false, error: 'That phone no longer exists.' };
    }
    try
    {
        await removeDevice(prisma, actor.id, parsed.data);
    }
    catch (error)
    {
        if (error instanceof CameraEditError)
        {
            return { ok: false, error: error.message };
        }
        throw error;
    }
    frameStore.forget(parsed.data);
    revalidatePath('/live');
    return { ok: true };
}
```
Snapshot: in `loadMapSnapshot` add `liveDevice: { select: { id: true, name: true } }` to the camera `include`. Add `liveDevice: { id: string; name: string } | null` to the snapshot's camera row type, map it to `liveDevice: camera.liveDevice ?? null` in `toMapSnapshot`, and add `liveDevice` to `CameraView`. Update unit fixtures that build camera rows (`tests/unit/snapshot.test.ts`) with `liveDevice: null`.
Run Step 1 tests → PASS. `npx vitest run && npx tsc --noEmit` → PASS (fix any other fixture `tsc` reports by adding `liveDevice: null`).

- [ ] **Step 3: Failing panel test**

`tests/unit/cameraPanelLive.test.tsx`:
```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { CameraView } from '@/lib/types';

let live: { url: string | null; state: string } = { url: null, state: 'idle' };
vi.mock('@/features/phones/useLiveFrame', () => ({ useLiveFrame: (id: string | null) => (id ? live : { url: null, state: 'idle' }) }));
vi.mock('@/app/(app)/camera-actions', () => ({ setCameraSource: vi.fn(async () => ({ ok: true, code: 'B1' })) }));
const { CameraPanel } = await import('@/features/cameras/CameraPanel');

const camera = {
    id: 'c1', code: 'B1', zoneCode: 'B', position: [-97.06, 27.81], headingDeg: 113, fovDeg: 44, rangeM: 350, status: 'ONLINE', calibrated: false,
    video: { id: 'v1', source: 'SIMULATION', durationS: 40, hasMotion: true, simRunId: 'A-demo-1' },
    liveDevice: { id: 'ck1', name: 'Dune phone' },
} as unknown as CameraView;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('CameraPanel with a linked phone', () =>
{
    it('shows the live picture with a LIVE badge and a motion-view link while the phone sends', () =>
    {
        live = { url: 'blob:1', state: 'live' };
        render(<CameraPanel camera={camera} onClose={() => undefined} />);
        expect(screen.getByRole('img', { name: 'Live picture from Dune phone' }).getAttribute('src')).toBe('blob:1');
        expect(screen.getByText('LIVE')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Motion view' }).getAttribute('href')).toBe('/live/motion?device=ck1');
        expect(document.querySelector('video')).toBeNull();
    });

    it('falls back to the simulation loop and says the phone is offline', () =>
    {
        live = { url: 'blob:1', state: 'offline' };
        render(<CameraPanel camera={camera} onClose={() => undefined} />);
        expect(screen.queryByText('LIVE')).toBeNull();
        expect(document.querySelector('video')).not.toBeNull();
        expect(screen.getByText('Phone offline · Dune phone')).toBeTruthy();
    });

    it('offers the Source picker to admins only', () =>
    {
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ devices: [] })));
        live = { url: null, state: 'loading' };
        const { rerender } = render(<CameraPanel camera={camera} onClose={() => undefined} />);
        expect(screen.queryByLabelText('Source')).toBeNull();
        rerender(<CameraPanel camera={camera} onClose={() => undefined} canEditSource />);
        expect(screen.getByLabelText('Source')).toBeTruthy();
    });
});
```
Run → FAIL.

- [ ] **Step 4: UI**

`SourceSelect` (client) behaviour list:
1. `<label>` "Source" with a `<select>`. The first option is "Simulation loop" (value `''`), then one option per device: `"<name> · <ownerName> · online|offline"`. A device whose `cameraCode` is set and differs from this camera is `disabled` and suffixed `" (feeds B1)"`. The current value is `value ?? ''`.
2. Devices come from the `devices` prop when given (Setup page). Otherwise the component fetches `/api/live/devices` on mount and on focus (admins receive every non-removed phone). A failed fetch is caught and shows "Could not load phones." under the select; the current link stays selectable.
3. On change it calls `setCameraSource(cameraCode, id || null)` inside `useTransition`. The select is disabled while pending, and `{ ok: false, error }` shows `error` under the select in the danger colour. Success needs no message: the SSE snapshot refresh updates the map and `revalidatePath` updates Setup.

`CameraPanel` behaviour list:
1. A new optional prop `canEditSource`. It calls `const live = useLiveFrame(camera.liveDevice?.id ?? null)` unconditionally (hook order stays stable).
2. **Live:** when `camera.liveDevice` is set and `live.state === 'live'`, the media box shows `<img alt="Live picture from <name>" src={live.url}>` (`object-contain`, same aspect box as `CameraVideo`). It has a red **LIVE** badge (top-left, `bg-alarm`, white text, dot) and the device name. There is no Raw/Motion variant toggle and no Expand button; a **Motion view** link goes to `/live/motion?device=<id>`.
3. **Otherwise:** today's behaviour is unchanged (simulation loop or status card). When `camera.liveDevice` is set and `live.state` is `'offline'` or `'signed-out'`, one line under the media reads "Phone offline · <name>" (muted, with a `VideoOff` icon). While `'loading'` the loop shows without the note.
4. With `canEditSource`, a `SourceSelect` row sits under the details grid (`value={camera.liveDevice?.id ?? null}`).

`MapScreen`: pass `canEditSource={isAdmin}` to `CameraPanel`.
`setup/cameras/page.tsx`: also load `listDevices(prisma, frameStore, { all: true })` and pass it as `devices` to `CamerasScreen`.
`CamerasScreen`: new prop `devices: LiveDeviceView[]`. Each camera row gains a **Source** cell with `<SourceSelect cameraCode={camera.code} value={camera.liveDeviceId} devices={devices} />` (stacked layout below `md` like the other cells), plus the existing header copy "Source: simulation loop or a linked phone".
`LiveScreen` (admin only): a **Phones** section above Recordings lists every device from `useLiveDevices` with name, owner, "online"/"last seen <relative time>", camera ("Camera B1" or "Not linked") and a **Remove** button. The button confirms inline ("Remove Dune phone? Its camera returns to the simulation loop." with Remove/Cancel), then calls `removePhone(id)`, shows any error inline, and on success calls `refresh()`.

Run: `npx vitest run tests/unit/cameraPanelLive.test.tsx tests/unit/expandedFeed.test.tsx tests/unit/camerasScreen.test.tsx tests/unit/mapScreen.test.tsx` → PASS (existing panel tests still pass: `liveDevice` absent means `useLiveFrame(null)`). Then `npx vitest run && npx tsc --noEmit && npx next build` → PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/web/src/lib/cameras/manage.ts "dashboard/web/src/app/(app)/camera-actions.ts" dashboard/web/src/lib/users/manage.ts dashboard/web/src/lib/phones/devices.ts dashboard/web/src/lib/types.ts dashboard/web/src/server/snapshot.ts dashboard/web/src/features/cameras/CameraPanel.tsx dashboard/web/src/features/cameras/CamerasScreen.tsx "dashboard/web/src/app/(app)/setup/cameras/page.tsx" dashboard/web/src/features/map/MapScreen.tsx dashboard/web/src/features/phones/LiveScreen.tsx dashboard/web/src/features/phones/SourceSelect.tsx "dashboard/web/src/app/(app)/live/actions.ts" dashboard/web/tests/integration/camera-source.test.ts dashboard/web/tests/unit/camera-actions-guard.test.ts dashboard/web/tests/unit/cameraPanelLive.test.tsx dashboard/web/tests/unit/snapshot.test.ts dashboard/web/tests/unit/mapScreen.test.tsx dashboard/web/tests/unit/camerasScreen.test.tsx dashboard/web/tests/unit/expandedFeed.test.tsx dashboard/web/tests/unit/liveScreen.test.tsx
git commit -m "feat(dashboard): link phones to map cameras with a LIVE panel and simulation fallback"
```
(Add any other fixture file you changed in Step 2 to the `git add` list by its explicit path.)

---

### Task 8: ffmpeg in the image, docs, end-to-end check

**Files:**
- Modify: `dashboard/web/Dockerfile`, `dashboard/README.md`, `CLAUDE.md`, `agent.md`
- Scratchpad only (never committed): `<scratchpad>/plan-e/e2e.mjs`, screenshots

- [ ] **Step 1: ffmpeg**

`dashboard/web/Dockerfile`: change the apt line to
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates ffmpeg && rm -rf /var/lib/apt/lists/*
```
Run: `cd dashboard && docker compose build web && docker compose run --rm --no-deps web ffmpeg -version | head -1`. Expected: `ffmpeg version …`.

- [ ] **Step 2: Docs**

- `dashboard/README.md`: a new section **Live phone cameras** covering:
  1. Set `LAN_HOST` in `dashboard/.env` (`ipconfig getifaddr en0`) and run `docker compose up -d --build`. Caddy serves `https://localhost:3443` and `https://LAN_HOST:3443`, the only port open to the LAN.
  2. Admins open **Live cameras → Connect phone** and scan the QR code. On the phone, accept the one-time certificate warning (Caddy's own CA; optionally install `docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt .` on the phone to remove it), sign in as a volunteer or admin, and press Start.
  3. The **Live cameras** page, the motion view (a viewing aid, not the detector), and the Source picker (Setup → Cameras or the map panel; admin only).
  4. Recording: `RECORDINGS_ROOT` (`./recordings`, git-ignored), 10-minute mp4 segments, 72 h retention (`RECORDING_RETENTION_HOURS`), `RECORDING=off`, admin-only Recordings list.
  5. Limits: one `web` instance holds frames in memory; about 6 phones; no audio; LAN only; phone footage never reaches the detector.
- `CLAUDE.md` (Commands): one paragraph. Phones: set `LAN_HOST` in `dashboard/.env`, `docker compose up -d --build`, then open `https://<LAN_HOST>:3443/cam` on a phone (VOLUNTEER/ADMIN) and watch on `/live`. Recordings go to `dashboard/recordings/` (git-ignored, never staged). Host dev `npm run dev` also records there (as `.avi` without ffmpeg).
- `agent.md` (Real dashboard paragraph): one sentence. The dashboard also receives live JPEG frames from signed-in phones on the local network and records them under `dashboard/recordings/`; these frames and recordings are real footage, never committed, and never fed to the detector.

- [ ] **Step 3: End-to-end (Playwright, Chrome fake media, through Caddy)**

Prerequisites: `cd dashboard && docker compose up -d --build`, and the admin credentials in `dashboard/.env`. Script `<scratchpad>/plan-e/e2e.mjs` imports `chromium` from `/Users/segfault/Documents/islanderhack2026/nesttrace/node_modules/playwright/index.mjs`. It launches with `args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']` and `channel: 'chrome'` when available, and uses contexts with `ignoreHTTPSErrors: true`. Steps and assertions:
1. **Phone context** (viewport 390×844): goto `https://localhost:3443/cam`, which redirects to `/login?next=/cam`. Sign in as admin and land back on `/cam`. Fill Phone name `E2E phone` and press Start. Within 5 s the page shows `Live · not linked yet` and an fps readout ≥ 3.
2. **Desktop context** (admin): goto `https://localhost:3443/live`. A tile `E2E phone` appears within 4 s. Its `<img>` `naturalWidth > 0` changes `src` at least 3 times in 2 s, and **REC** is visible. Expand opens the overlay; Escape closes it.
3. **Link:** goto `/setup/cameras` and set the **Source** of `E1` (or `B1` when the dev DB has no Zone E) to `E2E phone`. Back on the phone page, the status reads `Live · linked to E1` (or B1) within 3 s.
4. **Map:** goto `/` and click the marker `Camera E1, online`. The panel shows `LIVE` and the image `Live picture from E2E phone`. Press **Motion view**: on `/live/motion?device=…` the moving-share text reads > 0 % within 3 s (Chrome's fake camera animates).
5. **Offline fallback:** close the phone page. Within 15 s the map panel shows `Phone offline · E2E phone` and a `<video>` (simulation loop), and the `/live` grid shows the empty state.
6. **Recording:** within 40 s `GET /api/live/recordings` (desktop context `request`) lists a recording for the device with `playable: true`. Clicking **Play** on `/live` yields a `<video>` whose `readyState >= 2` and `duration > 5`.
7. **Unlink:** set the Source back to `Simulation loop`; the audit trail has two `camera.source` rows (`docker compose exec db psql -U nesttrace -c "select details from \"AuditLog\" where action='camera.source' order by \"createdAt\" desc limit 2"`).
8. Screenshots of each step go to `<scratchpad>/plan-e/` (phone + desktop). `ls dashboard/recordings/*/*/` shows `.mp4` + `.json` and no `.avi`.

Expected: every assertion passes. On failure, fix the owning task's code (with a test) and rerun; do not loosen the assertions.

- [ ] **Step 4: Full verification**

```bash
cd dashboard/web && npm run db:test:prepare && npx vitest run && npx tsc --noEmit && npx next build
cd ../.. && npm test        # root research suite untouched by this plan, must still pass
git status --short          # no dashboard/recordings, artifacts, media, .env, .superpowers entries staged
```
Expected: all green; `git status` shows only intended files.

- [ ] **Step 5: Commit**

```bash
git add dashboard/web/Dockerfile dashboard/README.md CLAUDE.md agent.md
git commit -m "docs: live phone cameras over LAN HTTPS, recording and ffmpeg in the web image"
```
Then ask the user to do the real-phone check (spec §7): scan the QR on a phone on the same Wi-Fi, accept the certificate, sign in, Start, and confirm the tile, the map LIVE panel and a recording.

---

## Self-review

**Spec coverage**
- §2 navigation and pages:
  - Top-bar item → T6.
  - `/live` tiles, REC, Motion view, Expand + Escape, empty state, admin Connect phone and Recordings → T6.
  - `/live/motion` (both modes, threshold, viewing-aid label) → T6.
  - `/cam` (VIEWER message, name in localStorage, facing, presets, Start/Stop, preview, fps, linked status, wake lock, plain errors) → T5.
- §3 frames:
  - `LiveDevice` fields → T2 schema.
  - Register/reuse → T2.
  - POST limits and auth, in-memory store, `lastSeenAt` ≤ 1/5 s → T2.
  - GET no-store, `X-Frame-At`, ETag/304, 404 after 10 s → T2.
  - Devices list (online for all, all for admins) → T2.
  - 3 s device poll and 5 Hz frame poll → T6.
- §4 linking:
  - Unique `Camera.liveDeviceId` → T2 schema.
  - Source in Setup and the map panel, admin re-read from DB, `camera.source` audit, `publishChange` → T7.
  - Panel LIVE / "Phone offline" / loop, Raw only, motion link → T7.
  - Unlink on user disable and device removal → T7.
- §5 recording:
  - 5 fps wall clock, gap fill, 10 s gap close, 10 min roll, sidecar fields → T3/T4.
  - ffmpeg conversion and avi delete, start-up conversion, no-ffmpeg keeps avi → T4.
  - Layout, `RECORDINGS_ROOT` bind mount, git-ignore → T1/T4.
  - Hourly 72 h retention, `RECORDING=off` → T4.
  - Admin Recordings list with Play/Download, Range, path validation → T4/T6.
  - ffmpeg in the image → T8.
- §6 HTTPS: Caddy `tls internal`, `0.0.0.0:3443`, `flush_interval -1`, 1 MB, loopback web/db, Secure cookie on `X-Forwarded-Proto`, `LAN_HOST` QR → T1/T6; README certificate note → T8.
- §7 testing:
  - Unit: frame store → T2; motion → T6; segmenter → T3; paths → T4.
  - Integration: register/reuse, POST auth matrix, 413/429, GET 304/404 → T2; Source audited/admin/unique, unlink on disable/remove → T7; recordings admin and path-safe → T4 (unit with real temp files, since recordings are not in the DB).
  - UI: top bar, `/live` empty/tiles → T6; panel LIVE/offline → T7; `/cam` role gate/errors → T5.
  - E2E and real phone → T8.
- §8 out of scope: no audio (`audio: false`), LAN only, single instance documented, no detector wiring.

**Placeholder scan:** no TBD/TODO. UI tasks (T5 Step 4, T6 Step 6, T7 Step 4) use explicit behaviour lists, the convention Plan C used, and each has a dom test pinning the load-bearing behaviour.

**Type consistency:**
- `LiveDeviceView` (T2) is consumed by `useLiveDevices`, `LiveScreen`, `SourceSelect` and `CamerasScreen`.
- `FrameRecorder` (T2) is implemented by `Recorder` (T4).
- `SegmentStart`/`SegmentSink` (T3) are used by `Recorder.openSink` (T4).
- `RecordingView` (T4) is consumed by `RecordingsPanel` (T6).
- `CameraView.liveDevice` (T7) is read by `CameraPanel` (T7).
- `CameraActionResult` is reused for `setCameraSource`.
- `Page` gains `'live'` (T6).

**Review Focus:** each of the five items names its owning task and test file.

### Spec ambiguities resolved in this plan
1. "Deleting a device" = an admin **Remove** that sets `LiveDevice.disabledAt`. The camera is unlinked, the device leaves the lists, it takes no frames, and a later Start under the same name registers a fresh device.
2. Sending requires VOLUNTEER or ADMIN even for a device's owner (a VIEWER who somehow owns one gets 403). An ADMIN may send for any device.
3. A non-JPEG body gets 415 (the spec lists only 413/429).
4. The phone sends at most 5 frames/s in both presets (matching the 5 fps recording, under the 10/s cap).
5. Recording paths use UTC dates and times. A second segment for the same device in the same second gets a `-2` suffix.
6. The sidecar is written when a segment opens (`.avi.part`), so segments cut off by a kill are repaired and converted at start-up (beyond the spec's "leftover .avi" case).
7. Retention is judged by the sidecar's `endedAt` (start + 10 min for unfinished segments).
8. The motion view's background rate is 0.1 per new frame, so a still object fades in about 3 s at 5 fps (the teammate used 0.03, about 10 s).
9. Sign-in gains a validated `next` parameter, and `/cam` sits outside the `(app)` layout, so the QR → login → `/cam` flow returns to the phone page.
10. Linking a phone that already feeds another camera is refused with a message (no silent move).
11. Caddy adds `default_sni {$LAN_HOST}`, because phones opening an IP address send no SNI.
12. The map panel derives "Phone offline" from frame polling (404) rather than a second devices poll. The live picture there has no Expand (Raw only, per spec); Expand lives on `/live`.
13. The end-to-end check links `E1` as the spec says when the dev database has it, otherwise `B1` (the seed has no Zone E).
14. Frame-store entries silent for over 60 s are pruned so removed or abandoned phones do not hold memory.
15. The Caddy image is `caddy:2` exactly as the spec states; the npm dependencies are pinned exactly.
