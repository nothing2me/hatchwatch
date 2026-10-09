# NestTrace Dashboard — Plan B: Live Device Cameras — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any signed-in phone or laptop on the same Wi-Fi open `https://<LAN_HOST>:3443/cam`, stream its camera over WebRTC, and let an admin assign that device to a dashboard camera, which then shows a LIVE feed instead of the simulation loop (falling back to the loop when the device goes offline).

**Architecture:** A `caddy` Compose service terminates HTTPS on `0.0.0.0:3443` with its internal CA and proxies to `web:3000` (which, like Postgres, stays bound to 127.0.0.1). Devices register in a `LiveDevice` table and heartbeat every 5 s. Signalling is an in-memory hub inside the single `web` process: each browser opens an SSE stream (`/api/live/events`) and posts messages (`/api/live/signal`); the hub routes them only between a device and its viewers. Media flows browser-to-browser over the LAN (host ICE candidates, no STUN/TURN). The camera panel picks its feed (live / simulation / none) from one helper; the Source dropdown is admin-only and re-checks the role from the database.

**Tech Stack:** Plan 1/A stack (Next.js 16.4.0, React 19.3.0, Prisma 7.10.0, Vitest 5, zod 4.6.5) + `caddy:2.10-alpine`, browser WebRTC (`RTCPeerConnection`, `getUserMedia`, Screen Wake Lock), `qrcode` 1.5.4 (+ `@types/qrcode` 1.5.6), Playwright Chrome with fake media for verification.

**Spec:** `docs/superpowers/specs/2026-10-09-simulation-and-live-cameras-design.md` (Part B = §3). Parent: `docs/superpowers/specs/2026-10-09-nesttrace-dashboard-design.md`.

## Global Constraints

- Only port 3443 is reachable from the LAN. `web` stays `127.0.0.1:3000`, `db` stays `127.0.0.1:5433`. Every page and API on 3443 requires login.
- Session cookies are `Secure` whenever the request arrived over HTTPS (`X-Forwarded-Proto: https`), regardless of `INSECURE_COOKIES`.
- Device page `/cam`: any signed-in role. Assigning a device to a camera: ADMIN only, role re-read from the database (not the JWT), and an `AuditLog` row is written.
- One device feeds at most one camera (`Camera.liveDeviceId` unique). A device is online when `lastSeenAt` is within 15 s.
- Signalling messages are relayed only between a device and a viewer of that same device; max 4 viewers per device; body ≤ 64 KB; zod-validated. A viewer may join only a device that is currently assigned to a camera and online.
- Live view only: no recording, no analysis of phone feeds.
- `LAN_HOST` env holds the laptop's LAN IP; the QR code and Caddy site address use it.
- Commit messages: no `Co-Authored-By`, no AI attribution. Stage explicit paths only; never stage `artifacts/`, `dashboard/media/`, `.superpowers/`, `.env`, or Caddy data.
- Boundary unchanged: nothing under `dashboard/` references the simulator, the research API, or `private/` paths.

## Review Focus

1. **Spoofed signalling** (a viewer posts as the device, or as another user's peer, or targets another device's viewer) → rejected 403; the hub records each peer's owning user id and device id. Pinned in Task 3 hub + route tests.
2. **Device goes away mid-stream** (phone locks, tab closes, SSE drops) → viewers get `leave`, the camera falls back to the simulation loop within ~15 s and shows "Device offline". Pinned in Task 3 (hub `leave` on disconnect) and Task 5 (feed selection test).
3. **Fifth viewer** → gets a `full` message and the panel shows "Too many viewers"; existing four unaffected. Pinned in Task 3.
4. **Opened over plain http on the phone / camera permission denied / no camera** → plain-language error on `/cam`, no crash. Pinned in Task 4 (`describeMediaError` tests).
5. **Assigning a device already used by another camera, or as a VIEWER** → rejected with a clear error; no partial update. Pinned in Task 2 action tests.

---

## File Structure

```
dashboard/
  docker-compose.yml               + caddy service, LAN_HOST passthrough
  Caddyfile                        https://{$LAN_HOST}:3443, https://localhost:3443 → web:3000
  .env.example                     + LAN_HOST
  web/
    next.config.ts                 serverActions.allowedOrigins for LAN_HOST:3443
    prisma/schema.prisma           LiveDevice, Camera.liveDeviceId
    src/lib/auth/session.ts        sessionCookieOptions({ secure })
    src/lib/auth/requestSecurity.ts isHttpsRequest(headers)
    src/lib/auth/guard.ts          + requireCurrentUser(role?) (DB-backed)
    src/lib/live/devices.ts        DEVICE_ONLINE_MS, isDeviceOnline(), registerDevice(), touchDevice(), listDevices()
    src/lib/live/protocol.ts       zod schemas for signal messages
    src/lib/live/hub.ts            LiveHub (pure, in-memory), liveHub singleton
    src/app/api/live/devices/route.ts            POST register, GET list
    src/app/api/live/devices/[deviceId]/heartbeat/route.ts
    src/app/api/live/events/route.ts             SSE
    src/app/api/live/signal/route.ts             POST relay
    src/app/api/live/status/route.ts             GET camera→device online map
    src/app/(app)/live-actions.ts                assignCameraSource server action
    src/app/cam/page.tsx + CamStreamer.tsx       device page (outside (app) layout chrome)
    src/features/live/signalClient.ts            SSE + POST client helper
    src/features/live/mediaErrors.ts             describeMediaError()
    src/features/live/LiveVideo.tsx              viewer player
    src/features/live/useLiveStatus.ts           polls /api/live/status every 5 s
    src/features/live/ConnectDeviceDialog.tsx    QR code + URL
    src/features/cameras/feed.ts                 feedFor(camera, liveStatus)
    src/features/cameras/CameraPanel.tsx         Source dropdown, LIVE badge, feed switch
    src/features/map/MapScreen.tsx               live status, feed-key playback reset
    src/features/shell/TopBar.tsx                Connect device button (admin)
```

---

### Task 1: HTTPS on the LAN via Caddy, secure cookies behind the proxy

**Files:**
- Create: `dashboard/Caddyfile`, `dashboard/web/src/lib/auth/requestSecurity.ts`
- Modify: `dashboard/docker-compose.yml`, `dashboard/.env.example`, `dashboard/.gitignore`, `dashboard/web/src/lib/auth/session.ts`, `dashboard/web/src/app/(auth)/login/actions.ts`, `dashboard/web/next.config.ts`
- Test: `dashboard/web/tests/unit/requestSecurity.test.ts`, extend `dashboard/web/tests/unit/session.test.ts`

**Interfaces:**
- Produces: `isHttpsRequest(headers: Headers): boolean`; `sessionCookieOptions(options?: { secure?: boolean })` — `secure` true if `options.secure` OR (`NODE_ENV==='production'` AND `INSECURE_COOKIES!=='1'`).

- [ ] **Step 1: Failing tests**

`tests/unit/requestSecurity.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isHttpsRequest } from '@/lib/auth/requestSecurity';

describe('isHttpsRequest', () =>
{
    it('trusts X-Forwarded-Proto from the proxy', () =>
    {
        expect(isHttpsRequest(new Headers({ 'x-forwarded-proto': 'https' }))).toBe(true);
        expect(isHttpsRequest(new Headers({ 'x-forwarded-proto': 'https,http' }))).toBe(true);
        expect(isHttpsRequest(new Headers({ 'x-forwarded-proto': 'http' }))).toBe(false);
        expect(isHttpsRequest(new Headers())).toBe(false);
    });
});
```
Add to `tests/unit/session.test.ts`:
```ts
import { sessionCookieOptions } from '@/lib/auth/session';

describe('sessionCookieOptions', () =>
{
    it('forces Secure for HTTPS requests even with INSECURE_COOKIES', () =>
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
Run: `npx vitest run tests/unit/requestSecurity.test.ts tests/unit/session.test.ts` → FAIL.

- [ ] **Step 2: Implement**

`src/lib/auth/requestSecurity.ts`:
```ts
// Caddy terminates TLS on :3443 and forwards X-Forwarded-Proto. Port 3000 is loopback-only, so the header is trusted.
export function isHttpsRequest(headers: Headers): boolean
{
    return (headers.get('x-forwarded-proto') ?? '').split(',')[0].trim().toLowerCase() === 'https';
}
```
`src/lib/auth/session.ts` — replace `sessionCookieOptions`:
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
`src/app/(auth)/login/actions.ts` — import `headers` from `next/headers` and `isHttpsRequest`; set the cookie with `sessionCookieOptions({ secure: isHttpsRequest(await headers()) })`.
Run tests → PASS; full `npx vitest run` → PASS.

- [ ] **Step 3: Caddy + Compose**

`dashboard/Caddyfile`:
```
{
	# Self-signed certificates from Caddy's internal CA; never contact ACME.
	local_certs
	auto_https disable_redirects
}

https://{$LAN_HOST}:3443, https://localhost:3443 {
	tls internal
	reverse_proxy web:3000 {
		# Server-sent events must not be buffered.
		flush_interval -1
	}
}
```
`dashboard/docker-compose.yml` — add service (and keep `web`, `db` unchanged):
```yaml
  caddy:
    image: caddy:2.10-alpine
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
and add `caddy_data:` under top-level `volumes:`.
`dashboard/.env.example` — add:
```bash
# Laptop LAN IP for phone cameras (macOS: ipconfig getifaddr en0). Phones open https://LAN_HOST:3443/cam
LAN_HOST=192.168.1.20
```
Set your real `LAN_HOST` in local `dashboard/.env` and `dashboard/web/.env` (`ipconfig getifaddr en0`).

`dashboard/web/next.config.ts` — add Server Actions origins so form posts through Caddy are accepted:
```ts
    experimental: {
        authInterrupts: true,
        serverActions: {
            allowedOrigins: ['localhost:3443', ...(process.env.LAN_HOST ? [`${process.env.LAN_HOST}:3443`] : [])],
        },
    },
```
`next.config.ts` is evaluated at build time in the image; pass `LAN_HOST` into the `web` build so it is present: in Compose `web.build` use `args: { LAN_HOST: ${LAN_HOST:-127.0.0.1} }` and in `web/Dockerfile` add `ARG LAN_HOST` + `ENV LAN_HOST=$LAN_HOST` before `npm run build`. Also `web.environment.LAN_HOST: ${LAN_HOST:-127.0.0.1}` for runtime.

- [ ] **Step 4: Verify through the proxy**

```bash
cd dashboard && docker compose up -d --build
curl -sk -o /dev/null -w '%{http_code}\n' https://localhost:3443/login          # 200
curl -sk -o /dev/null -w '%{http_code}\n' https://$(ipconfig getifaddr en0):3443/login   # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/login            # 200 (loopback still works)
lsof -nP -iTCP:3000 -sTCP:LISTEN | grep -c 127.0.0.1                             # web still loopback-only
```
Then with Playwright (`ignoreHTTPSErrors: true`) log in at `https://localhost:3443/login` as admin and assert the response `Set-Cookie` includes `Secure` and the map loads (server action accepted through the proxy). Script in the session scratchpad.

- [ ] **Step 5: Commit**

```bash
git add dashboard/Caddyfile dashboard/docker-compose.yml dashboard/.env.example dashboard/web/Dockerfile dashboard/web/next.config.ts dashboard/web/src/lib/auth dashboard/web/src/app/\(auth\)/login/actions.ts dashboard/web/tests/unit/requestSecurity.test.ts dashboard/web/tests/unit/session.test.ts
git commit -m "feat(dashboard): HTTPS on the LAN through Caddy with secure session cookies"
```

---

### Task 2: LiveDevice model, device API, DB-backed admin guard, source assignment

**Files:**
- Modify: `dashboard/web/prisma/schema.prisma`, `dashboard/web/src/lib/auth/guard.ts`, `dashboard/web/src/lib/types.ts`, `dashboard/web/src/server/snapshot.ts`
- Create: `dashboard/web/src/lib/live/devices.ts`, `dashboard/web/src/app/api/live/devices/route.ts`, `dashboard/web/src/app/api/live/devices/[deviceId]/heartbeat/route.ts`, `dashboard/web/src/app/api/live/status/route.ts`, `dashboard/web/src/app/(app)/live-actions.ts`
- Test: `dashboard/web/tests/unit/devices.test.ts`, `dashboard/web/tests/integration/live-devices.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // guard.ts
  export function requireCurrentUser(role?: Role): Promise<SessionUser>; // re-reads user from DB; redirect /login if missing; forbidden() if role insufficient
  export function currentUserOrNull(): Promise<SessionUser | null>;     // DB-backed, for route handlers (no redirect)
  // devices.ts
  export const DEVICE_ONLINE_MS = 15_000;
  export function isDeviceOnline(lastSeenAt: Date, now?: Date): boolean;
  export function registerDevice(prisma, ownerId: string, name: string): Promise<{ id: string; name: string }>;
  export function touchDevice(prisma, deviceId: string, ownerId: string): Promise<boolean>; // false if not owner / missing
  export function listDevices(prisma, now?: Date): Promise<LiveDeviceView[]>;
  export function assignSource(prisma, input: { cameraCode: string; deviceId: string | null; userId: string }): Promise<void>; // throws AssignError
  export class AssignError extends Error { code: 'NO_CAMERA' | 'NO_DEVICE' | 'DEVICE_IN_USE' }
  // types.ts
  export interface LiveDeviceView { id: string; name: string; online: boolean; cameraCode: string | null }
  // CameraView adds: liveDeviceId: string | null
  // live-actions.ts ('use server')
  export async function assignCameraSource(cameraCode: string, deviceId: string | null): Promise<{ ok: true } | { ok: false; error: string }>;
  ```
- HTTP: `POST /api/live/devices` `{ name }` → `201 { id, name }`; `GET /api/live/devices` → `{ devices: LiveDeviceView[] }`; `POST /api/live/devices/:id/heartbeat` → `204` (owner only, else 404); `GET /api/live/status` → `{ cameras: Record<cameraCode, { deviceId: string; name: string; online: boolean }> }`. All 401 without a DB-valid user.

- [ ] **Step 1: Schema**

```prisma
model LiveDevice {
  id         String   @id @default(cuid())
  name       String
  ownerId    String
  owner      User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  lastSeenAt DateTime @default(now())
  createdAt  DateTime @default(now())
  camera     Camera?

  @@index([ownerId])
}
```
`model Camera` add:
```prisma
  liveDeviceId String?     @unique
  liveDevice   LiveDevice? @relation(fields: [liveDeviceId], references: [id], onDelete: SetNull)
```
`model User` add `liveDevices LiveDevice[]`.
Run: `npx prisma migrate dev --name live_devices && npm run db:test:prepare`.

- [ ] **Step 2: Failing unit test for online window**

`tests/unit/devices.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { DEVICE_ONLINE_MS, isDeviceOnline } from '@/lib/live/devices';

describe('isDeviceOnline', () =>
{
    const now = new Date('2026-10-09T20:00:00Z');
    it('is online within 15 s of the last heartbeat', () =>
    {
        expect(DEVICE_ONLINE_MS).toBe(15_000);
        expect(isDeviceOnline(new Date(now.getTime() - 14_999), now)).toBe(true);
        expect(isDeviceOnline(new Date(now.getTime() - 15_001), now)).toBe(false);
    });
});
```

- [ ] **Step 3: Failing integration tests**

`tests/integration/live-devices.test.ts` (same `_test` DB guard + TRUNCATE + `seedDatabase` pattern as `tests/integration/sim-import.test.ts`; add `"LiveDevice"` to the TRUNCATE list):
```ts
// … guard/TRUNCATE/seed boilerplate as in sim-import.test.ts …
import { AssignError, assignSource, listDevices, registerDevice, touchDevice } from '@/lib/live/devices';

describe('live devices', () =>
{
    it('registers, heartbeats only for the owner, and lists online state', async () =>
    {
        const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
        const viewer = await prisma.user.findFirstOrThrow({ where: { role: 'VIEWER' } });
        const device = await registerDevice(prisma, viewer.id, '  Pixel 7  ');
        expect(device.name).toBe('Pixel 7');
        expect(await touchDevice(prisma, device.id, admin.id)).toBe(false);
        expect(await touchDevice(prisma, device.id, viewer.id)).toBe(true);
        const later = new Date(Date.now() + 60_000);
        expect((await listDevices(prisma)).find(d => d.id === device.id)?.online).toBe(true);
        expect((await listDevices(prisma, later)).find(d => d.id === device.id)?.online).toBe(false);
    });

    it('assigns a device to one camera at a time and clears it', async () =>
    {
        const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
        const device = await registerDevice(prisma, admin.id, 'Laptop');
        await assignSource(prisma, { cameraCode: 'B1', deviceId: device.id, userId: admin.id });
        expect((await prisma.camera.findUniqueOrThrow({ where: { code: 'B1' } })).liveDeviceId).toBe(device.id);
        await expect(assignSource(prisma, { cameraCode: 'C1', deviceId: device.id, userId: admin.id }))
            .rejects.toMatchObject({ code: 'DEVICE_IN_USE' });
        await expect(assignSource(prisma, { cameraCode: 'Z9', deviceId: null, userId: admin.id }))
            .rejects.toBeInstanceOf(AssignError);
        await assignSource(prisma, { cameraCode: 'B1', deviceId: null, userId: admin.id });
        expect((await prisma.camera.findUniqueOrThrow({ where: { code: 'B1' } })).liveDeviceId).toBeNull();
        expect(await prisma.auditLog.count({ where: { action: 'camera.source' } })).toBe(2);
        expect((await listDevices(prisma)).find(d => d.id === device.id)?.cameraCode).toBeNull();
    });
});
```
Run → FAIL.

- [ ] **Step 4: Implement `src/lib/live/devices.ts`**

```ts
import type { PrismaClient } from '@/generated/prisma/client';
import type { LiveDeviceView } from '@/lib/types';

export const DEVICE_ONLINE_MS = 15_000;

export function isDeviceOnline(lastSeenAt: Date, now: Date = new Date()): boolean
{
    return now.getTime() - lastSeenAt.getTime() <= DEVICE_ONLINE_MS;
}

export async function registerDevice(prisma: PrismaClient, ownerId: string, name: string)
{
    const clean = name.trim().slice(0, 60) || 'Unnamed device';
    return prisma.liveDevice.create({ data: { ownerId, name: clean }, select: { id: true, name: true } });
}

export async function touchDevice(prisma: PrismaClient, deviceId: string, ownerId: string): Promise<boolean>
{
    const result = await prisma.liveDevice.updateMany({ where: { id: deviceId, ownerId }, data: { lastSeenAt: new Date() } });
    return result.count === 1;
}

export async function listDevices(prisma: PrismaClient, now: Date = new Date()): Promise<LiveDeviceView[]>
{
    const rows = await prisma.liveDevice.findMany({ orderBy: { createdAt: 'desc' }, include: { camera: { select: { code: true } } } });
    return rows.map(row => ({ id: row.id, name: row.name, online: isDeviceOnline(row.lastSeenAt, now), cameraCode: row.camera?.code ?? null }));
}

export class AssignError extends Error
{
    constructor(public code: 'NO_CAMERA' | 'NO_DEVICE' | 'DEVICE_IN_USE', message: string)
    {
        super(message);
    }
}

export async function assignSource(prisma: PrismaClient, { cameraCode, deviceId, userId }: { cameraCode: string; deviceId: string | null; userId: string })
{
    await prisma.$transaction(async tx =>
    {
        const camera = await tx.camera.findUnique({ where: { code: cameraCode } });
        if (!camera)
        {
            throw new AssignError('NO_CAMERA', `Camera ${cameraCode} does not exist.`);
        }
        if (deviceId)
        {
            const device = await tx.liveDevice.findUnique({ where: { id: deviceId }, include: { camera: { select: { code: true } } } });
            if (!device)
            {
                throw new AssignError('NO_DEVICE', 'That device is no longer registered.');
            }
            if (device.camera && device.camera.code !== cameraCode)
            {
                throw new AssignError('DEVICE_IN_USE', `That device already feeds camera ${device.camera.code}.`);
            }
        }
        await tx.camera.update({ where: { id: camera.id }, data: { liveDeviceId: deviceId } });
        await tx.auditLog.create({ data: { userId, action: 'camera.source', targetType: 'Camera', targetId: camera.id, details: { cameraCode, deviceId } } });
    });
}
```
Add `LiveDeviceView` to `src/lib/types.ts`, and `liveDeviceId: string | null` to `CameraView`; in `snapshot.ts` map `liveDeviceId: camera.liveDeviceId` (add to `CameraRow`) and update snapshot/mapScreen/bounds test fixtures with `liveDeviceId: null`.
Run integration + unit tests → PASS.

- [ ] **Step 5: DB-backed guard**

Append to `src/lib/auth/guard.ts`:
```ts
import { prisma } from '@/lib/db';

// Session plus a fresh database read: deleted users lose access and role changes apply immediately.
export async function currentUserOrNull(): Promise<SessionUser | null>
{
    const session = await getSession();
    if (!session)
    {
        return null;
    }
    const row = await prisma.user.findUnique({ where: { id: session.id }, select: { id: true, email: true, name: true, role: true } });
    return row ?? null;
}

export async function requireCurrentUser(role: Role = 'VIEWER'): Promise<SessionUser>
{
    const user = await currentUserOrNull();
    if (!user)
    {
        redirect('/login');
    }
    if (!hasRole(user, role))
    {
        forbidden();
    }
    return user;
}
```
(`guard.ts` already imports `redirect`, `forbidden`; keep `import 'server-only'` first.)

- [ ] **Step 6: Routes and action**

`src/app/api/live/devices/route.ts`:
```ts
import { z } from 'zod';
import { currentUserOrNull } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { listDevices, registerDevice } from '@/lib/live/devices';

export const dynamic = 'force-dynamic';

const body = z.object({ name: z.string().max(200) });

export async function POST(request: Request): Promise<Response>
{
    const user = await currentUserOrNull();
    if (!user)
    {
        return new Response('Unauthorized', { status: 401 });
    }
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
    {
        return Response.json({ error: 'Invalid device name' }, { status: 400 });
    }
    return Response.json(await registerDevice(prisma, user.id, parsed.data.name), { status: 201 });
}

export async function GET(): Promise<Response>
{
    if (!(await currentUserOrNull()))
    {
        return new Response('Unauthorized', { status: 401 });
    }
    return Response.json({ devices: await listDevices(prisma) });
}
```
`src/app/api/live/devices/[deviceId]/heartbeat/route.ts`:
```ts
import { currentUserOrNull } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { touchDevice } from '@/lib/live/devices';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, context: { params: Promise<{ deviceId: string }> }): Promise<Response>
{
    const user = await currentUserOrNull();
    if (!user)
    {
        return new Response('Unauthorized', { status: 401 });
    }
    const { deviceId } = await context.params;
    return (await touchDevice(prisma, deviceId, user.id)) ? new Response(null, { status: 204 }) : new Response('Not found', { status: 404 });
}
```
`src/app/api/live/status/route.ts`:
```ts
import { currentUserOrNull } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { isDeviceOnline } from '@/lib/live/devices';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response>
{
    if (!(await currentUserOrNull()))
    {
        return new Response('Unauthorized', { status: 401 });
    }
    const cameras = await prisma.camera.findMany({ where: { liveDeviceId: { not: null } }, select: { code: true, liveDevice: { select: { id: true, name: true, lastSeenAt: true } } } });
    return Response.json({
        cameras: Object.fromEntries(cameras.filter(c => c.liveDevice).map(c => [c.code, { deviceId: c.liveDevice!.id, name: c.liveDevice!.name, online: isDeviceOnline(c.liveDevice!.lastSeenAt) }])),
    });
}
```
`src/app/(app)/live-actions.ts`:
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireCurrentUser } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { AssignError, assignSource } from '@/lib/live/devices';

export async function assignCameraSource(cameraCode: string, deviceId: string | null): Promise<{ ok: true } | { ok: false; error: string }>
{
    const user = await requireCurrentUser('ADMIN');
    try
    {
        await assignSource(prisma, { cameraCode, deviceId, userId: user.id });
    }
    catch (error)
    {
        if (error instanceof AssignError)
        {
            return { ok: false, error: error.message };
        }
        throw error;
    }
    revalidatePath('/');
    return { ok: true };
}
```
Unit test the route auth: `tests/unit/live-routes.test.ts` mocking `@/lib/auth/guard` (`currentUserOrNull`) and `@/lib/db`: POST devices → 401 without user, 400 on bad JSON, 201 with user; heartbeat → 404 when `touchDevice` false (mock `@/lib/live/devices`).

- [ ] **Step 7: Run all, commit**

Run: `npx vitest run && npx tsc --noEmit`
```bash
git add dashboard/web/prisma dashboard/web/src/lib dashboard/web/src/server/snapshot.ts dashboard/web/src/app/api/live dashboard/web/src/app/\(app\)/live-actions.ts dashboard/web/tests
git commit -m "feat(dashboard): live devices, DB-backed admin guard and camera source assignment"
```

---

### Task 3: In-memory signalling hub, SSE events and signal relay

**Files:**
- Create: `dashboard/web/src/lib/live/protocol.ts`, `dashboard/web/src/lib/live/hub.ts`, `dashboard/web/src/app/api/live/events/route.ts`, `dashboard/web/src/app/api/live/signal/route.ts`
- Test: `dashboard/web/tests/unit/hub.test.ts`, `dashboard/web/tests/unit/signal-route.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // protocol.ts
  export const MAX_SIGNAL_BYTES = 65_536;
  export const MAX_VIEWERS = 4;
  export const signalSchema: z.ZodType<{ from: string; to?: string; deviceId: string; type: 'offer'|'answer'|'ice'|'leave'; payload?: unknown }>;
  export type HubEvent =
    | { type: 'hello'; peerId: string }
    | { type: 'join'; from: string }                 // to device: a viewer arrived
    | { type: 'offer' | 'answer' | 'ice'; from: string; payload: unknown }
    | { type: 'leave'; from: string }
    | { type: 'full' }                                // to viewer: cap reached
    | { type: 'device-offline' };                     // to viewer: device not connected
  // hub.ts
  export interface PeerSink { send(event: HubEvent): void; close(): void }
  export class LiveHub {
    connectDevice(deviceId: string, userId: string, sink: PeerSink): string;   // returns peerId; replaces an older device peer (old one gets close())
    connectViewer(deviceId: string, userId: string, sink: PeerSink): string | null; // null when full or device offline (sink already told why and closed)
    disconnect(peerId: string): void;
    relay(senderUserId: string, message: SignalMessage): 'ok' | 'forbidden' | 'unknown-peer';
    viewerCount(deviceId: string): number;
  }
  export const liveHub: LiveHub; // globalThis singleton
  ```
- HTTP: `GET /api/live/events?role=device|viewer&device=<id>` → `text/event-stream`, first event `hello`; `POST /api/live/signal` → 204 / 400 / 403 / 404 / 413.

- [ ] **Step 1: Failing hub tests**

`tests/unit/hub.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { LiveHub } from '@/lib/live/hub';
import type { HubEvent } from '@/lib/live/protocol';

function sink()
{
    const events: HubEvent[] = [];
    let closed = false;
    return { events, get closed() { return closed; }, send: (event: HubEvent) => events.push(event), close: () => { closed = true; } };
}

describe('LiveHub', () =>
{
    it('tells the device when a viewer joins and relays offer/answer between them only', () =>
    {
        const hub = new LiveHub();
        const device = sink();
        const viewer = sink();
        const other = sink();
        const devicePeer = hub.connectDevice('d1', 'owner', device);
        const viewerPeer = hub.connectViewer('d1', 'alice', viewer)!;
        hub.connectDevice('d2', 'owner2', other);

        expect(device.events).toContainEqual({ type: 'join', from: viewerPeer });
        expect(hub.relay('owner', { from: devicePeer, to: viewerPeer, deviceId: 'd1', type: 'offer', payload: { sdp: 'x' } })).toBe('ok');
        expect(viewer.events).toContainEqual({ type: 'offer', from: devicePeer, payload: { sdp: 'x' } });
        expect(hub.relay('alice', { from: viewerPeer, deviceId: 'd1', type: 'answer', payload: { sdp: 'y' } })).toBe('ok');
        expect(device.events).toContainEqual({ type: 'answer', from: viewerPeer, payload: { sdp: 'y' } });
        expect(other.events.filter(e => e.type !== 'hello')).toEqual([]);
    });

    it('rejects spoofed senders and cross-device targets', () =>
    {
        const hub = new LiveHub();
        const devicePeer = hub.connectDevice('d1', 'owner', sink());
        const viewerPeer = hub.connectViewer('d1', 'alice', sink())!;
        const foreignViewer = hub.connectViewer('d2', 'bob', sink());
        expect(foreignViewer).toBeNull();                               // d2 has no device connected
        const d2 = hub.connectDevice('d2', 'owner2', sink());
        const bobPeer = hub.connectViewer('d2', 'bob', sink())!;
        expect(hub.relay('mallory', { from: viewerPeer, deviceId: 'd1', type: 'answer', payload: {} })).toBe('forbidden');
        expect(hub.relay('owner', { from: devicePeer, to: bobPeer, deviceId: 'd1', type: 'offer', payload: {} })).toBe('forbidden');
        expect(hub.relay('owner2', { from: d2, to: viewerPeer, deviceId: 'd2', type: 'offer', payload: {} })).toBe('forbidden');
        expect(hub.relay('owner', { from: 'nope', deviceId: 'd1', type: 'offer', payload: {} })).toBe('unknown-peer');
    });

    it('caps viewers at four and tells the fifth', () =>
    {
        const hub = new LiveHub();
        hub.connectDevice('d1', 'owner', sink());
        for (let i = 0; i < 4; i++) expect(hub.connectViewer('d1', `u${i}`, sink())).not.toBeNull();
        const fifth = sink();
        expect(hub.connectViewer('d1', 'u5', fifth)).toBeNull();
        expect(fifth.events).toContainEqual({ type: 'full' });
        expect(fifth.closed).toBe(true);
        expect(hub.viewerCount('d1')).toBe(4);
    });

    it('notifies viewers when the device disconnects and the device when a viewer leaves', () =>
    {
        const hub = new LiveHub();
        const device = sink();
        const viewer = sink();
        const devicePeer = hub.connectDevice('d1', 'owner', device);
        const viewerPeer = hub.connectViewer('d1', 'alice', viewer)!;
        hub.disconnect(viewerPeer);
        expect(device.events).toContainEqual({ type: 'leave', from: viewerPeer });
        const again = hub.connectViewer('d1', 'alice', viewer)!;
        hub.disconnect(devicePeer);
        expect(viewer.events).toContainEqual({ type: 'leave', from: devicePeer });
        expect(hub.relay('alice', { from: again, deviceId: 'd1', type: 'answer', payload: {} })).toBe('unknown-peer');
    });

    it('replaces an older device connection for the same device', () =>
    {
        const hub = new LiveHub();
        const first = sink();
        hub.connectDevice('d1', 'owner', first);
        hub.connectDevice('d1', 'owner', sink());
        expect(first.closed).toBe(true);
    });
});
```
Run → FAIL.

- [ ] **Step 2: Implement protocol and hub**

`src/lib/live/protocol.ts`:
```ts
import { z } from 'zod';

export const MAX_SIGNAL_BYTES = 65_536;
export const MAX_VIEWERS = 4;

export const signalSchema = z.object({
    from: z.string().min(1).max(64),
    to: z.string().min(1).max(64).optional(),
    deviceId: z.string().min(1).max(64),
    type: z.enum(['offer', 'answer', 'ice', 'leave']),
    payload: z.unknown().optional(),
});

export type SignalMessage = z.infer<typeof signalSchema>;

export type HubEvent =
    | { type: 'hello'; peerId: string }
    | { type: 'join'; from: string }
    | { type: 'offer' | 'answer' | 'ice'; from: string; payload: unknown }
    | { type: 'leave'; from: string }
    | { type: 'full' }
    | { type: 'device-offline' };
```
`src/lib/live/hub.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { MAX_VIEWERS, type HubEvent, type SignalMessage } from './protocol';

export interface PeerSink
{
    send(event: HubEvent): void;
    close(): void;
}

interface Peer
{
    id: string;
    role: 'device' | 'viewer';
    deviceId: string;
    userId: string;
    sink: PeerSink;
}

// Routes WebRTC signalling between one device and its viewers. In memory: one web process only.
export class LiveHub
{
    private peers = new Map<string, Peer>();
    private devices = new Map<string, string>();          // deviceId -> device peerId
    private viewers = new Map<string, Set<string>>();     // deviceId -> viewer peerIds

    connectDevice(deviceId: string, userId: string, sink: PeerSink): string
    {
        const previous = this.devices.get(deviceId);
        if (previous)
        {
            this.disconnect(previous);
        }
        const id = randomUUID();
        this.peers.set(id, { id, role: 'device', deviceId, userId, sink });
        this.devices.set(deviceId, id);
        sink.send({ type: 'hello', peerId: id });
        for (const viewerId of this.viewers.get(deviceId) ?? [])
        {
            sink.send({ type: 'join', from: viewerId });
        }
        return id;
    }

    connectViewer(deviceId: string, userId: string, sink: PeerSink): string | null
    {
        const devicePeer = this.devices.get(deviceId);
        if (!devicePeer)
        {
            sink.send({ type: 'device-offline' });
            sink.close();
            return null;
        }
        const set = this.viewers.get(deviceId) ?? new Set<string>();
        if (set.size >= MAX_VIEWERS)
        {
            sink.send({ type: 'full' });
            sink.close();
            return null;
        }
        const id = randomUUID();
        this.peers.set(id, { id, role: 'viewer', deviceId, userId, sink });
        set.add(id);
        this.viewers.set(deviceId, set);
        sink.send({ type: 'hello', peerId: id });
        this.peers.get(devicePeer)!.sink.send({ type: 'join', from: id });
        return id;
    }

    disconnect(peerId: string): void
    {
        const peer = this.peers.get(peerId);
        if (!peer)
        {
            return;
        }
        this.peers.delete(peerId);
        peer.sink.close();
        if (peer.role === 'device')
        {
            if (this.devices.get(peer.deviceId) === peerId)
            {
                this.devices.delete(peer.deviceId);
            }
            for (const viewerId of this.viewers.get(peer.deviceId) ?? [])
            {
                this.peers.get(viewerId)?.sink.send({ type: 'leave', from: peerId });
            }
        }
        else
        {
            this.viewers.get(peer.deviceId)?.delete(peerId);
            const devicePeer = this.devices.get(peer.deviceId);
            if (devicePeer)
            {
                this.peers.get(devicePeer)?.sink.send({ type: 'leave', from: peerId });
            }
        }
    }

    relay(senderUserId: string, message: SignalMessage): 'ok' | 'forbidden' | 'unknown-peer'
    {
        const sender = this.peers.get(message.from);
        if (!sender)
        {
            return 'unknown-peer';
        }
        if (sender.userId !== senderUserId || sender.deviceId !== message.deviceId)
        {
            return 'forbidden';
        }
        const targetId = sender.role === 'viewer' ? this.devices.get(sender.deviceId) : message.to;
        const target = targetId ? this.peers.get(targetId) : undefined;
        if (!target)
        {
            return 'unknown-peer';
        }
        if (target.deviceId !== sender.deviceId || target.role === sender.role)
        {
            return 'forbidden';
        }
        if (message.type === 'leave')
        {
            target.sink.send({ type: 'leave', from: sender.id });
        }
        else
        {
            target.sink.send({ type: message.type, from: sender.id, payload: message.payload });
        }
        return 'ok';
    }

    viewerCount(deviceId: string): number
    {
        return this.viewers.get(deviceId)?.size ?? 0;
    }
}

const globalForHub = globalThis as unknown as { liveHub?: LiveHub };
export const liveHub = globalForHub.liveHub ?? new LiveHub();
globalForHub.liveHub = liveHub;
```
Run hub tests → PASS (5).

- [ ] **Step 3: SSE events route**

`src/app/api/live/events/route.ts`:
```ts
import { currentUserOrNull } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { liveHub, type PeerSink } from '@/lib/live/hub';
import type { HubEvent } from '@/lib/live/protocol';

export const dynamic = 'force-dynamic';

const KEEPALIVE_MS = 15_000;

export async function GET(request: Request): Promise<Response>
{
    const user = await currentUserOrNull();
    if (!user)
    {
        return new Response('Unauthorized', { status: 401 });
    }
    const url = new URL(request.url);
    const role = url.searchParams.get('role');
    const deviceId = url.searchParams.get('device') ?? '';
    if ((role !== 'device' && role !== 'viewer') || !deviceId)
    {
        return new Response('Bad request', { status: 400 });
    }

    const device = await prisma.liveDevice.findUnique({ where: { id: deviceId }, select: { ownerId: true, camera: { select: { id: true } } } });
    if (!device || (role === 'device' && device.ownerId !== user.id) || (role === 'viewer' && !device.camera))
    {
        return new Response('Not found', { status: 404 });
    }

    const encoder = new TextEncoder();
    let peerId: string | null = null;
    let keepalive: ReturnType<typeof setInterval> | undefined;

    const stream = new ReadableStream<Uint8Array>({
        start(controller)
        {
            let open = true;
            const sink: PeerSink = {
                send(event: HubEvent)
                {
                    if (open)
                    {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                    }
                },
                close()
                {
                    if (open)
                    {
                        open = false;
                        clearInterval(keepalive);
                        controller.close();
                    }
                },
            };
            keepalive = setInterval(() => open && controller.enqueue(encoder.encode(': keepalive\n\n')), KEEPALIVE_MS);
            peerId = role === 'device' ? liveHub.connectDevice(deviceId, user.id, sink) : liveHub.connectViewer(deviceId, user.id, sink);
            request.signal.addEventListener('abort', () =>
            {
                if (peerId)
                {
                    liveHub.disconnect(peerId);
                }
                sink.close();
            });
        },
        cancel()
        {
            clearInterval(keepalive);
            if (peerId)
            {
                liveHub.disconnect(peerId);
            }
        },
    });

    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}
```

- [ ] **Step 4: Signal route (test first)**

`tests/unit/signal-route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const currentUserOrNull = vi.fn();
const relay = vi.fn();
vi.mock('@/lib/auth/guard', () => ({ currentUserOrNull }));
vi.mock('@/lib/live/hub', () => ({ liveHub: { relay } }));
const { POST } = await import('@/app/api/live/signal/route');

const post = (body: unknown, raw?: string) => POST(new Request('http://x/api/live/signal', { method: 'POST', body: raw ?? JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
const message = { from: 'p1', deviceId: 'd1', type: 'answer', payload: { sdp: 'y' } };

beforeEach(() =>
{
    currentUserOrNull.mockResolvedValue({ id: 'u1', email: 'a@b.cd', name: 'A', role: 'VIEWER' });
    relay.mockReturnValue('ok');
});

describe('POST /api/live/signal', () =>
{
    it('401 without a user', async () =>
    {
        currentUserOrNull.mockResolvedValue(null);
        expect((await post(message)).status).toBe(401);
    });
    it('relays as the signed-in user', async () =>
    {
        expect((await post(message)).status).toBe(204);
        expect(relay).toHaveBeenCalledWith('u1', message);
    });
    it('400 on invalid messages, 413 on oversized bodies', async () =>
    {
        expect((await post({ ...message, type: 'nope' })).status).toBe(400);
        expect((await post(null, 'x'.repeat(70_000))).status).toBe(413);
    });
    it('maps hub results to 403 and 404', async () =>
    {
        relay.mockReturnValue('forbidden');
        expect((await post(message)).status).toBe(403);
        relay.mockReturnValue('unknown-peer');
        expect((await post(message)).status).toBe(404);
    });
});
```
`src/app/api/live/signal/route.ts`:
```ts
import { currentUserOrNull } from '@/lib/auth/guard';
import { liveHub } from '@/lib/live/hub';
import { MAX_SIGNAL_BYTES, signalSchema } from '@/lib/live/protocol';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response>
{
    const user = await currentUserOrNull();
    if (!user)
    {
        return new Response('Unauthorized', { status: 401 });
    }
    const text = await request.text();
    if (text.length > MAX_SIGNAL_BYTES)
    {
        return new Response('Too large', { status: 413 });
    }
    let json: unknown;
    try
    {
        json = JSON.parse(text);
    }
    catch
    {
        return new Response('Bad request', { status: 400 });
    }
    const parsed = signalSchema.safeParse(json);
    if (!parsed.success)
    {
        return new Response('Bad request', { status: 400 });
    }
    const result = liveHub.relay(user.id, parsed.data);
    return new Response(null, { status: result === 'ok' ? 204 : result === 'forbidden' ? 403 : 404 });
}
```
Run: `npx vitest run tests/unit/hub.test.ts tests/unit/signal-route.test.ts && npx vitest run && npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/web/src/lib/live/protocol.ts dashboard/web/src/lib/live/hub.ts dashboard/web/src/app/api/live/events dashboard/web/src/app/api/live/signal dashboard/web/tests/unit/hub.test.ts dashboard/web/tests/unit/signal-route.test.ts
git commit -m "feat(dashboard): in-memory WebRTC signalling hub with SSE and relay routes"
```

---

### Task 4: Device page `/cam`

**Files:**
- Create: `dashboard/web/src/features/live/signalClient.ts`, `dashboard/web/src/features/live/mediaErrors.ts`, `dashboard/web/src/app/cam/page.tsx`, `dashboard/web/src/app/cam/CamStreamer.tsx`
- Test: `dashboard/web/tests/unit/mediaErrors.test.ts`, `dashboard/web/tests/unit/camStreamer.test.tsx`

**Interfaces:**
- Consumes: `/api/live/devices`, `/api/live/devices/:id/heartbeat`, `/api/live/events?role=device`, `/api/live/signal`, `HubEvent`.
- Produces:
  ```ts
  // signalClient.ts
  export interface SignalClient { peerId: Promise<string>; send(message: Omit<SignalMessage, 'from' | 'deviceId'>): Promise<void>; close(): void }
  export function openSignalClient(role: 'device' | 'viewer', deviceId: string, onEvent: (event: HubEvent) => void): SignalClient;
  // mediaErrors.ts
  export function describeMediaError(error: unknown, secureContext: boolean): string;
  ```

- [ ] **Step 1: Failing `describeMediaError` tests**

`tests/unit/mediaErrors.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { describeMediaError } from '@/features/live/mediaErrors';

const domError = (name: string) => Object.assign(new Error(name), { name });

describe('describeMediaError', () =>
{
    it('explains insecure contexts first', () =>
    {
        expect(describeMediaError(domError('NotAllowedError'), false)).toMatch(/https/i);
    });
    it('maps common getUserMedia errors to plain language', () =>
    {
        expect(describeMediaError(domError('NotAllowedError'), true)).toMatch(/permission/i);
        expect(describeMediaError(domError('NotFoundError'), true)).toMatch(/no camera/i);
        expect(describeMediaError(domError('NotReadableError'), true)).toMatch(/in use/i);
        expect(describeMediaError(domError('OverconstrainedError'), true)).toMatch(/resolution|camera/i);
        expect(describeMediaError('weird', true)).toMatch(/could not start/i);
    });
});
```

- [ ] **Step 2: Implement `mediaErrors.ts` and `signalClient.ts`**

```ts
// mediaErrors.ts
export function describeMediaError(error: unknown, secureContext: boolean): string
{
    if (!secureContext)
    {
        return 'Camera access needs a secure page. Open this link with https:// (scan the QR code on the dashboard).';
    }
    const name = (error as { name?: string })?.name;
    switch (name)
    {
        case 'NotAllowedError':
        case 'SecurityError':
            return 'Camera permission was denied. Allow camera access for this site in the browser settings and try again.';
        case 'NotFoundError':
            return 'No camera was found on this device.';
        case 'NotReadableError':
            return 'The camera is in use by another app. Close it and try again.';
        case 'OverconstrainedError':
            return 'This camera does not support the requested resolution. Try the other camera.';
        default:
            return 'The camera could not start. Reload the page and try again.';
    }
}
```
```ts
// signalClient.ts
'use client';

import type { HubEvent, SignalMessage } from '@/lib/live/protocol';

export interface SignalClient
{
    peerId: Promise<string>;
    send(message: Omit<SignalMessage, 'from' | 'deviceId'>): Promise<void>;
    close(): void;
}

// One SSE stream in, POSTs out. The first event is `hello` with this peer's id.
export function openSignalClient(role: 'device' | 'viewer', deviceId: string, onEvent: (event: HubEvent) => void): SignalClient
{
    const source = new EventSource(`/api/live/events?role=${role}&device=${encodeURIComponent(deviceId)}`);
    let resolvePeer: (id: string) => void = () => undefined;
    const peerId = new Promise<string>(resolve => { resolvePeer = resolve; });

    source.onmessage = message =>
    {
        const event = JSON.parse(message.data) as HubEvent;
        if (event.type === 'hello')
        {
            resolvePeer(event.peerId);
        }
        onEvent(event);
    };

    return {
        peerId,
        async send(message)
        {
            const from = await peerId;
            await fetch('/api/live/signal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...message, from, deviceId }) });
        },
        close()
        {
            source.close();
        },
    };
}
```

- [ ] **Step 3: Device page**

`src/app/cam/page.tsx` (server component; requires login, no map chrome):
```tsx
import { requireCurrentUser } from '@/lib/auth/guard';
import { CamStreamer } from './CamStreamer';

export const dynamic = 'force-dynamic';

export default async function CamPage()
{
    const user = await requireCurrentUser();
    return <CamStreamer userName={user.name} />;
}
```
`src/app/cam/CamStreamer.tsx` — client component. Behaviour (implement exactly):
- State: `name` (from `localStorage['nesttrace.cam.name']`, guarded with try/catch, default `''`), `facing: 'environment' | 'user'` (default `environment`), `status: 'idle' | 'starting' | 'live' | 'error'`, `error: string | null`, `viewers: number`, `deviceId: string | null`.
- **Start**: `status='starting'`; `getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })`; on failure set `error = describeMediaError(e, window.isSecureContext)` and `status='error'`. On success: show the stream in a local muted `<video>` preview; `POST /api/live/devices { name }` → `deviceId`; save name to localStorage; start heartbeat `POST /api/live/devices/:id/heartbeat` every 5000 ms; request `navigator.wakeLock?.request('screen')` (ignore failures); open `openSignalClient('device', deviceId, onEvent)`; `status='live'`.
- **onEvent**:
  - `join {from}` → create `RTCPeerConnection({ iceServers: [] })` for that viewer, `addTrack` every stream track, `onicecandidate` → `client.send({ to: from, type: 'ice', payload: candidate.toJSON() })`, `createOffer` → `setLocalDescription` → `client.send({ to: from, type: 'offer', payload: pc.localDescription })`; store in `Map<viewerPeerId, RTCPeerConnection>`; `viewers = map.size`.
  - `answer {from,payload}` → `map.get(from)?.setRemoteDescription(payload)`.
  - `ice {from,payload}` → `map.get(from)?.addIceCandidate(payload)` (ignore errors).
  - `leave {from}` → close and delete that pc; update `viewers`.
- **Stop** (button, and on unmount/`pagehide`): close all pcs, stop tracks, close signal client, clear heartbeat, release wake lock, `status='idle'`.
- **Flip camera** button while live: stop tracks, getUserMedia with the other `facingMode`, `replaceTrack` on every pc's video sender, update preview.
- UI (Night Watch style, phone-first, full height): title "NestTrace camera", signed-in name, device-name input + Front/Rear segmented control (disabled while live), big amber **Start streaming** button; while live: preview video filling width, red pill "● LIVE", "N viewer(s)", **Flip** and **Stop** buttons, and a hint "Keep this page open. Ask an admin to assign 'Name' to a camera." Errors in a red callout with the message.

Test `tests/unit/camStreamer.test.tsx` (jsdom; stub `navigator.mediaDevices.getUserMedia` rejecting with `NotAllowedError`, `window.isSecureContext = true`, stub `fetch`): clicking **Start streaming** shows the permission message; with `isSecureContext = false` it shows the https message. (WebRTC paths are verified in Task 6 with real Chrome.)

- [ ] **Step 4: Run, commit**

Run: `npx vitest run && npx tsc --noEmit && npx next build`
```bash
git add dashboard/web/src/features/live/signalClient.ts dashboard/web/src/features/live/mediaErrors.ts dashboard/web/src/app/cam dashboard/web/tests/unit/mediaErrors.test.ts dashboard/web/tests/unit/camStreamer.test.tsx
git commit -m "feat(dashboard): /cam device page streams a phone or laptop camera over WebRTC"
```

---

### Task 5: Viewer player, Source dropdown, Connect-device dialog, feed selection

**Files:**
- Create: `dashboard/web/src/features/live/LiveVideo.tsx`, `dashboard/web/src/features/live/useLiveStatus.ts`, `dashboard/web/src/features/live/ConnectDeviceDialog.tsx`, `dashboard/web/src/features/cameras/feed.ts`
- Modify: `dashboard/web/src/features/cameras/CameraPanel.tsx`, `dashboard/web/src/features/map/MapScreen.tsx`, `dashboard/web/src/features/shell/TopBar.tsx`, `dashboard/web/package.json` (`qrcode` 1.5.4, `@types/qrcode` 1.5.6 dev)
- Test: `dashboard/web/tests/unit/feed.test.ts`, `dashboard/web/tests/unit/cameraPanel.test.tsx`, extend `dashboard/web/tests/unit/mapScreen.test.tsx`

**Interfaces:**
- Consumes: `/api/live/status`, `/api/live/devices`, `assignCameraSource`, `openSignalClient`, `CameraView.liveDeviceId`, `FeedVideo`.
- Produces:
  ```ts
  // useLiveStatus.ts
  export type LiveStatus = Record<string, { deviceId: string; name: string; online: boolean }>; // by camera code
  export function useLiveStatus(intervalMs?: number): LiveStatus;   // polls /api/live/status, default 5000
  // feed.ts
  export type Feed =
    | { kind: 'live'; deviceId: string; deviceName: string }
    | { kind: 'sim'; video: FeedVideo; deviceOffline: string | null }   // deviceOffline = assigned device name when it is offline
    | { kind: 'none'; reason: 'offline' | 'no-footage' };
  export function feedFor(camera: CameraView, live: LiveStatus): Feed;
  export function feedKey(feed: Feed): string;   // 'live:<deviceId>' | 'sim:<videoId>' | 'none'
  // LiveVideo.tsx
  export function LiveVideo(props: { deviceId: string }): JSX.Element; // states: connecting | live | full | offline
  ```

- [ ] **Step 1: Failing `feedFor` tests**

`tests/unit/feed.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { feedFor, feedKey } from '@/features/cameras/feed';
import type { CameraView } from '@/lib/types';

const camera = (over: Partial<CameraView> = {}): CameraView => ({
    id: 'c1', code: 'B1', zoneCode: 'B', position: [0, 0], headingDeg: 0, fovDeg: 44, rangeM: 300, status: 'ONLINE', calibrated: false,
    video: { id: 'v1', source: 'SIMULATION', durationS: 40, hasMotion: true, simRunId: 'R' }, liveDeviceId: null, ...over,
});

describe('feedFor', () =>
{
    it('prefers an online assigned device', () =>
    {
        const feed = feedFor(camera({ liveDeviceId: 'd1' }), { B1: { deviceId: 'd1', name: 'Pixel', online: true } });
        expect(feed).toEqual({ kind: 'live', deviceId: 'd1', deviceName: 'Pixel' });
        expect(feedKey(feed)).toBe('live:d1');
    });
    it('falls back to the loop and names the offline device', () =>
    {
        const feed = feedFor(camera({ liveDeviceId: 'd1' }), { B1: { deviceId: 'd1', name: 'Pixel', online: false } });
        expect(feed).toMatchObject({ kind: 'sim', deviceOffline: 'Pixel' });
        expect(feedKey(feed)).toBe('sim:v1');
    });
    it('plain simulation, offline camera, no footage', () =>
    {
        expect(feedFor(camera(), {})).toMatchObject({ kind: 'sim', deviceOffline: null });
        expect(feedFor(camera({ status: 'OFFLINE' }), {})).toEqual({ kind: 'none', reason: 'offline' });
        expect(feedFor(camera({ video: null }), {})).toEqual({ kind: 'none', reason: 'no-footage' });
    });
    it('an offline camera stays offline even with a device', () =>
    {
        expect(feedFor(camera({ status: 'OFFLINE', liveDeviceId: 'd1' }), { B1: { deviceId: 'd1', name: 'P', online: true } })).toEqual({ kind: 'none', reason: 'offline' });
    });
});
```
Implement `feed.ts`:
```ts
import type { CameraView, FeedVideo } from '@/lib/types';
import type { LiveStatus } from '@/features/live/useLiveStatus';

export type Feed =
    | { kind: 'live'; deviceId: string; deviceName: string }
    | { kind: 'sim'; video: FeedVideo; deviceOffline: string | null }
    | { kind: 'none'; reason: 'offline' | 'no-footage' };

export function feedFor(camera: CameraView, live: LiveStatus): Feed
{
    if (camera.status !== 'ONLINE')
    {
        return { kind: 'none', reason: 'offline' };
    }
    const device = live[camera.code];
    if (device && device.online)
    {
        return { kind: 'live', deviceId: device.deviceId, deviceName: device.name };
    }
    if (camera.video)
    {
        return { kind: 'sim', video: camera.video, deviceOffline: device ? device.name : null };
    }
    return { kind: 'none', reason: 'no-footage' };
}

export function feedKey(feed: Feed): string
{
    return feed.kind === 'live' ? `live:${feed.deviceId}` : feed.kind === 'sim' ? `sim:${feed.video.id}` : 'none';
}
```
`useLiveStatus.ts`: client hook; `fetch('/api/live/status')` on mount and every `intervalMs` (default 5000), keep the last good result on errors, clear the interval on unmount. Return `LiveStatus`.

- [ ] **Step 2: `LiveVideo`**

Client component. On mount: `state='connecting'`; `openSignalClient('viewer', deviceId, onEvent)`:
- `offer {from,payload}` → create `RTCPeerConnection({ iceServers: [] })` (once), `ontrack` → set `video.srcObject = event.streams[0]`, `state='live'`; `onicecandidate` → `send({ type: 'ice', payload })`; `setRemoteDescription(payload)` → `createAnswer` → `setLocalDescription` → `send({ type: 'answer', payload: pc.localDescription })`.
- `ice` → `addIceCandidate` (ignore errors). `full` → `state='full'`. `device-offline` or `leave` → `state='offline'`, close pc.
- Unmount: `send({ type: 'leave' })` best-effort, close pc and client.
Markup: same frame classes as `CameraVideo` (`relative mt-2 overflow-hidden rounded-lg border border-white/6 bg-night-950`, `aspect-video` video, `muted autoPlay playsInline`, `data-testid="live-video"`); overlay text for `connecting` ("Connecting to device…"), `full` ("Too many viewers on this device"), `offline` ("Device offline").

- [ ] **Step 3: CameraPanel source switching (tests first)**

`tests/unit/cameraPanel.test.tsx` (mock `@/features/live/LiveVideo` to render `<div>live {deviceId}</div>`, mock `@/app/(app)/live-actions`):
- live feed → renders "live d1", a header badge "LIVE · Pixel", no SIMULATED badge, no Raw/Motion;
- sim feed with `deviceOffline: 'Pixel'` → renders the loop and a notice "Pixel offline · showing simulation";
- admin sees a **Source** `<select>` listing "Simulation loop" + online devices from `devices` prop (each "Name" or "Name (on C1)" disabled when used by another camera); choosing a device calls `assignCameraSource('B1', 'd1')`; viewer sees no select;
- an `{ ok: false, error }` result is shown inline.

Change `CameraPanel` props to `{ camera, feed, isAdmin, devices, onClose, onTime, seekTo }` where `feed: Feed`, `devices: LiveDeviceView[]`. Render:
- `feed.kind === 'live'` → `<LiveVideo key={feed.deviceId} deviceId={feed.deviceId} />` and header pill `LIVE · {deviceName}` (`bg-danger/15 text-danger ring-1 ring-danger/40`, pulsing dot);
- `feed.kind === 'sim'` → existing `<CameraVideo key={feed.video.id} … />`, plus the offline-device notice when `deviceOffline`;
- `feed.kind === 'none'` → existing placeholder (offline / no footage).
- Admin-only Source row under the stats: `<label>Source <select value={camera.liveDeviceId ?? ''}>` with `<option value="">Simulation loop</option>` and devices; on change `startTransition(async () => setError((await assignCameraSource(camera.code, value || null)).ok ? null : …))`.
- The bottom note: live → "Live from {deviceName} · not analysed"; sim → existing simulated note; otherwise existing calibrate note.

- [ ] **Step 4: MapScreen and TopBar wiring**

`MapScreen`:
- `const live = useLiveStatus();` and fetch devices for admins: `useEffect` polling `GET /api/live/devices` every 5 s when `user.role === 'ADMIN'` → `devices` state.
- `const selectedFeed = selectedCamera ? feedFor(selectedCamera, live) : null;`
- Replace `selectedVideo` with `selectedFeed?.kind === 'sim' ? selectedFeed.video : null` everywhere (clock, seek, `selectCamera`, `flyToAlert`).
- Reset playback when the feed key changes: `useEffect(() => { setPlayback(v => …) }, [selectedFeed && feedKey(selectedFeed)])` — when the key changes to `live:*` or `none`, `setPlayback(null)` (live feeds publish no clock; the map shows all positioned pins); to `sim:*`, gated `{ key: playbackKey(video), t: -Infinity }`.
- Pass `feed`, `isAdmin`, `devices` to `CameraPanel`.

`TopBar`: admins get a **Connect device** button (lucide `Smartphone` icon) before Setup that opens `ConnectDeviceDialog`.

`ConnectDeviceDialog`: client modal (Night Watch glass panel, Escape and backdrop click close, focus moved into dialog). Gets `lanUrl` from `process.env.NEXT_PUBLIC_CAM_URL` if set, else builds `https://${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '<LAN_HOST>' : window.location.hostname}:3443/cam` where `<LAN_HOST>` comes from a prop the server page passes (`process.env.LAN_HOST`). Renders the QR code (`QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: '#0A1118', light: '#D7E3EA' } })`) as an `<img alt="QR code for the camera page">`, the URL as selectable mono text with a Copy button, and three short steps: "1 Join the same Wi-Fi · 2 Scan, then tap Advanced → Proceed on the certificate warning · 3 Sign in and tap Start streaming".
Pass `lanHost={process.env.LAN_HOST ?? null}` from `src/app/(app)/page.tsx` → `MapScreen` → `TopBar`.

Extend `tests/unit/mapScreen.test.tsx`: mock `@/features/live/useLiveStatus` to return `{ B1: { deviceId: 'd1', name: 'Pixel', online: true } }` and `@/features/live/LiveVideo`; selecting B1 (with `liveDeviceId: 'd1'`) renders the live player and the map receives `playback={null}`.

- [ ] **Step 5: Run, commit**

Run: `npm install qrcode@1.5.4 && npm install -D @types/qrcode@1.5.6 && npx vitest run && npx tsc --noEmit && npx next build`
```bash
git add dashboard/web/package.json dashboard/web/package-lock.json dashboard/web/src/features dashboard/web/src/app/\(app\)/page.tsx dashboard/web/tests/unit
git commit -m "feat(dashboard): live device feeds on cameras with source selection and QR connect dialog"
```

---

### Task 6: End-to-end with fake media, real phone check, docs

**Files:**
- Modify: `dashboard/README.md`, `CLAUDE.md`, `agent.md`
- Create (scratchpad, not committed): Playwright script

- [ ] **Step 1: Rebuild and set LAN_HOST**

```bash
cd dashboard
grep -q '^LAN_HOST=' .env || echo "LAN_HOST=$(ipconfig getifaddr en0)" >> .env
docker compose up -d --build
```

- [ ] **Step 2: Two-browser WebRTC check (scratchpad script)**

Playwright with system Chrome: `chromium.launch({ channel: 'chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })`, two contexts with `ignoreHTTPSErrors: true`, base `https://localhost:3443`:
1. Context D (device): log in as the viewer account (`viewer@nesttrace.local`, password from `SEED_VIEWER_PASSWORD`), open `/cam`, name "Test cam", **Start streaming** → "LIVE" shown.
2. Context A (admin): log in as admin, open `/`, click camera B1, choose "Test cam" in **Source**; assert header shows `LIVE · Test cam`; wait for `[data-testid=live-video]` with `videoWidth > 0` and `currentTime` advancing over 2 s.
3. In D, assert "1 viewer".
4. Context V2/V3/V4/V5 (four more admin pages viewing B1) → the fifth viewer page shows "Too many viewers on this device".
5. Close context D → within 20 s, A's B1 shows "Test cam offline · showing simulation" and the loop plays.
6. As viewer account in a fresh context, assert the Source select is absent and `assignCameraSource` cannot be triggered (no select).
7. Reset: admin sets B1 Source back to "Simulation loop".
Screenshots of steps 2, 4, 5 and the Connect-device dialog → `<scratchpad>/plan-b/`. LOOK at each.

- [ ] **Step 3: Real phone (manual, report result)**

Open the Connect-device dialog on the laptop, scan with the Android phone on the same Wi-Fi, accept the certificate warning, sign in, Start streaming, assign it to a camera from the laptop, confirm live video. Record the outcome (or the exact failure) in the report. If no phone is available to the agent, write "pending user check" — the controller will ask the user.

- [ ] **Step 4: Docs**

`dashboard/README.md` — add:
```markdown
## Phones and laptops as live cameras

1. Find your laptop's LAN IP (`ipconfig getifaddr en0` on macOS) and set `LAN_HOST=<that IP>` in `dashboard/.env`, then `docker compose up -d --build`.
2. On the dashboard (admin), click **Connect device** and scan the QR code with the phone (same Wi-Fi). The page is served by Caddy on `https://<LAN_HOST>:3443` with a self-signed certificate: tap **Advanced → Proceed** once.
3. Sign in on the phone, choose the rear camera, tap **Start streaming**, and keep the page open.
4. On the dashboard, select a camera and pick the device under **Source**. The camera shows **LIVE**; if the phone stops, it falls back to the simulation loop.

Only port 3443 is open to the network and every page there needs a login; the app (3000) and Postgres (5433) stay on this machine. Video goes directly between browsers over Wi-Fi and is not recorded or analysed. Up to four viewers per device.
```
`CLAUDE.md` — dashboard line: append "Live cameras: set `LAN_HOST`, phones open `https://<LAN_HOST>:3443/cam` (Caddy service); signalling hub is in-memory in `src/lib/live/hub.ts` (single web process)."
`agent.md` — in "Real dashboard": add "Live device feeds (`/cam`, WebRTC over the LAN through the Caddy service on port 3443) are view-only and never feed the research pipeline."

- [ ] **Step 5: Verify and commit**

Run: root `npm test`; `cd dashboard/web && npm run db:test:prepare && npx vitest run && npx tsc --noEmit`.
```bash
git add dashboard/README.md CLAUDE.md agent.md
git commit -m "docs(dashboard): phones and laptops as live cameras"
```

---

## Self-review notes

- Spec §3.1 → Task 4; §3.2 → Tasks 2 (model, assignment, audit, DB role) + 5 (dropdown, LIVE badge, fallback, Connect dialog); §3.3 → Task 3 (hub, SSE, relay, caps, auth) + Task 4/5 (peer connections); §3.4 → Task 1 (Caddy, loopback ports, Secure cookies, LAN_HOST); §4 Part B tests → Tasks 2–6.
- Carry-over from Plan 1/A: DB-backed `requireCurrentUser` for mutations and route handlers (Task 2); playback resets on feed key, not video id (Task 5); LIVE badge in the header, SIMULATED stays on the video (Task 5).
- Spec deviation: viewers address the device implicitly (the hub resolves the device peer), so `to` is optional for viewer→device messages; device→viewer messages must name `to`. Same security property: relay only within one device's peers.
- Types consistent across tasks: `LiveDeviceView`, `CameraView.liveDeviceId`, `LiveStatus`, `Feed`, `feedFor`, `feedKey`, `HubEvent`, `SignalMessage`, `LiveHub`, `liveHub`, `openSignalClient`, `describeMediaError`, `assignCameraSource`, `requireCurrentUser`, `currentUserOrNull`, `isHttpsRequest`.
