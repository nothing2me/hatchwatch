# NestTrace Dashboard — Plan G: People and Possible-Turtle Detection on Live Cameras — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Live phone and ESP32 tiles show **person** boxes (YOLOX-nano), **possible turtle** boxes (a rule, never "turtle"), track ids (`P3`, `T1`) and fading trails. A **Detections** toggle per viewer and a "People 1 · Possible turtles 0" line go with them. When a person track is seen for 2 s on a phone or board that is linked to a map camera, and that camera's zone has an active unprotected nest site, the dashboard raises one camera-level level-1 DANGER alert, labelled "Camera alert · person detected (not measured distance)".

**Architecture:** A new Python service `dashboard/worker` runs beside `web` on an internal-only Compose network. Every 500 ms it asks `web` for online devices (`GET /api/internal/devices`). For each device whose newest frame changed, it fetches the frame (`GET /api/internal/frame/<id>`), at most 2 frames/s per device, round-robin. It runs YOLOX-nano through OpenCV DNN for people and a MOG2 background-subtraction rule for possible turtles, then tracks them (IoU ≥ 0.3, Hungarian, same label) and posts `{ at, dark, width, height, objects, trails }` (`POST /api/internal/detections/<id>`). The three routes take only `Authorization: Bearer ${WORKER_TOKEN}` (constant time, refused when unset), and Caddy answers `/api/internal/*` with 404. `web` keeps the newest detections beside the newest frame in the in-memory `FrameStore` (same lifetime), returns them as `detections` on `GET /api/live/devices`, and draws them as an SVG overlay on `/live` tiles, the expanded view and the map camera panel. After storing a result, `web` checks the camera-level danger rule in one transaction (camera row lock) and creates or appends to a `DANGER` alert with `siteId` null and `videoId` null. A migration makes `Alert.videoId` nullable for exactly this kind.

**Tech Stack:** Worker: Python 3.12 (`python:3.12.15-slim-bookworm`), `opencv-python-headless==5.0.0.93` (same pin as the repo root), `numpy==2.2.6`, `httpx==0.28.1`, `pytest==9.1.1`, YOLOX-nano ONNX `0.1.1rc0`. Web: Next.js 16.4.0 App Router, React 19.3.0, TypeScript, Prisma 7.10.0 + Postgres 16, zod 4.6.5, Vitest 5.0.3, `node:crypto` (`createHash`, `timingSafeEqual`). Caddy 2. Playwright from the repo-root `node_modules/playwright` for the end-to-end check. No new npm packages, and no scipy (the Hungarian step is 50 lines of numpy).

**Spec:** `docs/superpowers/specs/2026-10-10-live-detection-design.md` (binding). Boundaries: `agent.md`, `CLAUDE.md`. Builds on Plan E (`docs/superpowers/plans/2026-10-10-plan-e-live-phone-cameras.md`) and Plan F (`docs/superpowers/plans/2026-10-10-plan-f-esp32-devices.md`) on `feat/dashboard-fullstack`.

**Model (verified for this plan):** `https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx`, 3,659,407 bytes, SHA-256 `c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d`. Loaded with `cv2.dnn.readNetFromONNX` (OpenCV 5.0.0): one output `output`, input blob `(1, 3, 416, 416)` float32 BGR 0–255, output shape **`(1, 3549, 85)`** = 52² + 26² + 13² anchors (strides 8/16/32) × (dx, dy, log w, log h, objectness, 80 class scores). Objectness and class scores are already sigmoid outputs (0–1); boxes need the grid decode `(d + cell) × stride`, `exp(log) × stride`. On the 320×240 fixture the decode below finds one person at (194, 104, 31, 86), score 0.85. The worker code in Tasks 2–4 was run against this file before the plan was written: 34 tests pass on the host (Python 3.12.12) and in the built image, CPU inference about 13 ms per frame. The web server code and tests of Tasks 1 and 5 (token, schema, store, handlers, migration, danger rule, snapshot and import changes) were also applied in a throwaway worktree: `tsc` is clean and the whole Vitest suite passes (420 tests, integration included). The UI parts of Tasks 5–6 are specified as behaviour lists with DOM tests.

## Global Constraints

- **Person (spec §3):** YOLOX-nano **score ≥ 0.40** (objectness × person class), **NMS IoU 0.45**, box at least **1% of the picture**. Label `person` with its score. Only COCO class 0 is used. Pre-processing exactly as the official ONNX demo: letterbox into **416×416**, scale `min(416/h, 416/w)`, pad bottom/right with **114**, **BGR**, **no normalisation**.
- **Possible turtle (spec §3):** from the worker's own **MOG2** per device (`detectShadows=True`; shadow pixels 127 are ignored). A moving blob is a possible turtle only when **all** of these hold:
  - **IoU < 0.1** with every person box,
  - **width/height ≥ 1.3**,
  - **area 0.3%–15%** of the picture,
  - its track moved **< 8% of the picture width per second**, **sustained ≥ 3 s**.
  The label is `possible turtle` with **no score**. The UI says "Possible turtle (rule)". It is never called a turtle.
- **Dark frames:** mean brightness **< 25/255** → person detection is skipped (the rule too, see ambiguity 6). The result carries `dark: true` and the tile says **"Too dark to detect"**.
- **Rate:** the loop runs every **500 ms**. **≤ 2 frames/s per device**. Only a changed frame time is processed. Devices are served **round-robin**: a pass stops after 500 ms and the next one starts after the last device served. CPU only.
- **Tracking (spec §4):** per device and per label, match by **IoU ≥ 0.3**, **Hungarian on 1 − IoU**, same label only. A track **ends after 3 s** unseen. Trails keep **30 s, ≤ 60 points** of box centres `[t, x, y]` (t = frame time, epoch ms; x, y in picture pixels). Ids are short per-device counters: **`P<n>`** for people (on creation) and **`T<n>`** for possible turtles (on first qualifying).
- **Internal API:** `GET /api/internal/devices`, `GET /api/internal/frame/<id>`, `POST /api/internal/detections/<id>`. Only `Authorization: Bearer ${WORKER_TOKEN}` is accepted, compared in **constant time** (`timingSafeEqual` on SHA-256 digests). Every route is **refused (401) when `WORKER_TOKEN` is unset or blank**, and a session cookie never counts. **Caddy answers `/api/internal` and `/api/internal/*` with 404** (verified for case, `%69` and `//` variants). The worker has **no published ports** and sits on an `internal: true` network, so it has no internet at runtime. The model is fetched once at image build.
- **Camera-level danger (spec §6):**
  - **When:** `web` stores a detections result for a device **linked to a map camera**. That result has a `person` object with **score ≥ 0.50** whose track has been seen for **≥ 2 s** (its trail spans ≥ 2000 ms). The camera's zone has **≥ 1 active, unprotected** nest site at that moment.
  - **What:** one `Alert` with `kind: 'DANGER'`, **`level: 1`**, **`siteId: null`**, `videoId: null`, `cameraId`/`zoneId` of the linked camera, and `lng`/`lat` = the camera position. `message` is exactly **`Danger · person seen on camera <code> near active nest sites — check now`**. The log entry has `type: 'danger'`, `author: 'Camera'` and note exactly `Person on camera <code> (track <id>), <n> active unprotected site(s) in zone <zone>`.
  - **How often:** **at most one open** camera-level danger per camera. A new one only after the previous one is **resolved and 10 minutes have passed** (measured from the resolution). Repeat sightings while one is open are **appended** to its log, **at most one entry per minute**.
  - **Isolation:** it is **not counted in outcomes**, never changes a site, and is labelled **"Camera alert · person detected (not measured distance)"**. Devices not linked to a map camera never raise one.
- **UI strings (exact):** box labels `person 0.82` (two decimals) and `possible turtle`. Counts line `People 1 · Possible turtles 0`. Status `Detection off` (no result for 10 s while the device is online) and `Too dark to detect`. Footer `Detection is a viewing aid; it can miss people and mistake objects.` Toggle button **Detections** (`aria-pressed`, localStorage key `nesttrace.detections`, default on).
- **Boundary:** the worker is dashboard code. It never imports or references `pipeline/`, `web/` (the simulator), `scripts/server.mjs`, seeds, `artifacts/` or any `private/` path. Detections are a viewing aid. The only alert they raise is the camera-level danger, and they never change nest sites. Frames and detections stay on the laptop (memory only, never written to disk by the worker, never logged). The digging alert wording stays exactly `Digging activity detected; nesting unresolved.`. Frozen research files (`pipeline/*`, `config/*`, `results/*`, `*RESULTS.md`) are untouched.
- **Secrets:** `WORKER_TOKEN` is generated with `openssl rand -hex 32` into the local, git-ignored `dashboard/.env`. It is never logged (worker logs only status codes and error class names) and never in a response body, page prop or audit row.
- **Commits:** only the user as author; **no `Co-Authored-By` and no AI attribution** in any message. Stage **explicit paths** only. **Never stage** `artifacts/`, `dashboard/media/`, `dashboard/recordings/`, `.superpowers/`, any `.env`, `firmware/**/secrets.h`, `dashboard/worker/.venv/`, or any model file (`dashboard/worker/models/`, `*.onnx`). Run `git status --short` before every commit.
- **Code style:** follow the existing files: Allman braces, 4-space indent, single quotes, `@/` imports, one-line comments only where the reason is not obvious. Python: 4-space indent, single quotes, type hints, module docstrings only where useful.

## Review Focus

1. **The internal routes open for something other than the worker token.** Examples: a session cookie accepted, an unset or blank `WORKER_TOKEN` matching an empty bearer, a `===` comparison, or Caddy forwarding `/api/internal/*` (including `/API/...`, `%69`, `//`). Pinned in **Task 1** `tests/unit/internal-routes.test.ts` (401 matrix, `timingSafeEqual` spy on every call, unset and blank token) and `tests/unit/caddyfile.test.ts`, and in **Task 7** Step 4 (LAN curl matrix returns 404).
2. **The camera danger fires when it should not, or fires twice.** Examples: an unlinked device, no active unprotected site (none, protected, no nest), a track < 2 s or score < 0.50, two concurrent posts creating two alerts, a new alert before resolve + 10 min, more than one log entry a minute, or a message that is not byte-exact. Pinned in **Task 5** `tests/integration/live-detection.test.ts` and `tests/unit/cameraDanger.test.ts` (`qualifyingPerson`).
3. **The camera-level danger leaks into nest-site logic.** Examples: it changes outcomes or a site's status, crashes the snapshot on `video: null`, gets grouped with a site danger, or resolving it resolves a site. Pinned in **Task 5** `tests/integration/live-detection.test.ts` (`outcomes unchanged`, `resolving touches no site`, snapshot shape) and `tests/unit/dangerFeed.test.tsx` (own card, own label).
4. **The detector or rule math is wrong.** Examples: RGB instead of BGR, normalised or centre-padded input, a wrong grid or stride order, scores not multiplied, boxes not mapped back through the ratio, NMS skipped, the 1% rule on unclipped boxes, or a tall, fast, tiny, huge or person-covered blob passing as a possible turtle. Pinned in **Task 3** `dashboard/worker/tests/test_detector.py` (crafted output tensors and the real fixture) and **Task 4** `tests/test_turtle.py` and `tests/test_tracker.py` (Hungarian vs brute force, id stability, 30 s / 60-point cap).
5. **Stale or misdrawn overlays.** Examples: boxes still shown after the worker stopped (no "Detection off"), boxes drawn in CSS pixels instead of picture pixels, the toggle not remembered, or person detection running on a dark frame. Pinned in **Task 1** `tests/unit/frameStore.test.ts` (freshness, `forget`, carried across new frames), **Task 6** `tests/unit/detectionOverlay.test.tsx` and `tests/unit/liveScreen.test.tsx`, **Task 4** `test_dark_frames_detect_nothing`, and **Task 7** Step 3 (worker stopped → "Detection off").

## Spec ambiguities resolved in this plan

1. **`Alert.videoId` becomes nullable.** A camera-level danger has no video, and `videoId` was required. Migration `camera_level_danger` drops `NOT NULL` and adds a CHECK: a row without a video must be a `DANGER` with `siteId` null. `AlertView.videoId` becomes `string | null`, and `alertKey` falls back to `alert:<id>` so a camera alert never matches a playing clip.
2. **"10 minutes"** is counted from the resolution of the previous camera alert. A resolution always comes after the alert was raised, so this also satisfies the reading "10 minutes after it was raised".
3. **"Seen for at least 2 s"** is the span (max t − min t) of that track's trail in the same result, for a `person` object present in that result with score ≥ 0.50.
4. **Repeat sightings** are appended as `danger` entries (author `Camera`) on the open alert, with the current site count in the note, whether or not sites remain. An alert resolved meanwhile is never re-opened, because the alert row is locked and re-checked.
5. **Active unprotected site** means a non-`DANGER` alert in the camera's zone (the dashboard's `isNestSite`) with an open status whose `summarizeSite` gives `active && protection === 'unprotected'`. Simulated sites count: on this dashboard the demo zones only have simulated sites. Every alert and the README say the alert is a camera alert, not a measured distance.
6. **Dark frames** skip both person detection and the turtle rule, and MOG2 is not updated (night detection is out of scope). The result still goes to `web` with `dark: true`, so the tile can say "Too dark to detect".
7. **Result shape:** the spec's `{ at, objects, trails }` gains `dark`, `width` and `height` (for the overlay's viewBox). `at` and trail `t` are the frame time in epoch ms from `web`'s `X-Frame-At`, so the worker and `web` share one clock.
8. **"Detection off"** is shown when the device is online but no result arrived in the last 10 s (`ONLINE_MS`). A stopped worker therefore shows it within about 11 s.
9. **Refresh rate:** detections travel on `GET /api/live/devices` (the spec's channel). `/live` and the camera panel poll it every **1 s while Detections is on** (3 s when off, as now). Boxes can lag the picture by up to about 1.5 s.
10. **Hungarian:** implemented in the worker (Kuhn–Munkres with potentials, O(n³)) and checked against brute force, instead of adding scipy, which the spec does not list.
11. **MOG2 learning rate** is fixed at `1/120`. OpenCV's automatic rate starts at 1/frames-seen, which soaks a slow blob into the background within 4 frames. The prototype measured this before the plan was written.
12. **"Sustained ≥ 3 s"** means the blob kept the shape rule for the last 3 s, and every 1 s span ending in those 3 s moved < 8% of the width per second. Measuring over 1 s keeps box jitter at 2 frames/s from counting as speed.
13. **`T` numbers** are given when a blob first qualifies, so a device shows `T1, T2`, not `T7, T19`. Unqualified blobs have no id and no trail.
14. **Refusals:** every internal-route refusal is **401** (no token, wrong token, unset token), and none says which. Results for unknown, removed or offline devices get **404**, and an older or repeated frame time gets **409**. The worker treats both as "skip".
15. **Fixture:** a public-domain USFWS beach photo (one walking person), resized to 320×240 (the ESP32 picture size), is committed as `dashboard/worker/tests/fixtures/person-beach-320.jpg` with its source and SHA-256 in `README.txt`.
16. **Alert fields with no meaning here:** `radiusM: 0`, `startT: 0`, `endT: 0`, `score: null` (no distance was measured, and scores are not probabilities). The UI never shows them for a camera alert.
17. **Wording in `agent.md`/README:** "never fed to the detector" becomes "never fed to the digging detector". The live detection worker reads the same frames in memory only.

---

## File Structure

```
.gitignore                                              T2  dashboard/worker/.venv/, dashboard/worker/models/
dashboard/
  .env.example                                          T1  WORKER_TOKEN
  Caddyfile                                             T1  @internal → 404
  docker-compose.yml                                    T4  worker service, internal network
  README.md                                             T7  "Live detection" section
  worker/
    Dockerfile, .dockerignore, requirements.txt, pytest.ini          T2
    nesttrace_worker/__init__.py, config.py, api.py, scheduler.py    T2
    nesttrace_worker/detector.py                                     T3
    nesttrace_worker/tracker.py, turtle.py, device.py, main.py       T4
    tests/__init__.py, helpers.py, conftest.py                       T2
    tests/test_api_and_loop.py, test_packaging.py                    T2
    tests/test_detector.py, fixtures/person-beach-320.jpg, fixtures/README.txt   T3
    tests/test_tracker.py, test_turtle.py, test_device.py            T4
    models/yolox_nano.onnx                                           T2  local only, git-ignored, never staged
  web/
    prisma/schema.prisma (+ migration camera_level_danger)           T5  Alert.videoId nullable + CHECK
    src/lib/types.ts                                    T1  DetectionLabel, DetectedObject, DetectionTrail, DetectionsView, LiveDeviceView.detections; T5 AlertView.videoId nullable
    src/lib/phones/frameStore.ts                        T1  detections beside the newest frame
    src/lib/phones/devices.ts                           T1  listDevices → detections
    src/lib/detections/workerToken.ts                   T1  workerAuthorized
    src/lib/detections/schema.ts                        T1  parseDetections (zod)
    src/lib/detections/http.ts                          T1  getInternalDevices, getInternalFrame, postInternalDetections; T5 danger hook
    src/app/api/internal/devices/route.ts               T1
    src/app/api/internal/frame/[deviceId]/route.ts      T1
    src/app/api/internal/detections/[deviceId]/route.ts T1
    src/lib/detections/cameraDanger.ts                  T5  qualifyingPerson, raiseCameraDanger
    src/lib/danger.ts                                   T5  isCameraDanger, CAMERA_DANGER_LABEL
    src/server/snapshot.ts                              T5  video may be null
    src/features/map/playback.ts                        T5  alertKey null-safe
    src/features/alerts/DangerCards.tsx, AlertsFeed.tsx T5  CameraDangerCard
    src/features/sites/SiteDrawer.tsx                   T5  camera alert block
    src/features/map/MapView.tsx                        T5  camera alert pin label
    src/features/phones/DetectionOverlay.tsx            T6  overlay, counts, status, note
    src/features/phones/useDetectionsToggle.ts          T6
    src/features/phones/useDeviceDetections.ts          T6
    src/features/phones/LiveScreen.tsx                  T6  toggle, overlay on tile and expanded view
    src/features/cameras/CameraPanel.tsx                T6  overlay on the live picture
    tests/boundary.test.ts                              T1  skip .venv, models, __pycache__, .pytest_cache
    tests/unit/internal-routes.test.ts, caddyfile.test.ts, detectionsSchema.test.ts   T1
    tests/unit/frameStore.test.ts                       T1  detections cases
    tests/integration/live-phones.test.ts               T1  devices API detections
    tests/unit/liveScreen.test.tsx, sourceSelect.test.tsx   T1 fixtures (detections: null); T6 overlay
    tests/unit/cameraDanger.test.ts                     T5
    tests/integration/live-detection.test.ts            T5
    tests/unit/snapshot.test.ts, playback.test.ts, dangerFeed.test.tsx, siteDrawer.test.tsx   T5
    tests/unit/detectionOverlay.test.tsx, cameraPanelLive.test.tsx   T6
CLAUDE.md, agent.md                                     T7  one paragraph / one sentence
```

---

### Task 1: Internal API, worker token, Caddy block, detections in the frame store and the devices API

**Files:**
- Create: `dashboard/web/src/lib/detections/workerToken.ts`, `dashboard/web/src/lib/detections/schema.ts`, `dashboard/web/src/lib/detections/http.ts`, `dashboard/web/src/app/api/internal/devices/route.ts`, `dashboard/web/src/app/api/internal/frame/[deviceId]/route.ts`, `dashboard/web/src/app/api/internal/detections/[deviceId]/route.ts`, `dashboard/web/tests/unit/internal-routes.test.ts`, `dashboard/web/tests/unit/caddyfile.test.ts`, `dashboard/web/tests/unit/detectionsSchema.test.ts`
- Modify: `dashboard/web/src/lib/types.ts`, `dashboard/web/src/lib/phones/frameStore.ts`, `dashboard/web/src/lib/phones/devices.ts`, `dashboard/Caddyfile`, `dashboard/.env.example`, `dashboard/web/tests/boundary.test.ts`, `dashboard/web/tests/unit/frameStore.test.ts`, `dashboard/web/tests/integration/live-phones.test.ts`, `dashboard/web/tests/unit/liveScreen.test.tsx`, `dashboard/web/tests/unit/sourceSelect.test.tsx`

**Interfaces:**
- Consumes: `FrameStore.put/latest/onlineIds/lastFrameAt/forget`, `ONLINE_MS`, `readCapped` (`src/lib/phones/body.ts`), `bearerToken` (`src/lib/phones/deviceToken.ts`), `listDevices` (Plan E/F).
- Produces:
  - `types.ts`: `type DetectionLabel = 'person' | 'possible turtle'`; `type PixelBox = [number, number, number, number]`; `interface DetectedObject { track: string; label: DetectionLabel; score?: number; box: PixelBox }`; `interface DetectionTrail { track: string; label: DetectionLabel; points: [number, number, number][] }`; `interface DetectionsView { at: number; dark: boolean; width: number; height: number; objects: DetectedObject[]; trails: DetectionTrail[] }`; `LiveDeviceView.detections: DetectionsView | null`.
  - `frameStore.ts`: `DETECTIONS_FRESH_MS = ONLINE_MS`; `putDetections(deviceId, detections, now?): 'stored' | 'stale' | 'offline'`; `detections(deviceId, now?): DetectionsView | null`. `put()` keeps the stored detections.
  - `workerToken.ts`: `workerAuthorized(headers: Headers, expected?: string): boolean`.
  - `schema.ts`: `MAX_DETECTION_BYTES = 256 * 1024`, `MAX_OBJECTS = 50`, `MAX_TRAILS = 50`, `MAX_TRAIL_POINTS = 60`, `detectionsSchema`, `parseDetections(value: unknown): DetectionsView | null`.
  - `http.ts`: `interface InternalDeps { prisma: PrismaClient; store: FrameStore; token?: string; now?: () => number }`; `WORKER_REFUSED = 'Worker token not accepted.'`; `getInternalDevices(deps, request): Response`; `getInternalFrame(deps, deviceId, request): Response`; `postInternalDetections(deps, deviceId, request): Promise<Response>`.

- [ ] **Step 1: Failing unit tests**

`tests/unit/detectionsSchema.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { MAX_TRAIL_POINTS, parseDetections } from '@/lib/detections/schema';

const valid = {
    at: 1_760_000_000_000, dark: false, width: 320, height: 240,
    objects: [
        { track: 'P1', label: 'person', score: 0.82, box: [194, 104, 31, 86] },
        { track: 'T1', label: 'possible turtle', box: [40.5, 120, 48, 24] },
    ],
    trails: [
        { track: 'P1', label: 'person', points: [[1_759_999_998_000, 209.5, 147], [1_760_000_000_000, 210, 147]] },
        { track: 'T1', label: 'possible turtle', points: [[1_760_000_000_000, 64.5, 132]] },
    ],
};

describe('detections payload', () =>
{
    it('accepts the worker format', () =>
    {
        expect(parseDetections(valid)).toEqual(valid);
        expect(parseDetections({ ...valid, dark: true, objects: [], trails: [] })?.dark).toBe(true);
    });

    it('refuses anything else', () =>
    {
        const bad: unknown[] = [
            null, 'x', { ...valid, extra: 1 },
            { ...valid, at: -1 }, { ...valid, at: 1.5 }, { ...valid, width: 0 },
            { ...valid, objects: [{ ...valid.objects[0], score: 1.2 }] },
            { ...valid, objects: [{ ...valid.objects[0], score: undefined }] },
            { ...valid, objects: [{ ...valid.objects[1], score: 0.5 }] },
            { ...valid, objects: [{ ...valid.objects[0], label: 'turtle' }] },
            { ...valid, objects: [{ ...valid.objects[0], track: 'T2' }] },
            { ...valid, objects: [{ ...valid.objects[1], track: 'P2' }] },
            { ...valid, objects: [{ ...valid.objects[0], track: 'P0' }] },
            { ...valid, objects: [{ ...valid.objects[0], box: [1, 2, 3] }] },
            { ...valid, objects: [{ ...valid.objects[0], box: [-1, 2, 3, 4] }] },
            { ...valid, objects: Array.from({ length: 51 }, (_, i) => ({ ...valid.objects[0], track: `P${i + 1}` })) },
            { ...valid, trails: [{ ...valid.trails[0], points: [] }] },
            { ...valid, trails: [{ ...valid.trails[0], points: Array.from({ length: MAX_TRAIL_POINTS + 1 }, (_, i) => [i, 1, 1]) }] },
            { ...valid, trails: [{ ...valid.trails[0], label: 'possible turtle' }] },
        ];
        for (const value of bad)
        {
            expect(parseDetections(value), JSON.stringify(value)?.slice(0, 120)).toBeNull();
        }
    });
});
```

`tests/unit/internal-routes.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';

vi.mock('node:crypto', async importOriginal =>
{
    const real = await importOriginal<typeof import('node:crypto')>();
    return { ...real, timingSafeEqual: vi.fn(real.timingSafeEqual) };
});
const crypto = await import('node:crypto');
const { FrameStore } = await import('@/lib/phones/frameStore');
const { getInternalDevices, getInternalFrame, postInternalDetections, WORKER_REFUSED } = await import('@/lib/detections/http');
const { workerAuthorized } = await import('@/lib/detections/workerToken');

const TOKEN = 'a'.repeat(64);
const T0 = Date.UTC(2026, 9, 10, 20, 0, 0);
const prisma = {} as PrismaClient;
const jpeg = (fill = 7) => { const body = Buffer.alloc(64, fill); body[0] = 0xff; body[1] = 0xd8; return body; };
// null = no Authorization header at all.
const auth = (value: string | null): Record<string, string> => (value === null ? {} : { authorization: value });
const get = (path: string, value: string | null) => new Request(`http://web:3000${path}`, { headers: auth(value) });
const post = (id: string, body: unknown, value: string | null = `Bearer ${TOKEN}`) =>
    new Request(`http://web:3000/api/internal/detections/${id}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', ...auth(value) } });
const empty = (at: number) => ({ at, dark: false, width: 320, height: 240, objects: [], trails: [] });

function setup(token: string = TOKEN)
{
    const store = new FrameStore();
    store.put('d1', jpeg(), T0);
    return { store, deps: { prisma, store, token, now: () => T0 + 100 } };
}

describe('worker token', () =>
{
    it('accepts only the exact bearer token, always through timingSafeEqual', () =>
    {
        const compare = vi.mocked(crypto.timingSafeEqual);
        compare.mockClear();
        expect(workerAuthorized(new Headers(auth(`Bearer ${TOKEN}`)), TOKEN)).toBe(true);
        expect(workerAuthorized(new Headers(auth(`Bearer ${TOKEN}x`)), TOKEN)).toBe(false);
        expect(workerAuthorized(new Headers(auth(`Basic ${TOKEN}`)), TOKEN)).toBe(false);
        expect(workerAuthorized(new Headers(auth(null)), TOKEN)).toBe(false);
        expect(workerAuthorized(new Headers(auth('Bearer x')), '')).toBe(false);
        expect(workerAuthorized(new Headers(auth('Bearer x')), '   ')).toBe(false);
        expect(workerAuthorized(new Headers(auth(null)), '')).toBe(false);
        expect(workerAuthorized(new Headers(auth(`Bearer ${TOKEN}`)), undefined)).toBe(false);
        expect(compare).toHaveBeenCalledTimes(8);
    });

    it('falls back to process.env.WORKER_TOKEN and refuses when it is unset', () =>
    {
        vi.stubEnv('WORKER_TOKEN', '');
        expect(workerAuthorized(new Headers(auth('Bearer ')))).toBe(false);
        vi.stubEnv('WORKER_TOKEN', TOKEN);
        expect(workerAuthorized(new Headers(auth(`Bearer ${TOKEN}`)))).toBe(true);
        vi.unstubAllEnvs();
    });

    it('refuses every internal route without the right token, and when the token is unset', async () =>
    {
        for (const [token, header] of [[TOKEN, null], [TOKEN, 'Bearer wrong'], [TOKEN, `Basic ${TOKEN}`], ['', 'Bearer '], ['', null], ['   ', `Bearer ${TOKEN}`]] as const)
        {
            const { deps } = setup(token);
            expect(getInternalDevices(deps, get('/api/internal/devices', header)).status).toBe(401);
            expect(getInternalFrame(deps, 'd1', get('/api/internal/frame/d1', header)).status).toBe(401);
            const refused = await postInternalDetections(deps, 'd1', post('d1', empty(T0), header));
            expect(refused.status).toBe(401);
            expect(await refused.json()).toEqual({ error: WORKER_REFUSED });
        }
    });
});

describe('internal routes', () =>
{
    it('lists online devices with their newest frame time', () =>
    {
        const { deps, store } = setup();
        store.put('old', jpeg(), T0 - 20_000);
        return getInternalDevices(deps, get('/api/internal/devices', `Bearer ${TOKEN}`)).json().then(body =>
            expect(body).toEqual({ devices: [{ id: 'd1', frameAt: T0 }] }));
    });

    it('serves the newest frame with its time, 404 when there is none', async () =>
    {
        const { deps } = setup();
        const response = getInternalFrame(deps, 'd1', get('/api/internal/frame/d1', `Bearer ${TOKEN}`));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/jpeg');
        expect(response.headers.get('x-frame-at')).toBe(String(T0));
        expect(Buffer.from(await response.arrayBuffer())).toEqual(jpeg());
        expect(getInternalFrame(deps, 'nope', get('/api/internal/frame/nope', `Bearer ${TOKEN}`)).status).toBe(404);
    });

    it('stores valid results; 400 bad shape, 413 too large, 404 offline, 409 stale', async () =>
    {
        const { deps, store } = setup();
        const stored = await postInternalDetections(deps, 'd1', post('d1', empty(T0)));
        expect(stored.status).toBe(200);
        expect(await stored.json()).toEqual({ stored: true, danger: 'none' });
        expect(store.detections('d1', T0 + 100)).toEqual(empty(T0));
        expect((await postInternalDetections(deps, 'd1', post('d1', empty(T0)))).status).toBe(409);
        expect((await postInternalDetections(deps, 'd1', post('d1', empty(T0 - 1)))).status).toBe(409);
        expect((await postInternalDetections(deps, 'd1', post('d1', { ...empty(T0 + 1), extra: true }))).status).toBe(400);
        expect((await postInternalDetections(deps, 'd1', post('d1', '{not json'))).status).toBe(400);
        expect((await postInternalDetections(deps, 'd1', post('d1', 'x'.repeat(256 * 1024 + 1)))).status).toBe(413);
        expect((await postInternalDetections(deps, 'gone', post('gone', empty(T0)))).status).toBe(404);
    });
});
```

`tests/unit/caddyfile.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const caddyfile = readFileSync(join(import.meta.dirname, '..', '..', '..', 'Caddyfile'), 'utf8');

describe('Caddyfile', () =>
{
    it('answers /api/internal and everything under it with 404 before proxying', () =>
    {
        expect(caddyfile).toMatch(/^\s*@internal path \/api\/internal \/api\/internal\/\*\s*$/m);
        expect(caddyfile).toMatch(/^\s*respond @internal 404\s*$/m);
        expect(caddyfile.indexOf('respond @internal 404')).toBeLessThan(caddyfile.indexOf('reverse_proxy web:3000'));
    });
});
```

Add to `tests/unit/frameStore.test.ts` (it already has a `jpeg(n)` helper):
```ts
it('keeps detections beside the newest frame, across new frames, and drops them with the device', () =>
{
    const store = new FrameStore();
    const result = (at: number) => ({ at, dark: false, width: 320, height: 240, objects: [], trails: [] });
    expect(store.putDetections('d1', result(1_000), 1_000)).toBe('offline');
    store.put('d1', jpeg(1), 1_000);
    expect(store.putDetections('d1', result(1_000), 1_100)).toBe('stored');
    expect(store.putDetections('d1', result(1_000), 1_200)).toBe('stale');
    store.put('d1', jpeg(2), 1_500);
    expect(store.detections('d1', 1_600)).toEqual(result(1_000));
    // A stopped worker: the device keeps sending, but no result for more than 10 s → null ("Detection off").
    store.put('d1', jpeg(3), 11_200);
    expect(store.detections('d1', 11_100)).toEqual(result(1_000));
    expect(store.detections('d1', 11_200)).toBeNull();
    // An offline device has none, whatever was stored.
    expect(store.putDetections('d1', result(11_200), 11_300)).toBe('stored');
    expect(store.detections('d1', 11_300)).toEqual(result(11_200));
    expect(store.detections('d1', 11_200 + 10_001)).toBeNull();
    store.forget('d1');
    expect(store.detections('d1', 11_300)).toBeNull();
});
```

Add to `tests/integration/live-phones.test.ts`, inside the existing `describe('frames')` block, before `it('lists online phones for everyone and every phone for admins')` (it uses the file's `register`, `jpeg`, `T0`, `volunteer`, `viewer` and `getDevices`):
```ts
it('returns the newest detections for online devices only', async () =>
{
    const id = await register(volunteer);
    const store = new FrameStore();
    store.put(id, jpeg(), T0);
    const list = async () => ((await (await getDevices({ prisma, user: viewer, store, now: () => T0 + 500 })).json()) as { devices: LiveDeviceView[] }).devices;
    expect((await list())[0].detections).toBeNull();
    const result = { at: T0, dark: false, width: 320, height: 240, objects: [{ track: 'P1', label: 'person' as const, score: 0.82, box: [1, 2, 3, 4] as [number, number, number, number] }], trails: [] };
    store.putDetections(id, result, T0 + 200);
    expect((await list())[0].detections).toEqual(result);
});
```

In `tests/unit/liveScreen.test.tsx` and `tests/unit/sourceSelect.test.tsx`, add `detections: null` to every `LiveDeviceView` fixture (the `phone` and `board` objects and any inline device objects).

Run: `cd dashboard/web && npx vitest run tests/unit/detectionsSchema.test.ts tests/unit/internal-routes.test.ts tests/unit/caddyfile.test.ts tests/unit/frameStore.test.ts`
Expected: FAIL (modules and methods missing, Caddyfile lines missing).

- [ ] **Step 2: Types and the frame store**

`src/lib/types.ts`, after `BoardMotionView`:
```ts
export type DetectionLabel = 'person' | 'possible turtle';
export type PixelBox = [number, number, number, number];

export interface DetectedObject
{
    track: string;            // 'P3' person, 'T1' possible turtle; per device
    label: DetectionLabel;
    score?: number;           // people only; a model score, not a probability
    box: PixelBox;            // x, y, w, h in picture pixels
}

export interface DetectionTrail
{
    track: string;
    label: DetectionLabel;
    points: [number, number, number][];   // [epoch ms, x, y] box centres, oldest first, ≤ 60 points / 30 s
}

// Newest result of the live detection worker for one device (memory only, same lifetime as frames).
export interface DetectionsView
{
    at: number;               // frame time (epoch ms) the result belongs to
    dark: boolean;
    width: number;
    height: number;
    objects: DetectedObject[];
    trails: DetectionTrail[];
}
```
and add to `LiveDeviceView`, after `motion`: `detections: DetectionsView | null;`.

`src/lib/phones/frameStore.ts`:
- `import type { DetectionsView } from '@/lib/types';`
- `export const DETECTIONS_FRESH_MS = ONLINE_MS;`
- `Entry` gains `detections: (DetectionsView & { postedAt: number }) | null;`
- in `put`, the new entry carries `detections: entry?.detections ?? null`.
- new methods:
```ts
    // A worker result for the device's current picture; older or repeated frame times are refused.
    putDetections(deviceId: string, detections: DetectionsView, now: number = Date.now()): 'stored' | 'stale' | 'offline'
    {
        const entry = this.entries.get(deviceId);
        if (!entry || now - entry.at > ONLINE_MS)
        {
            return 'offline';
        }
        if (entry.detections && detections.at <= entry.detections.at)
        {
            return 'stale';
        }
        entry.detections = { ...detections, postedAt: now };
        return 'stored';
    }

    // Null while offline, or when the worker has not reported for DETECTIONS_FRESH_MS (the tile says "Detection off").
    detections(deviceId: string, now: number = Date.now()): DetectionsView | null
    {
        const entry = this.entries.get(deviceId);
        const stored = entry?.detections;
        if (!entry || !stored || now - entry.at > ONLINE_MS || now - stored.postedAt > DETECTIONS_FRESH_MS)
        {
            return null;
        }
        return { at: stored.at, dark: stored.dark, width: stored.width, height: stored.height, objects: stored.objects, trails: stored.trails };
    }
```

`src/lib/phones/devices.ts`, in `listDevices`' returned object, after `motion`: `detections: online.has(row.id) ? store.detections(row.id, now) : null,`.

- [ ] **Step 3: Token, schema and handlers**

`src/lib/detections/workerToken.ts`:
```ts
import { createHash, timingSafeEqual } from 'node:crypto';
import { bearerToken } from '@/lib/phones/deviceToken';

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();

// The live detection worker's shared secret. Refused when WORKER_TOKEN is unset or blank; digests make the lengths equal for timingSafeEqual.
export function workerAuthorized(headers: Headers, expected: string | undefined = process.env.WORKER_TOKEN): boolean
{
    const configured = (expected ?? '').trim();
    const presented = bearerToken(headers) ?? '';
    const same = timingSafeEqual(digest(presented), digest(configured));
    return same && configured.length > 0 && presented.length > 0;
}
```

`src/lib/detections/schema.ts`:
```ts
import { z } from 'zod';
import type { DetectionsView } from '@/lib/types';

export const MAX_DETECTION_BYTES = 256 * 1024;
export const MAX_OBJECTS = 50;
export const MAX_TRAILS = 50;
export const MAX_TRAIL_POINTS = 60;

const pixel = z.number().min(0).max(65535);
const box = z.tuple([pixel, pixel, pixel, pixel]);
const track = z.string().regex(/^[PT][1-9]\d{0,5}$/);
const time = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const person = z.object({ track, label: z.literal('person'), score: z.number().min(0).max(1), box }).strict();
const turtle = z.object({ track, label: z.literal('possible turtle'), box }).strict();
const trail = z.object({ track, label: z.enum(['person', 'possible turtle']), points: z.array(z.tuple([time, pixel, pixel])).min(1).max(MAX_TRAIL_POINTS) }).strict();

export const detectionsSchema = z.object({
    at: time,
    dark: z.boolean(),
    width: z.number().int().min(1).max(65535),
    height: z.number().int().min(1).max(65535),
    objects: z.array(z.discriminatedUnion('label', [person, turtle])).max(MAX_OBJECTS),
    trails: z.array(trail).max(MAX_TRAILS),
}).strict();

// The worker's result, or null. Ids and labels must agree: P = person, T = possible turtle.
export function parseDetections(value: unknown): DetectionsView | null
{
    const parsed = detectionsSchema.safeParse(value);
    if (!parsed.success)
    {
        return null;
    }
    const consistent = [...parsed.data.objects, ...parsed.data.trails].every(item => (item.track[0] === 'P') === (item.label === 'person'));
    return consistent ? parsed.data : null;
}
```

`src/lib/detections/http.ts`:
```ts
import type { PrismaClient } from '@/generated/prisma/client';
import { readCapped } from '@/lib/phones/body';
import type { FrameStore } from '@/lib/phones/frameStore';
import { MAX_DETECTION_BYTES, parseDetections } from './schema';
import { workerAuthorized } from './workerToken';

export interface InternalDeps
{
    prisma: PrismaClient;
    store: FrameStore;
    /** Defaults to process.env.WORKER_TOKEN; tests pass it explicitly. */
    token?: string;
    now?: () => number;
}

export const WORKER_REFUSED = 'Worker token not accepted.';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const refused = () => json({ error: WORKER_REFUSED }, 401);

export function getInternalDevices(deps: InternalDeps, request: Request): Response
{
    if (!workerAuthorized(request.headers, deps.token))
    {
        return refused();
    }
    const now = deps.now?.() ?? Date.now();
    return json({ devices: deps.store.onlineIds(now).map(id => ({ id, frameAt: deps.store.lastFrameAt(id) })) });
}

export function getInternalFrame(deps: InternalDeps, deviceId: string, request: Request): Response
{
    if (!workerAuthorized(request.headers, deps.token))
    {
        return refused();
    }
    const frame = deps.store.latest(deviceId, deps.now?.() ?? Date.now());
    if (!frame)
    {
        return json({ error: 'No frame in the last 10 s.' }, 404);
    }
    return new Response(new Uint8Array(frame.jpeg), { status: 200, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'image/jpeg', 'X-Frame-At': String(frame.at), 'Content-Length': String(frame.jpeg.length) } });
}

export async function postInternalDetections(deps: InternalDeps, deviceId: string, request: Request): Promise<Response>
{
    if (!workerAuthorized(request.headers, deps.token))
    {
        return refused();
    }
    const body = await readCapped(request, MAX_DETECTION_BYTES);
    if (body === 'too-large')
    {
        return json({ error: 'Detections larger than 256 KB.' }, 413);
    }
    let value: unknown = null;
    try
    {
        value = JSON.parse(body.toString('utf8'));
    }
    catch
    {
        value = null;
    }
    const detections = parseDetections(value);
    if (!detections)
    {
        return json({ error: 'Detections do not match the expected shape.' }, 400);
    }
    const now = deps.now?.() ?? Date.now();
    const stored = deps.store.putDetections(deviceId, detections, now);
    if (stored === 'offline')
    {
        return json({ error: 'No live frame from that device.' }, 404);
    }
    if (stored === 'stale')
    {
        return json({ error: 'A newer result is already stored.' }, 409);
    }
    return json({ stored: true, danger: 'none' });
}
```
(`frameAt` is never null here: `onlineIds` only lists devices with a frame.)

Routes. Each sets `export const dynamic = 'force-dynamic';` and never calls `currentUserOrNull` (a session is not a way in).

`src/app/api/internal/devices/route.ts`:
```ts
import { prisma } from '@/lib/db';
import { getInternalDevices } from '@/lib/detections/http';
import { frameStore } from '@/lib/phones/frameStore';

export const dynamic = 'force-dynamic';

export function GET(request: Request): Response
{
    return getInternalDevices({ prisma, store: frameStore }, request);
}
```
`src/app/api/internal/frame/[deviceId]/route.ts`:
```ts
import { prisma } from '@/lib/db';
import { getInternalFrame } from '@/lib/detections/http';
import { frameStore } from '@/lib/phones/frameStore';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ deviceId: string }> }): Promise<Response>
{
    return getInternalFrame({ prisma, store: frameStore }, (await context.params).deviceId, request);
}
```
`src/app/api/internal/detections/[deviceId]/route.ts`:
```ts
import { prisma } from '@/lib/db';
import { postInternalDetections } from '@/lib/detections/http';
import { frameStore } from '@/lib/phones/frameStore';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ deviceId: string }> }): Promise<Response>
{
    return postInternalDetections({ prisma, store: frameStore }, (await context.params).deviceId, request);
}
```

- [ ] **Step 4: Caddy, environment, boundary test**

`dashboard/Caddyfile`, inside the site block, directly after the `request_body { ... }` block and before `reverse_proxy`:
```
	# Worker-only routes (dashboard/worker over the internal Compose network); never served to the LAN.
	@internal path /api/internal /api/internal/*
	respond @internal 404
```
`dashboard/.env.example`, at the end:
```
# Live detection worker (dashboard/worker). Shared secret for the internal routes /api/internal/*; generate with:
# openssl rand -hex 32. Empty keeps detection off: the routes then refuse every request and the worker exits at start.
WORKER_TOKEN=
```
`tests/boundary.test.ts`: extend `skipDirectories` to `new Set(['node_modules', '.next', 'generated', 'migrations', 'media', 'recordings', '.venv', 'models', '__pycache__', '.pytest_cache'])`. The scan then covers the worker's own `.py` files but not its virtualenv.

- [ ] **Step 5: Run and commit**

```bash
cd dashboard/web && npm run db:test:prepare && npx tsc --noEmit && npx vitest run
git add dashboard/Caddyfile dashboard/.env.example dashboard/web/src/lib/types.ts dashboard/web/src/lib/phones/frameStore.ts \
  dashboard/web/src/lib/phones/devices.ts dashboard/web/src/lib/detections/workerToken.ts dashboard/web/src/lib/detections/schema.ts \
  dashboard/web/src/lib/detections/http.ts dashboard/web/src/app/api/internal/devices/route.ts \
  'dashboard/web/src/app/api/internal/frame/[deviceId]/route.ts' 'dashboard/web/src/app/api/internal/detections/[deviceId]/route.ts' \
  dashboard/web/tests/boundary.test.ts dashboard/web/tests/unit/internal-routes.test.ts dashboard/web/tests/unit/caddyfile.test.ts \
  dashboard/web/tests/unit/detectionsSchema.test.ts dashboard/web/tests/unit/frameStore.test.ts \
  dashboard/web/tests/integration/live-phones.test.ts dashboard/web/tests/unit/liveScreen.test.tsx dashboard/web/tests/unit/sourceSelect.test.tsx
git status --short
git commit -m "feat(dashboard): internal worker API with a shared token, detections beside the newest frame"
```
Expected: all tests pass.

---

### Task 2: Worker skeleton: image with the pinned model, config, internal API client, round-robin loop

**Files:**
- Create: `dashboard/worker/Dockerfile`, `dashboard/worker/.dockerignore`, `dashboard/worker/requirements.txt`, `dashboard/worker/pytest.ini`, `dashboard/worker/nesttrace_worker/__init__.py`, `dashboard/worker/nesttrace_worker/config.py`, `dashboard/worker/nesttrace_worker/api.py`, `dashboard/worker/nesttrace_worker/scheduler.py`, `dashboard/worker/tests/__init__.py` (empty), `dashboard/worker/tests/helpers.py`, `dashboard/worker/tests/conftest.py`, `dashboard/worker/tests/test_api_and_loop.py`, `dashboard/worker/tests/test_packaging.py`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the Task 1 routes (`GET /api/internal/devices` → `{ devices: [{ id, frameAt }] }`, `GET /api/internal/frame/<id>` → JPEG + `X-Frame-At`, `POST /api/internal/detections/<id>` → 200/404/409).
- Produces: `Config(web_url, token, model_path)`, `load_config(env=None)` (exits when `WORKER_TOKEN` is blank); `InternalApi(base_url, token, transport=None)` with `devices() -> list[DeviceRef]`, `frame(id) -> Frame | None`, `post_detections(id, payload) -> bool`, `close()`; `DeviceRef(id, frame_at)`, `Frame(jpeg, at)`; `Scheduler(api, make_pipeline, clock=time.monotonic)` with `tick() -> list[str]` (device ids served); `Analyser` protocol `process(bgr, at_ms) -> dict`; constants `LOOP_MS = 500`, `MIN_FRAME_GAP_MS = 500`.

- [ ] **Step 1: Ignore rules and the host environment**

Append to the repo-root `.gitignore`:
```
# Live detection worker: local virtualenv and the downloaded model (fetched at image build, never committed)
dashboard/worker/.venv/
dashboard/worker/models/
```
(`.venv/` already matches anywhere; the explicit line documents it.)

Create `dashboard/worker/requirements.txt`:
```
opencv-python-headless==5.0.0.93
numpy==2.2.6
httpx==0.28.1
anyio==4.15.1
certifi==2026.7.22
h11==0.16.0
httpcore==1.0.9
idna==3.20
typing_extensions==4.16.0
pytest==9.1.1
iniconfig==2.3.1
packaging==26.3
pluggy==1.6.0
Pygments==2.21.0
```
`dashboard/worker/pytest.ini`:
```
[pytest]
testpaths = tests
pythonpath = .
addopts = -p no:cacheprovider
```
`dashboard/worker/.dockerignore`:
```
.venv
models
__pycache__
.pytest_cache
```
Host setup (once, Python 3.12):
```bash
cd dashboard/worker && python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
mkdir -p models && curl -fsSL -o models/yolox_nano.onnx https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx
echo "c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d  models/yolox_nano.onnx" | shasum -a 256 -c -
```
Expected: `models/yolox_nano.onnx: OK`. `git status --short` shows neither `.venv` nor `models`.

- [ ] **Step 2: Failing tests**

`tests/helpers.py`:
```python
from pathlib import Path

WORKER = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).resolve().parent / 'fixtures'
MODEL_URL = 'https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx'
MODEL_SHA256 = 'c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d'
# USFWS photo (public domain), resized to 320x240 (dashboard/worker/tests/fixtures/README.txt).
FIXTURE_SHA256 = 'b28e927737026ff66e666e1011952adf0efadda119c335143b7c9b84d6fc2ae2'
```
`tests/conftest.py`:
```python
import os
from pathlib import Path

import pytest

from tests.helpers import WORKER


@pytest.fixture(scope='session')
def model_path() -> str:
    path = Path(os.environ.get('MODEL_PATH', WORKER / 'models' / 'yolox_nano.onnx'))
    if not path.is_file():
        pytest.fail(f'{path} is missing: download the model first (dashboard/README.md, "Live detection")')
    return str(path)
```
`tests/test_api_and_loop.py` (a real local HTTP server stands in for `web`):
```python
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np
import pytest

from nesttrace_worker.api import DeviceRef, InternalApi
from nesttrace_worker.config import load_config
from nesttrace_worker.scheduler import Scheduler

TOKEN = 'test-worker-token'
JPEG = cv2.imencode('.jpg', np.full((240, 320, 3), 128, np.uint8))[1].tobytes()


class FakeWeb:
    """A stand-in for the web app's internal routes, on a real local socket."""

    def __init__(self):
        self.devices: dict[str, int] = {}
        self.requests: list[tuple[str, str, str | None]] = []
        self.posted: dict[str, list[dict]] = {}
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _send(self, status: int, body: bytes = b'', headers: dict | None = None):
                self.send_response(status)
                for key, value in (headers or {}).items():
                    self.send_header(key, value)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _authorized(self) -> bool:
                fake.requests.append((self.command, self.path, self.headers.get('Authorization')))
                if self.headers.get('Authorization') != f'Bearer {TOKEN}':
                    self._send(401)
                    return False
                return True

            def do_GET(self):
                if not self._authorized():
                    return
                if self.path == '/api/internal/devices':
                    body = json.dumps({'devices': [{'id': key, 'frameAt': at} for key, at in fake.devices.items()]}).encode()
                    return self._send(200, body, {'Content-Type': 'application/json'})
                device = self.path.removeprefix('/api/internal/frame/')
                if device in fake.devices:
                    return self._send(200, JPEG, {'Content-Type': 'image/jpeg', 'X-Frame-At': str(fake.devices[device])})
                self._send(404)

            def do_POST(self):
                if not self._authorized():
                    return
                device = self.path.removeprefix('/api/internal/detections/')
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                fake.posted.setdefault(device, []).append(body)
                self._send(200 if device in fake.devices else 404, b'{}', {'Content-Type': 'application/json'})

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.url = f'http://127.0.0.1:{self.server.server_address[1]}'
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()


@pytest.fixture
def web():
    fake = FakeWeb()
    yield fake
    fake.close()


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


class CountingPipeline:
    def __init__(self, log: list):
        self.log = log

    def process(self, bgr, at_ms):
        self.log.append(at_ms)
        return {'at': at_ms, 'dark': False, 'width': bgr.shape[1], 'height': bgr.shape[0], 'objects': [], 'trails': []}


def test_client_sends_the_bearer_token_and_reads_frames(web):
    web.devices = {'d1': 1_000}
    api = InternalApi(web.url, TOKEN)
    assert api.devices() == [DeviceRef('d1', 1_000)]
    frame = api.frame('d1')
    assert frame.at == 1_000 and frame.jpeg == JPEG
    assert api.frame('missing') is None
    assert api.post_detections('d1', {'at': 1_000}) is True
    assert api.post_detections('gone', {'at': 1_000}) is False
    assert {auth for _, _, auth in web.requests} == {f'Bearer {TOKEN}'}


def test_wrong_token_raises(web):
    import httpx
    with pytest.raises(httpx.HTTPStatusError):
        InternalApi(web.url, 'wrong').devices()


def test_config_refuses_a_missing_token():
    with pytest.raises(SystemExit):
        load_config({'WORKER_TOKEN': '  '})
    config = load_config({'WORKER_TOKEN': 'abc', 'WEB_URL': 'http://web:3000/'})
    assert config.web_url == 'http://web:3000' and config.model_path == '/app/models/yolox_nano.onnx'


def test_loop_skips_unchanged_frames_and_caps_two_per_second(web):
    web.devices = {'d1': 1_000}
    clock = FakeClock()
    runs: list[int] = []
    scheduler = Scheduler(InternalApi(web.url, TOKEN), lambda: CountingPipeline(runs), clock)
    assert scheduler.tick() == ['d1']
    clock.now = 0.5
    assert scheduler.tick() == []                 # same frame time: nothing to do
    web.devices['d1'] = 1_100
    clock.now = 0.7
    assert scheduler.tick() == ['d1']             # new frame, 0.7 s after the last run
    web.devices['d1'] = 1_200
    clock.now = 0.9
    assert scheduler.tick() == []                 # new frame, but only 0.2 s later: over 2 frames/s
    clock.now = 1.2
    assert scheduler.tick() == ['d1']
    assert runs == [1_000, 1_100, 1_200]
    assert [p['at'] for p in web.posted['d1']] == runs


def test_round_robin_when_a_pass_runs_out_of_time(web):
    web.devices = {'a': 1, 'b': 1, 'c': 1}
    clock = FakeClock()

    class SlowPipeline(CountingPipeline):
        def process(self, bgr, at_ms):
            clock.now += 0.3  # each frame takes 300 ms, so a 500 ms pass serves two devices
            return super().process(bgr, at_ms)

    runs: list[int] = []
    scheduler = Scheduler(InternalApi(web.url, TOKEN), lambda: SlowPipeline(runs), clock)
    assert scheduler.tick() == ['a', 'b']
    for key in web.devices:
        web.devices[key] = 2
    clock.now += 1.0
    assert scheduler.tick() == ['c', 'a']         # starts after the last device served
    assert scheduler.tick() == ['b']


def test_devices_that_go_offline_lose_their_state(web):
    web.devices = {'d1': 1}
    clock = FakeClock()
    scheduler = Scheduler(InternalApi(web.url, TOKEN), lambda: CountingPipeline([]), clock)
    scheduler.tick()
    assert 'd1' in scheduler.pipelines
    web.devices = {}
    scheduler.tick()
    assert scheduler.pipelines == {}
```
`tests/test_packaging.py`:
```python
import re

from tests.helpers import MODEL_SHA256, MODEL_URL, WORKER


def test_dockerfile_pins_the_model_release_and_hash():
    dockerfile = (WORKER / 'Dockerfile').read_text()
    assert f'ARG MODEL_URL={MODEL_URL}' in dockerfile
    assert f'ARG MODEL_SHA256={MODEL_SHA256}' in dockerfile
    assert 'sha256sum -c -' in dockerfile


def test_worker_never_reaches_into_the_research_app():
    # agent.md: the worker is dashboard code. No simulator, research pipeline, research API, seeds or private paths.
    imports = re.compile(r'^\s*(from|import)\s+(pipeline|web|scripts|config)\b', re.MULTILINE)
    for path in (WORKER / 'nesttrace_worker').glob('*.py'):
        text = path.read_text()
        assert not imports.search(text), path.name
        for word in ('artifacts/', 'private/', 'server.mjs', ':5174', 'truth.json'):
            assert word not in text, f'{path.name} mentions {word}'
```
Run: `cd dashboard/worker && .venv/bin/pytest -q`
Expected: FAIL (`nesttrace_worker` missing, no Dockerfile).

- [ ] **Step 3: Implement**

`nesttrace_worker/__init__.py`:
```python
"""NestTrace live detection worker: people (YOLOX-nano) and possible turtles (a rule) on live camera frames."""
```
`nesttrace_worker/config.py`:
```python
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    web_url: str
    token: str
    model_path: str


def load_config(env: dict[str, str] | None = None) -> Config:
    env = os.environ if env is None else env
    token = env.get('WORKER_TOKEN', '').strip()
    if not token:
        raise SystemExit('WORKER_TOKEN is not set; live detection stays off (dashboard/README.md, "Live detection").')
    return Config(
        web_url=env.get('WEB_URL', 'http://web:3000').rstrip('/'),
        token=token,
        model_path=env.get('MODEL_PATH', '/app/models/yolox_nano.onnx'),
    )
```
`nesttrace_worker/api.py`:
```python
from dataclasses import dataclass

import httpx

TIMEOUT_S = 3.0


@dataclass(frozen=True)
class DeviceRef:
    id: str
    frame_at: int


@dataclass(frozen=True)
class Frame:
    jpeg: bytes
    at: int


class InternalApi:
    """The web app's internal routes (/api/internal/*), reachable only inside Compose, with the worker token."""

    def __init__(self, base_url: str, token: str, transport: httpx.BaseTransport | None = None):
        self.client = httpx.Client(base_url=base_url, headers={'Authorization': f'Bearer {token}'}, timeout=TIMEOUT_S, transport=transport)

    def devices(self) -> list[DeviceRef]:
        response = self.client.get('/api/internal/devices')
        response.raise_for_status()
        return [DeviceRef(str(d['id']), int(d['frameAt'])) for d in response.json()['devices']]

    def frame(self, device_id: str) -> Frame | None:
        response = self.client.get(f'/api/internal/frame/{device_id}')
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return Frame(response.content, int(response.headers['X-Frame-At']))

    def post_detections(self, device_id: str, payload: dict) -> bool:
        response = self.client.post(f'/api/internal/detections/{device_id}', json=payload)
        if response.status_code in (404, 409):
            return False  # device gone, or a newer result is already stored
        response.raise_for_status()
        return True

    def close(self) -> None:
        self.client.close()
```
`nesttrace_worker/scheduler.py`:
```python
import time
from collections.abc import Callable
from typing import Protocol

import cv2
import numpy as np

from .api import InternalApi

LOOP_MS = 500
MIN_FRAME_GAP_MS = 500    # at most 2 frames/s per device


class Analyser(Protocol):
    def process(self, bgr: np.ndarray, at_ms: int) -> dict: ...


class Scheduler:
    """One pass every 500 ms: newest frame of each online device whose frame changed, round-robin, at most 2 frames/s per device.
    A pass stops once it has used its 500 ms; the next pass starts with the device after the last one served."""

    def __init__(self, api: InternalApi, make_pipeline: Callable[[], Analyser], clock: Callable[[], float] = time.monotonic):
        self.api = api
        self.make_pipeline = make_pipeline
        self.clock = clock
        self.pipelines: dict[str, Analyser] = {}
        self.done_at: dict[str, int] = {}      # frame time last processed, per device
        self.ran_at: dict[str, float] = {}     # clock (s) of the last run, per device
        self.last_served: str | None = None

    def tick(self) -> list[str]:
        started = self.clock()
        devices = self.api.devices()
        online = {d.id for d in devices}
        for gone in [key for key in self.pipelines if key not in online]:
            self.pipelines.pop(gone)
            self.done_at.pop(gone, None)
            self.ran_at.pop(gone, None)
        ids = sorted(online)
        if self.last_served in ids:
            pivot = ids.index(self.last_served) + 1
            ids = ids[pivot:] + ids[:pivot]
        frame_at = {d.id: d.frame_at for d in devices}
        served = []
        for device_id in ids:
            if (self.clock() - started) * 1000 >= LOOP_MS:
                break
            if frame_at[device_id] == self.done_at.get(device_id):
                continue
            if (self.clock() - self.ran_at.get(device_id, float('-inf'))) * 1000 < MIN_FRAME_GAP_MS:
                continue
            self.ran_at[device_id] = self.clock()
            frame = self.api.frame(device_id)
            if frame is None:
                continue
            self.done_at[device_id] = frame.at
            picture = cv2.imdecode(np.frombuffer(frame.jpeg, np.uint8), cv2.IMREAD_COLOR)
            if picture is None:
                continue
            pipeline = self.pipelines.setdefault(device_id, self.make_pipeline())
            self.api.post_detections(device_id, pipeline.process(picture, frame.at))
            served.append(device_id)
            self.last_served = device_id
        return served
```
`Dockerfile` (the build fails unless the model matches the SHA-256):
```dockerfile
FROM python:3.12.15-slim-bookworm
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
# YOLOX-nano (Megvii, Apache-2.0), official ONNX release. The build fails unless the file matches this SHA-256.
ARG MODEL_URL=https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx
ARG MODEL_SHA256=c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d
RUN mkdir -p /app/models \
    && python -c "import sys, urllib.request; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])" "$MODEL_URL" /app/models/yolox_nano.onnx \
    && echo "$MODEL_SHA256  /app/models/yolox_nano.onnx" | sha256sum -c -
COPY . .
RUN useradd --system --no-create-home worker
USER worker
CMD ["python", "-m", "nesttrace_worker.main"]
```

- [ ] **Step 4: Run and commit**

```bash
cd dashboard/worker && .venv/bin/pytest -q          # 8 passed
cd ../.. && git add .gitignore dashboard/worker/Dockerfile dashboard/worker/.dockerignore dashboard/worker/requirements.txt \
  dashboard/worker/pytest.ini dashboard/worker/nesttrace_worker/__init__.py dashboard/worker/nesttrace_worker/config.py \
  dashboard/worker/nesttrace_worker/api.py dashboard/worker/nesttrace_worker/scheduler.py dashboard/worker/tests/__init__.py \
  dashboard/worker/tests/helpers.py dashboard/worker/tests/conftest.py dashboard/worker/tests/test_api_and_loop.py \
  dashboard/worker/tests/test_packaging.py
git status --short
git commit -m "feat(dashboard): live detection worker skeleton with the pinned YOLOX-nano model and a round-robin loop"
```
The Docker image is built in Task 4, once `main.py` exists.

---

### Task 3: Person detector: YOLOX pre- and post-processing, NMS, dark frames

**Files:**
- Create: `dashboard/worker/nesttrace_worker/detector.py`, `dashboard/worker/tests/test_detector.py`, `dashboard/worker/tests/fixtures/person-beach-320.jpg`, `dashboard/worker/tests/fixtures/README.txt`

**Interfaces:**
- Produces: constants `INPUT_SIZE = 416`, `STRIDES = (8, 16, 32)`, `ANCHORS = 3549`, `CLASSES = 80`, `PERSON_CLASS = 0`, `PAD_VALUE = 114`, `PERSON_MIN_SCORE = 0.40`, `NMS_IOU = 0.45`, `MIN_BOX_FRACTION = 0.01`, `DARK_MEAN = 25.0`; `Box(x, y, w, h, score)` (frozen dataclass, picture pixels); `is_dark(bgr) -> bool`; `letterbox(bgr) -> (padded, ratio)`; `to_blob(padded) -> np.ndarray`; `decode(raw, ratio, width, height) -> list[Box]`; `PersonDetector(model_path).detect(bgr) -> list[Box]`.

- [ ] **Step 1: The fixture**

The picture is a public-domain USFWS photo of one person walking on a beach. Make it, check both hashes, and stop if either differs (do not substitute another picture):
```bash
mkdir -p "$TMPDIR/plan-g-src" && curl -fsSL -A "nesttrace-dashboard (fixture)" -o "$TMPDIR/plan-g-src/thumb.jpg" \
  "https://upload.wikimedia.org/wikipedia/commons/thumb/b/be/U.S._Fish_and_Wildlife_Service_biologist_Jeff_Phillips_surveys_along_Arroyo_Quemada_Beach_in_Goleta%2C_California_to_assess_damage_in_the_early_days_of_the_Refugio_oil_spill._Photo_by_USFWS._%2818748816712%29.jpg/960px-thumbnail.jpg"
echo "41e2ee31d6c15976c334d08f15ec51d03dfb3320b0c688031618f13153922e27  $TMPDIR/plan-g-src/thumb.jpg" | shasum -a 256 -c -
cd dashboard/worker && mkdir -p tests/fixtures && .venv/bin/python -I -c "
import cv2, sys
picture = cv2.imread(sys.argv[1])
cv2.imwrite(sys.argv[2], cv2.resize(picture, (320, 240), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 90])
" "$TMPDIR/plan-g-src/thumb.jpg" tests/fixtures/person-beach-320.jpg
echo "b28e927737026ff66e666e1011952adf0efadda119c335143b7c9b84d6fc2ae2  tests/fixtures/person-beach-320.jpg" | shasum -a 256 -c -
```
If Wikimedia serves different thumbnail bytes, copy the verified file from this plan's scratch run instead (same SHA-256 check): `/private/tmp/claude-501/-Users-segfault-Documents-islanderhack2026-nesttrace/d3b35a95-6c20-406d-a05a-b2a287688b9a/scratchpad/worker/tests/fixtures/person-beach-320.jpg`. If neither is available, stop and ask the user.

`tests/fixtures/README.txt`:
```
person-beach-320.jpg

Source: "U.S. Fish and Wildlife Service biologist Jeff Phillips surveys along Arroyo Quemada Beach in Goleta,
California ..." (Photo by USFWS), a work of the U.S. federal government, public domain, via Wikimedia Commons:
https://commons.wikimedia.org/wiki/File:U.S._Fish_and_Wildlife_Service_biologist_Jeff_Phillips_surveys_along_Arroyo_Quemada_Beach_in_Goleta,_California_to_assess_damage_in_the_early_days_of_the_Refugio_oil_spill._Photo_by_USFWS._(18748816712).jpg

Made from the 960x720 thumbnail (SHA-256 41e2ee31d6c15976c334d08f15ec51d03dfb3320b0c688031618f13153922e27) with
cv2.resize(picture, (320, 240), interpolation=cv2.INTER_AREA) and cv2.imwrite(..., [cv2.IMWRITE_JPEG_QUALITY, 90])
(opencv-python-headless 5.0.0.93). SHA-256 of this file: b28e927737026ff66e666e1011952adf0efadda119c335143b7c9b84d6fc2ae2.
Used only by the worker tests (one person, YOLOX-nano score about 0.85).
```

- [ ] **Step 2: Failing tests**

`tests/test_detector.py`. Crafted output tensors pin the decode exactly, and the real model on the fixture pins the whole path:
```python
import hashlib

import cv2
import numpy as np
import pytest

from nesttrace_worker.detector import ANCHORS, Box, PersonDetector, decode, is_dark, letterbox, to_blob

from tests.helpers import FIXTURE_SHA256, FIXTURES, MODEL_SHA256


def raw_with(*cells: tuple[int, float, float, float, float, float, float]) -> np.ndarray:
    """A (1, 3549, 85) output: zeros except the given anchors (index, dx, dy, log_w, log_h, objectness, person)."""
    raw = np.zeros((1, ANCHORS, 85), dtype=np.float32)
    raw[0, :, 2:4] = -10.0
    for index, dx, dy, lw, lh, obj, person in cells:
        raw[0, index, :6] = (dx, dy, lw, lh, obj, person)
    return raw


def test_letterbox_pads_bottom_right_with_114_and_keeps_bgr():
    picture = np.zeros((240, 320, 3), dtype=np.uint8)
    picture[:, :, 0] = 200  # blue channel
    padded, ratio = letterbox(picture)
    assert padded.shape == (416, 416, 3)
    assert ratio == pytest.approx(1.3)
    assert padded[0, 0].tolist() == [200, 0, 0]
    assert padded[311, 415].tolist() == [200, 0, 0]
    assert padded[312, 0].tolist() == [114, 114, 114]
    blob = to_blob(padded)
    assert blob.shape == (1, 3, 416, 416) and blob.dtype == np.float32
    assert blob.max() == 200.0  # no normalisation


def test_decode_uses_grid_and_strides():
    # Stride-8 grid is 52x52 (anchors 0..2703), stride 16 is 26x26 (2704..3379), stride 32 is 13x13 (3380..3548).
    index = 2704 + 10 * 26 + 5  # stride 16, cell x=5, y=10
    raw = raw_with((index, 0.5, 0.5, np.log(4.0), np.log(8.0), 0.9, 0.9))
    boxes = decode(raw, ratio=1.0, width=416, height=416)
    assert boxes == [Box(56.0, 104.0, 64.0, 128.0, 0.81)]


def test_decode_maps_back_through_the_ratio_and_clips():
    index = 3380 + 0 * 13 + 0  # stride 32, top-left cell; box hangs off the picture
    raw = raw_with((index, 0.0, 0.0, np.log(4.0), np.log(4.0), 1.0, 0.8))
    [box] = decode(raw, ratio=1.3, width=320, height=240)
    assert (box.x, box.y) == (0.0, 0.0)
    assert box.w == pytest.approx(64 / 1.3, abs=0.1) and box.h == pytest.approx(64 / 1.3, abs=0.1)


def test_decode_thresholds_nms_and_min_size():
    base = 2704 + 10 * 26 + 5
    raw = raw_with(
        (base, 0.5, 0.5, np.log(4.0), np.log(8.0), 0.9, 0.9),       # 0.81 kept
        (base + 1, 0.0, 0.5, np.log(4.0), np.log(8.0), 0.9, 0.8),   # 0.72, IoU 0.78 with the first (> 0.45): suppressed
        (base + 10, 0.5, 0.5, np.log(4.0), np.log(8.0), 0.6, 0.6),  # 0.36 < 0.40: dropped
        (100, 0.5, 0.5, np.log(1.5), np.log(1.5), 1.0, 1.0),        # 12x12 px = 0.08% of 416x416: too small
    )
    assert [box.score for box in decode(raw, 1.0, 416, 416)] == [0.81]


def test_decode_refuses_another_output_shape():
    with pytest.raises(ValueError):
        decode(np.zeros((1, 3549, 6), dtype=np.float32), 1.0, 416, 416)


def test_dark_frames():
    assert is_dark(np.full((240, 320, 3), 24, dtype=np.uint8))
    assert not is_dark(np.full((240, 320, 3), 25, dtype=np.uint8))


def test_model_file_is_the_pinned_release(model_path):
    with open(model_path, 'rb') as handle:
        assert hashlib.sha256(handle.read()).hexdigest() == MODEL_SHA256


def test_person_found_in_the_fixture(model_path):
    data = (FIXTURES / 'person-beach-320.jpg').read_bytes()
    assert hashlib.sha256(data).hexdigest() == FIXTURE_SHA256
    picture = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    net = cv2.dnn.readNetFromONNX(model_path)
    padded, _ = letterbox(picture)
    net.setInput(to_blob(padded))
    assert net.forward().shape == (1, 3549, 85)
    [person] = PersonDetector(model_path).detect(picture)
    assert person.score >= 0.80
    assert person.x == pytest.approx(194, abs=6) and person.y == pytest.approx(104, abs=6)
    assert person.w == pytest.approx(31, abs=6) and person.h == pytest.approx(86, abs=6)
```
Notes on the crafted cells: anchors are ordered stride 8 (52×52, indices 0–2703), stride 16 (26×26, 2704–3379), stride 32 (13×13, 3380–3548), row-major (`y × n + x`). Cell (5, 10) at stride 16 with d = 0.5 has its centre at (88, 168), and `exp(log 4) × 16 = 64` wide and `exp(log 8) × 16 = 128` tall, so the box is (56, 104, 64, 128) with score 0.9 × 0.9 = 0.81.

Run: `cd dashboard/worker && .venv/bin/pytest -q tests/test_detector.py`
Expected: FAIL (`nesttrace_worker.detector` missing).

- [ ] **Step 3: Implement `nesttrace_worker/detector.py`**

```python
from dataclasses import dataclass

import cv2
import numpy as np

INPUT_SIZE = 416
STRIDES = (8, 16, 32)
ANCHORS = sum((INPUT_SIZE // stride) ** 2 for stride in STRIDES)  # 3549
CLASSES = 80
PERSON_CLASS = 0
PAD_VALUE = 114
PERSON_MIN_SCORE = 0.40
NMS_IOU = 0.45
MIN_BOX_FRACTION = 0.01
DARK_MEAN = 25.0


@dataclass(frozen=True)
class Box:
    x: float
    y: float
    w: float
    h: float
    score: float


def is_dark(bgr: np.ndarray) -> bool:
    """Mean brightness below 25/255: too dark to detect anything."""
    return float(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).mean()) < DARK_MEAN


def letterbox(bgr: np.ndarray) -> tuple[np.ndarray, float]:
    """YOLOX demo pre-processing: scale to fit 416x416 keeping aspect, pad bottom/right with 114, BGR, no normalisation."""
    height, width = bgr.shape[:2]
    ratio = min(INPUT_SIZE / height, INPUT_SIZE / width)
    padded = np.full((INPUT_SIZE, INPUT_SIZE, 3), PAD_VALUE, dtype=np.uint8)
    new_w, new_h = int(width * ratio), int(height * ratio)
    padded[:new_h, :new_w] = cv2.resize(bgr, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    return padded, ratio


def to_blob(padded: np.ndarray) -> np.ndarray:
    """HWC uint8 BGR -> NCHW float32, values 0-255."""
    return np.ascontiguousarray(padded.transpose(2, 0, 1)[None], dtype=np.float32)


def _grid() -> tuple[np.ndarray, np.ndarray]:
    cells, strides = [], []
    for stride in STRIDES:
        n = INPUT_SIZE // stride
        ys, xs = np.meshgrid(np.arange(n), np.arange(n), indexing='ij')
        cells.append(np.stack((xs, ys), axis=2).reshape(-1, 2))
        strides.append(np.full((n * n, 1), stride))
    return np.concatenate(cells).astype(np.float32), np.concatenate(strides).astype(np.float32)


GRID, GRID_STRIDES = _grid()


def decode(raw: np.ndarray, ratio: float, width: int, height: int) -> list[Box]:
    """raw: (1, 3549, 85) model output -> person boxes in picture pixels (score >= 0.40, NMS 0.45, >= 1% of the picture)."""
    if raw.shape != (1, ANCHORS, 5 + CLASSES):
        raise ValueError(f'unexpected YOLOX output shape {raw.shape}')
    out = raw[0]
    centres = (out[:, :2] + GRID) * GRID_STRIDES
    sizes = np.exp(out[:, 2:4]) * GRID_STRIDES
    scores = out[:, 4] * out[:, 5 + PERSON_CLASS]
    keep = scores >= PERSON_MIN_SCORE
    if not keep.any():
        return []
    xywh = np.concatenate((centres - sizes / 2, sizes), axis=1)[keep] / ratio
    kept_scores = scores[keep]
    # Clip to the picture before the size check, so a box hanging off the edge is measured by what is visible.
    x0 = np.clip(xywh[:, 0], 0, width)
    y0 = np.clip(xywh[:, 1], 0, height)
    x1 = np.clip(xywh[:, 0] + xywh[:, 2], 0, width)
    y1 = np.clip(xywh[:, 1] + xywh[:, 3], 0, height)
    boxes = np.stack((x0, y0, x1 - x0, y1 - y0), axis=1)
    picked = cv2.dnn.NMSBoxes(boxes.tolist(), kept_scores.tolist(), PERSON_MIN_SCORE, NMS_IOU)
    min_area = MIN_BOX_FRACTION * width * height
    result = []
    for index in np.array(picked, dtype=int).reshape(-1):
        x, y, w, h = (float(v) for v in boxes[index])
        if w * h >= min_area:
            result.append(Box(round(x, 1), round(y, 1), round(w, 1), round(h, 1), round(float(kept_scores[index]), 2)))
    return sorted(result, key=lambda box: -box.score)


class PersonDetector:
    def __init__(self, model_path: str):
        self.net = cv2.dnn.readNetFromONNX(model_path)

    def detect(self, bgr: np.ndarray) -> list[Box]:
        padded, ratio = letterbox(bgr)
        self.net.setInput(to_blob(padded))
        raw = self.net.forward()
        return decode(raw, ratio, bgr.shape[1], bgr.shape[0])
```

- [ ] **Step 4: Run and commit**

```bash
cd dashboard/worker && .venv/bin/pytest -q          # 16 passed
cd ../.. && git add dashboard/worker/nesttrace_worker/detector.py dashboard/worker/tests/test_detector.py \
  dashboard/worker/tests/fixtures/person-beach-320.jpg dashboard/worker/tests/fixtures/README.txt
git status --short
git commit -m "feat(dashboard): YOLOX-nano person detection with the official pre-processing, grid decode and NMS"
```

---

### Task 4: Tracker, possible-turtle rule, per-device pipeline, the worker service in Compose

**Files:**
- Create: `dashboard/worker/nesttrace_worker/tracker.py`, `dashboard/worker/nesttrace_worker/turtle.py`, `dashboard/worker/nesttrace_worker/device.py`, `dashboard/worker/nesttrace_worker/main.py`, `dashboard/worker/tests/test_tracker.py`, `dashboard/worker/tests/test_turtle.py`, `dashboard/worker/tests/test_device.py`
- Modify: `dashboard/docker-compose.yml`

**Interfaces:**
- Consumes: `Box`, `is_dark`, `PersonDetector` (Task 3); `InternalApi`, `Scheduler`, `LOOP_MS`, `load_config` (Task 2).
- Produces:
  - `tracker.py`: `MATCH_IOU = 0.3`, `END_AFTER_MS = 3000`, `TRAIL_MS = 30000`, `TRAIL_POINTS = 60`; `Rect`; `iou(a, b)`; `hungarian(cost) -> list[(row, col)]`; `Track(key, label, box, score, first_ms, last_ms, points, name)` with `add()`; `Tracker(label).update(boxes, scores, at_ms) -> list[Track]` (in box order).
  - `turtle.py`: `MIN_ASPECT = 1.3`, `MIN_AREA = 0.003`, `MAX_AREA = 0.15`, `MAX_SPEED = 0.08`, `SUSTAIN_MS = 3000`, `SPEED_SPAN_MS = 1000`, `MAX_PERSON_IOU = 0.1`, `MOG2_HISTORY = 120`, `MOG2_VAR_THRESHOLD = 25`, `LEARNING_RATE = 1/120`; `MovingBlobs().boxes(bgr)`; `blob_shape_ok(box, width, height, persons)`; `is_possible_turtle(track, shape_ok_since_ms, width)`.
  - `device.py`: `PERSON = 'person'`, `POSSIBLE_TURTLE = 'possible turtle'`; `DevicePipeline(detect_people).process(bgr, at_ms) -> { at, dark, width, height, objects, trails }`, the exact body Task 1's `parseDetections` accepts.
  - `main.py`: `run()`; `python -m nesttrace_worker.main` is the image command.

- [ ] **Step 1: Failing tests**

`tests/test_tracker.py`:
```python
import itertools

import numpy as np
import pytest

from nesttrace_worker.tracker import END_AFTER_MS, TRAIL_POINTS, Tracker, hungarian, iou


def brute_force(cost: np.ndarray) -> float:
    rows, cols = cost.shape
    if rows <= cols:
        return min(sum(cost[r, c] for r, c in zip(range(rows), perm)) for perm in itertools.permutations(range(cols), rows))
    return brute_force(cost.T)


def test_iou():
    assert iou((0, 0, 10, 10), (0, 0, 10, 10)) == 1.0
    assert iou((0, 0, 10, 10), (5, 0, 10, 10)) == pytest.approx(50 / 150)
    assert iou((0, 0, 10, 10), (10, 0, 10, 10)) == 0.0


@pytest.mark.parametrize('shape', [(1, 1), (3, 3), (2, 5), (5, 2), (6, 6)])
def test_hungarian_is_optimal(shape):
    rng = np.random.default_rng(7)
    for _ in range(20):
        cost = rng.random(shape)
        pairs = hungarian(cost)
        assert len(pairs) == min(shape)
        assert len({r for r, _ in pairs}) == len({c for _, c in pairs}) == len(pairs)
        assert sum(cost[r, c] for r, c in pairs) == pytest.approx(brute_force(cost))


def test_ids_stay_with_their_objects_when_they_cross_order():
    tracker = Tracker('person')
    a, b = tracker.update([(0, 0, 20, 40), (100, 0, 20, 40)], [0.9, 0.8], 0)
    # Same objects, listed the other way round and moved a little.
    second = tracker.update([(104, 2, 20, 40), (3, 1, 20, 40)], [0.8, 0.9], 500)
    assert [t.key for t in second] == [b.key, a.key]


def test_same_label_only_and_low_iou_starts_a_new_track():
    tracker = Tracker('person')
    [first] = tracker.update([(0, 0, 20, 40)], [0.9], 0)
    [moved] = tracker.update([(15, 0, 20, 40)], [0.9], 500)  # IoU 5/35 < 0.3
    assert moved.key != first.key


def test_track_ends_after_three_seconds_unseen():
    tracker = Tracker('person')
    [first] = tracker.update([(0, 0, 20, 40)], [0.9], 0)
    [same] = tracker.update([(0, 0, 20, 40)], [0.9], END_AFTER_MS)
    assert same.key == first.key
    [new] = tracker.update([(0, 0, 20, 40)], [0.9], 2 * END_AFTER_MS + 1)
    assert new.key != first.key


def test_trail_keeps_30_seconds_and_at_most_60_points():
    tracker = Tracker('person')
    for i in range(200):
        [track] = tracker.update([(i * 0.1, 0, 20, 40)], [0.9], i * 250)  # 4 per second for 50 s
    assert len(track.points) == TRAIL_POINTS
    assert track.points[-1][0] - track.points[0][0] <= 30_000
    assert track.points[-1] == (199 * 250, pytest.approx(199 * 0.1 + 10, abs=0.06), 20.0)
```
`tests/test_turtle.py` (synthetic sand with noise, a 10 s background warm-up, then a dark rectangle moving at 2 frames/s):
```python
import numpy as np
import pytest

from nesttrace_worker.detector import Box
from nesttrace_worker.device import DevicePipeline

W, H = 320, 240
STEP_MS = 500  # the worker's 2 frames/s


def sand(rng: np.random.Generator) -> np.ndarray:
    picture = np.full((H, W, 3), (150, 170, 190), dtype=np.int16)
    picture += rng.integers(-3, 4, size=(H, W, 1), dtype=np.int16)
    return picture.clip(0, 255).astype(np.uint8)


def run(width: int, height: int, speed_px_s: float, seconds: float = 8, people=lambda at: [], start=(40, 120)) -> list[dict]:
    """Warm the background up for 10 s, then move a dark rectangle; returns the payloads after it appears."""
    rng = np.random.default_rng(3)
    pipeline = DevicePipeline(lambda bgr: people(current[0]))
    current = [0]
    for i in range(20):
        current[0] = i * STEP_MS
        pipeline.process(sand(rng), current[0])
    payloads = []
    for i in range(int(seconds * 1000 / STEP_MS)):
        at = 10_000 + i * STEP_MS
        current[0] = at
        picture = sand(rng)
        x = int(start[0] + speed_px_s * i * STEP_MS / 1000)
        picture[start[1]:start[1] + height, x:x + width] = (60, 70, 80)
        payloads.append(pipeline.process(picture, at))
    return payloads


def turtles(payload: dict) -> list[dict]:
    return [o for o in payload['objects'] if o['label'] == 'possible turtle']


def test_wide_slow_blob_becomes_a_possible_turtle_after_3_s():
    payloads = run(48, 24, speed_px_s=8)  # 2.5% of the width per second, 1.5% of the picture
    first = next(i for i, p in enumerate(payloads) if turtles(p))
    assert 3_000 <= first * STEP_MS <= 4_500
    assert all(turtles(p) for p in payloads[first:])
    [turtle] = turtles(payloads[-1])
    assert turtle['track'] == 'T1' and 'score' not in turtle
    [trail] = [t for t in payloads[-1]['trails'] if t['track'] == 'T1']
    assert trail['label'] == 'possible turtle' and len(trail['points']) >= 8


@pytest.mark.parametrize('case,width,height,speed', [
    ('tall', 24, 48, 8),
    ('fast', 48, 24, 40),        # 12.5% of the width per second
    ('tiny', 12, 6, 4),          # 0.09% of the picture
    ('huge', 240, 120, 4),       # 37.5% of the picture
])
def test_rule_rejects(case, width, height, speed):
    payloads = run(width, height, speed_px_s=speed, start=(10, 60) if case == 'huge' else (40, 120))
    assert not any(turtles(p) for p in payloads), case


def test_blob_on_a_person_is_not_a_turtle():
    def person(at):
        x = int(40 + 8 * (at - 10_000) / 1000) if at >= 10_000 else -1
        return [Box(x, 120, 48, 24, 0.9)] if x >= 0 else []
    payloads = run(48, 24, speed_px_s=8, people=person)
    assert not any(turtles(p) for p in payloads)
    assert payloads[-1]['objects'][0]['label'] == 'person'


def test_dark_frames_detect_nothing():
    pipeline = DevicePipeline(lambda bgr: pytest.fail('person detection must be skipped in the dark'))
    payload = pipeline.process(np.full((H, W, 3), 10, dtype=np.uint8), 1_000)
    assert payload == {'at': 1_000, 'dark': True, 'width': W, 'height': H, 'objects': [], 'trails': []}
```
`tests/test_device.py`:
```python
import cv2

from nesttrace_worker.detector import PersonDetector
from nesttrace_worker.device import DevicePipeline
from tests.helpers import FIXTURES


def test_person_keeps_one_track_and_a_trail(model_path):
    picture = cv2.imread(str(FIXTURES / 'person-beach-320.jpg'))
    pipeline = DevicePipeline(PersonDetector(model_path).detect)
    for i in range(5):
        payload = pipeline.process(picture, 1_000 + i * 500)
    [person] = payload['objects']
    assert person['track'] == 'P1' and person['label'] == 'person' and person['score'] >= 0.80
    [trail] = payload['trails']
    assert trail['track'] == 'P1' and [p[0] for p in trail['points']] == [1_000, 1_500, 2_000, 2_500, 3_000]
```
Run: `cd dashboard/worker && .venv/bin/pytest -q`
Expected: FAIL (modules missing).

- [ ] **Step 2: Implement**

`nesttrace_worker/tracker.py`:
```python
from dataclasses import dataclass, field

import numpy as np

MATCH_IOU = 0.3
END_AFTER_MS = 3_000
TRAIL_MS = 30_000
TRAIL_POINTS = 60

Rect = tuple[float, float, float, float]  # x, y, w, h in picture pixels


def iou(a: Rect, b: Rect) -> float:
    ax1, ay1, bx1, by1 = a[0] + a[2], a[1] + a[3], b[0] + b[2], b[1] + b[3]
    w = min(ax1, bx1) - max(a[0], b[0])
    h = min(ay1, by1) - max(a[1], b[1])
    if w <= 0 or h <= 0:
        return 0.0
    inter = w * h
    return inter / (a[2] * a[3] + b[2] * b[3] - inter)


def hungarian(cost: np.ndarray) -> list[tuple[int, int]]:
    """Minimum-cost assignment for a rectangular cost matrix (Kuhn-Munkres with potentials, O(n^3)). Returns (row, col) pairs."""
    rows, cols = cost.shape
    if rows == 0 or cols == 0:
        return []
    transposed = rows > cols
    matrix = cost.T if transposed else cost
    n, m = matrix.shape  # n <= m
    u = np.zeros(n + 1)
    v = np.zeros(m + 1)
    owner = np.zeros(m + 1, dtype=int)  # owner[j] = row (1-based) assigned to column j
    way = np.zeros(m + 1, dtype=int)
    for i in range(1, n + 1):
        owner[0] = i
        j0 = 0
        minv = np.full(m + 1, np.inf)
        used = np.zeros(m + 1, dtype=bool)
        while True:
            used[j0] = True
            i0 = owner[j0]
            delta, j1 = np.inf, 0
            for j in range(1, m + 1):
                if not used[j]:
                    current = matrix[i0 - 1, j - 1] - u[i0] - v[j]
                    if current < minv[j]:
                        minv[j], way[j] = current, j0
                    if minv[j] < delta:
                        delta, j1 = minv[j], j
            for j in range(m + 1):
                if used[j]:
                    u[owner[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if owner[j0] == 0:
                break
        while True:
            j1 = way[j0]
            owner[j0] = owner[j1]
            j0 = j1
            if j0 == 0:
                break
    pairs = [(owner[j] - 1, j - 1) for j in range(1, m + 1) if owner[j] != 0]
    return sorted((c, r) for r, c in pairs) if transposed else sorted(pairs)


@dataclass
class Track:
    key: int
    label: str
    box: Rect
    score: float | None
    first_ms: int
    last_ms: int
    points: list[tuple[int, float, float]] = field(default_factory=list)
    name: str | None = None  # 'P3' / 'T1'; None until the track is shown

    def add(self, box: Rect, score: float | None, at_ms: int) -> None:
        self.box, self.score, self.last_ms = box, score, at_ms
        self.points.append((at_ms, round(box[0] + box[2] / 2, 1), round(box[1] + box[3] / 2, 1)))
        self.points = [p for p in self.points if at_ms - p[0] <= TRAIL_MS][-TRAIL_POINTS:]


class Tracker:
    """Frame-to-frame matching for one device and one label: IoU >= 0.3, Hungarian on 1 - IoU; a track ends after 3 s unseen."""

    def __init__(self, label: str):
        self.label = label
        self.tracks: list[Track] = []
        self._next_key = 1

    def update(self, boxes: list[Rect], scores: list[float | None], at_ms: int) -> list[Track]:
        """Returns the tracks seen in this frame, in the order of `boxes`."""
        self.tracks = [t for t in self.tracks if at_ms - t.last_ms <= END_AFTER_MS]
        seen: list[Track | None] = [None] * len(boxes)
        if self.tracks and boxes:
            cost = np.array([[1.0 - iou(t.box, b) for b in boxes] for t in self.tracks])
            for row, col in hungarian(cost):
                if 1.0 - cost[row, col] >= MATCH_IOU:
                    self.tracks[row].add(boxes[col], scores[col], at_ms)
                    seen[col] = self.tracks[row]
        for col, box in enumerate(boxes):
            if seen[col] is None:
                track = Track(self._next_key, self.label, box, scores[col], at_ms, at_ms)
                self._next_key += 1
                track.add(box, scores[col], at_ms)
                self.tracks.append(track)
                seen[col] = track
        return [t for t in seen if t is not None]
```
`nesttrace_worker/turtle.py`:
```python
import cv2
import numpy as np

from .tracker import Rect, Track, iou

MIN_ASPECT = 1.3          # width / height
MIN_AREA = 0.003          # 0.3% of the picture
MAX_AREA = 0.15           # 15% of the picture
MAX_SPEED = 0.08          # picture widths per second
SUSTAIN_MS = 3_000
SPEED_SPAN_MS = 1_000     # speed is measured over about one second, so box jitter between frames does not count
MAX_PERSON_IOU = 0.1
MOG2_HISTORY = 120        # frames (about 60 s at 2 frames/s)
MOG2_VAR_THRESHOLD = 25
# Fixed learning rate: OpenCV's automatic rate starts at 1/frames-seen, which soaks a slow blob into the background within a few frames.
LEARNING_RATE = 1 / MOG2_HISTORY


class MovingBlobs:
    """Per-device background subtraction (MOG2, shadows ignored) -> bounding boxes of moving areas."""

    def __init__(self):
        self.subtractor = cv2.createBackgroundSubtractorMOG2(history=MOG2_HISTORY, varThreshold=MOG2_VAR_THRESHOLD, detectShadows=True)
        self.open_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        self.close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))

    def boxes(self, bgr: np.ndarray) -> list[Rect]:
        mask = self.subtractor.apply(bgr, learningRate=LEARNING_RATE)
        mask = np.where(mask == 255, 255, 0).astype(np.uint8)  # 127 = shadow: ignored
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, self.open_kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, self.close_kernel)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        return [tuple(float(v) for v in cv2.boundingRect(contour)) for contour in contours]


def blob_shape_ok(box: Rect, width: int, height: int, persons: list[Rect]) -> bool:
    """Wider than tall, 0.3-15% of the picture, and not on a person (IoU < 0.1 with every person box)."""
    x, y, w, h = box
    if h <= 0 or w / h < MIN_ASPECT:
        return False
    area = (w * h) / (width * height)
    if not MIN_AREA <= area <= MAX_AREA:
        return False
    return all(iou(box, person) < MAX_PERSON_IOU for person in persons)


def is_possible_turtle(track: Track, shape_ok_since_ms: int | None, width: int) -> bool:
    """A blob track that kept the shape rule for the last 3 s and, over every 1 s span ending in those 3 s, moved < 8% of the picture width per second."""
    now = track.last_ms
    if shape_ok_since_ms is None or now - shape_ok_since_ms < SUSTAIN_MS:
        return False
    spans = 0
    for t, x, y in track.points:
        if now - t > SUSTAIN_MS:
            continue
        earlier = [p for p in track.points if t - p[0] >= SPEED_SPAN_MS]
        if not earlier:
            continue
        t0, x0, y0 = earlier[-1]
        if np.hypot(x - x0, y - y0) / ((t - t0) / 1000) >= MAX_SPEED * width:
            return False
        spans += 1
    return spans > 0
```
`nesttrace_worker/device.py`:
```python
import numpy as np

from .detector import Box, is_dark
from .tracker import Rect, Track, Tracker
from .turtle import MovingBlobs, blob_shape_ok, is_possible_turtle

PERSON = 'person'
POSSIBLE_TURTLE = 'possible turtle'


class DevicePipeline:
    """Everything one device needs between frames: its background model and its two trackers."""

    def __init__(self, detect_people):
        self.detect_people = detect_people  # callable(bgr) -> list[Box]
        self.blobs = MovingBlobs()
        self.people = Tracker(PERSON)
        self.candidates = Tracker('blob')
        self.rule_since: dict[int, int] = {}
        self.person_count = 0
        self.turtle_count = 0

    def _name_person(self, track: Track) -> None:
        if track.name is None:
            self.person_count += 1
            track.name = f'P{self.person_count}'

    def _name_turtle(self, track: Track) -> None:
        if track.name is None:
            self.turtle_count += 1
            track.name = f'T{self.turtle_count}'

    def process(self, bgr: np.ndarray, at_ms: int) -> dict:
        height, width = bgr.shape[:2]
        objects = []
        dark = is_dark(bgr)
        if not dark:
            found: list[Box] = self.detect_people(bgr)
            person_boxes: list[Rect] = [(b.x, b.y, b.w, b.h) for b in found]
            for track in self.people.update(person_boxes, [b.score for b in found], at_ms):
                self._name_person(track)
                objects.append({'track': track.name, 'label': PERSON, 'score': track.score, 'box': list(track.box)})
            blob_boxes = self.blobs.boxes(bgr)
            for track in self.candidates.update(blob_boxes, [None] * len(blob_boxes), at_ms):
                if blob_shape_ok(track.box, width, height, person_boxes):
                    self.rule_since.setdefault(track.key, at_ms)
                else:
                    self.rule_since.pop(track.key, None)
                if is_possible_turtle(track, self.rule_since.get(track.key), width):
                    self._name_turtle(track)
                    objects.append({'track': track.name, 'label': POSSIBLE_TURTLE, 'box': list(track.box)})
            alive = {t.key for t in self.candidates.tracks}
            self.rule_since = {key: since for key, since in self.rule_since.items() if key in alive}
        trails = [
            {'track': t.name, 'label': t.label if t.label == PERSON else POSSIBLE_TURTLE, 'points': [list(p) for p in t.points]}
            for t in [*self.people.tracks, *self.candidates.tracks]
            if t.name is not None and at_ms - t.last_ms <= 3_000
        ]
        return {'at': at_ms, 'dark': dark, 'width': width, 'height': height, 'objects': objects, 'trails': trails}
```
`nesttrace_worker/main.py`:
```python
import logging
import time

import httpx

from .api import InternalApi
from .config import load_config
from .detector import PersonDetector
from .device import DevicePipeline
from .scheduler import LOOP_MS, Scheduler

ERROR_BACKOFF_S = 2.0

log = logging.getLogger('nesttrace.worker')


def run() -> None:
    logging.basicConfig(level=logging.INFO, format='%(asctime)s worker %(message)s')
    config = load_config()
    detector = PersonDetector(config.model_path)
    api = InternalApi(config.web_url, config.token)
    scheduler = Scheduler(api, lambda: DevicePipeline(detector.detect))
    log.info('live detection on; web at %s', config.web_url)
    while True:
        started = time.monotonic()
        try:
            scheduler.tick()
        except httpx.HTTPStatusError as error:
            status = error.response.status_code
            log.warning('web answered %s%s; retrying in %.0f s', status, ' (worker token refused)' if status == 401 else '', ERROR_BACKOFF_S)
            time.sleep(ERROR_BACKOFF_S)
            continue
        except httpx.HTTPError as error:
            # Never logs the token or frame data: only the error class and status.
            log.warning('web not reachable (%s); retrying in %.0f s', type(error).__name__, ERROR_BACKOFF_S)
            time.sleep(ERROR_BACKOFF_S)
            continue
        time.sleep(max(0.0, LOOP_MS / 1000 - (time.monotonic() - started)))


if __name__ == '__main__':
    run()
```

- [ ] **Step 3: Compose service on an internal network**

`dashboard/docker-compose.yml`:
- `web`: add
```yaml
    networks:
      - default
      - internal
```
- new service after `web`:
```yaml
  # People and possible-turtle detection on live frames (spec 2026-10-10-live-detection-design.md). No published ports;
  # the internal network has no route out, so frames and results never leave the laptop.
  worker:
    build: ./worker
    environment:
      WEB_URL: http://web:3000
      WORKER_TOKEN: ${WORKER_TOKEN:-}
    networks:
      - internal
    depends_on:
      - web
    restart: unless-stopped
```
- top level, after `volumes:`:
```yaml
networks:
  internal:
    internal: true
```
The worker gets only `WEB_URL` and `WORKER_TOKEN` (Compose reads `WORKER_TOKEN` from `dashboard/.env` for interpolation). It never sees `AUTH_SECRET`, the database or the media volumes. `web` already gets `WORKER_TOKEN` through `env_file: .env`.

- [ ] **Step 4: Run, build, commit**

```bash
cd dashboard/worker && .venv/bin/pytest -q                                   # 34 passed
cd .. && grep -Eq '^WORKER_TOKEN=.+' .env || echo "WORKER_TOKEN=$(openssl rand -hex 32)" >> .env   # local only, never staged
docker compose build worker                                                  # fails if the model hash differs
docker compose run --rm --no-deps worker python -m pytest -q                 # 34 passed inside the image
docker compose up -d --build && docker compose logs --tail 5 worker          # "live detection on; web at http://web:3000"
docker compose exec -T worker python -c "import urllib.request; urllib.request.urlopen('https://github.com', timeout=5)" ; echo "exit=$?"   # must fail: no route out
cd .. && git add dashboard/docker-compose.yml dashboard/worker/nesttrace_worker/tracker.py dashboard/worker/nesttrace_worker/turtle.py \
  dashboard/worker/nesttrace_worker/device.py dashboard/worker/nesttrace_worker/main.py dashboard/worker/tests/test_tracker.py \
  dashboard/worker/tests/test_turtle.py dashboard/worker/tests/test_device.py
git status --short
git commit -m "feat(dashboard): possible-turtle rule, IoU tracker with trails, and the worker service on an internal network"
```
(If `.env` had `WORKER_TOKEN=` empty, delete that empty line first so the `grep` check adds one value only.)

---

### Task 5: Camera-level danger alert (server and existing danger UI)

**Files:**
- Create: `dashboard/web/prisma/migrations/20261010150000_camera_level_danger/migration.sql`, `dashboard/web/src/lib/detections/cameraDanger.ts`, `dashboard/web/tests/unit/cameraDanger.test.ts`, `dashboard/web/tests/integration/live-detection.test.ts`
- Modify: `dashboard/web/prisma/schema.prisma`, `dashboard/web/src/lib/types.ts`, `dashboard/web/src/lib/danger.ts`, `dashboard/web/src/lib/detections/http.ts`, `dashboard/web/src/server/snapshot.ts`, `dashboard/web/src/lib/live/importChunk.ts`, `dashboard/web/src/lib/sim/importRun.ts`, `dashboard/web/src/features/map/playback.ts`, `dashboard/web/src/features/alerts/DangerCards.tsx`, `dashboard/web/src/features/alerts/AlertsFeed.tsx`, `dashboard/web/src/features/sites/SiteDrawer.tsx`, `dashboard/web/src/features/map/MapView.tsx`, `dashboard/web/tests/unit/internal-routes.test.ts`, `dashboard/web/tests/unit/snapshot.test.ts`, `dashboard/web/tests/unit/playback.test.ts`, `dashboard/web/tests/unit/dangerFeed.test.tsx`, `dashboard/web/tests/unit/siteDrawer.test.tsx`

**Interfaces:**
- Consumes: `DetectionsView` (T1), `summarizeSite` (`src/lib/sites/summary.ts`), `addSiteEvent` (resolve path, unchanged), `publishChange`, `resolveDanger` (client).
- Produces:
  - `cameraDanger.ts`: `CAMERA_DANGER_MIN_TRACK_MS = 2000`, `CAMERA_DANGER_MIN_SCORE = 0.5`, `CAMERA_DANGER_REPEAT_MS = 600000`, `CAMERA_DANGER_LOG_EVERY_MS = 60000`, `CAMERA_DANGER_AUTHOR = 'Camera'`; `cameraDangerMessage(code)`; `cameraDangerNote(code, track, sites, zone)`; `type CameraDangerResult = 'none' | 'raised' | 'logged'`; `qualifyingPerson(detections): { track: string; score: number } | null`; `raiseCameraDanger(prisma, deviceId, detections, now: Date): Promise<CameraDangerResult>`.
  - `danger.ts`: `CAMERA_DANGER_LABEL = 'Camera alert · person detected (not measured distance)'`; `isCameraDanger(alert: { kind: string; siteId: string | null; videoId: string | null }): boolean`.
  - `types.ts`: `AlertView.videoId: string | null`.
  - `playback.ts`: `alertKey(alert: { id: string; videoId: string | null; simRunId: string | null })`.
  - `DangerCards.tsx`: `CameraDangerCard({ danger, canResolve, onSelect, selected })`.
  - `http.ts`: `postInternalDetections` returns `{ stored: true, danger: CameraDangerResult }`.

- [ ] **Step 1: Migration**

`prisma/schema.prisma`, in `model Alert`:
```prisma
  /// Null only for camera-level DANGER alerts from live detection (no clip, no site).
  videoId               String?
  video                 Video?              @relation(fields: [videoId], references: [id], onDelete: Restrict)
```
`prisma/migrations/20261010150000_camera_level_danger/migration.sql`:
```sql
-- Camera-level DANGER alerts (live detection) have no video.
ALTER TABLE "Alert" ALTER COLUMN "videoId" DROP NOT NULL;

-- Only a camera-level danger (DANGER, no nest site) may lack a video.
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_video_unless_camera_danger" CHECK ("videoId" IS NOT NULL OR ("kind" = 'DANGER' AND "siteId" IS NULL));
```
Apply with `cd dashboard/web && npx prisma migrate dev` (with `docker compose up -d db`). It must apply this migration and then report the schema in sync, creating **no** further migration (`onDelete: Restrict` keeps the existing `Alert_videoId_fkey`; checked while writing this plan: `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma` prints an empty migration). Then `npm run db:test:prepare`.

- [ ] **Step 2: Failing tests**

`tests/unit/cameraDanger.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { cameraDangerMessage, cameraDangerNote, qualifyingPerson } from '@/lib/detections/cameraDanger';
import type { DetectionsView } from '@/lib/types';

const T = 1_760_000_000_000;
const result = (objects: DetectionsView['objects'], trails: DetectionsView['trails']): DetectionsView => ({ at: T, dark: false, width: 320, height: 240, objects, trails });
const person = (track: string, score: number) => ({ track, label: 'person' as const, score, box: [1, 2, 3, 4] as [number, number, number, number] });
const trail = (track: string, spanMs: number, label: 'person' | 'possible turtle' = 'person') => ({ track, label, points: [[T - spanMs, 1, 1], [T - spanMs / 2, 2, 1], [T, 3, 1]] as [number, number, number][] });

describe('camera danger rule', () =>
{
    it('needs a person seen for 2 s with score 0.50 in this result', () =>
    {
        expect(qualifyingPerson(result([person('P1', 0.5)], [trail('P1', 2_000)]))).toEqual({ track: 'P1', score: 0.5 });
        expect(qualifyingPerson(result([person('P1', 0.49)], [trail('P1', 5_000)]))).toBeNull();
        expect(qualifyingPerson(result([person('P1', 0.9)], [trail('P1', 1_999)]))).toBeNull();
        expect(qualifyingPerson(result([], [trail('P1', 5_000)]))).toBeNull();                      // trail only: not seen now
        expect(qualifyingPerson(result([{ track: 'T1', label: 'possible turtle', box: [1, 2, 3, 4] }], [trail('T1', 9_000, 'possible turtle')]))).toBeNull();
        expect(qualifyingPerson(result([person('P1', 0.9), person('P2', 0.6)], [trail('P1', 2_500), trail('P2', 8_000)]))).toEqual({ track: 'P2', score: 0.6 });
    });

    it('uses the exact wording', () =>
    {
        expect(cameraDangerMessage('A1')).toBe('Danger · person seen on camera A1 near active nest sites — check now');
        expect(cameraDangerNote('A1', 'P3', 2, 'A')).toBe('Person on camera A1 (track P3), 2 active unprotected site(s) in zone A');
    });
});
```

`tests/integration/live-detection.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@/lib/db';
import { postInternalDetections } from '@/lib/detections/http';
import { registerDevice } from '@/lib/phones/devices';
import { FrameStore } from '@/lib/phones/frameStore';
import { addSiteEvent } from '@/lib/sites/events';
import { loadMapSnapshot } from '@/server/snapshot';
import { seedDatabase } from '../../prisma/seed';

const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
const TOKEN = 'b'.repeat(64);
const T0 = Date.UTC(2026, 9, 10, 20, 0, 0);
const MESSAGE = 'Danger · person seen on camera A1 near active nest sites — check now';
let deviceId: string;
let adminId: string;
let cameraA1: { id: string; zoneId: string; lng: number; lat: number };
let store: FrameStore;
let clock: number;

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
    deviceId = (await registerDevice(prisma, adminId, 'Dune phone')).id;
    cameraA1 = await prisma.camera.update({ where: { code: 'A1' }, data: { liveDeviceId: deviceId }, select: { id: true, zoneId: true, lng: true, lat: true } });
    store = new FrameStore();
    clock = T0;
});
afterAll(async () => { await prisma.$disconnect(); });

const jpeg = () => { const body = Buffer.alloc(64, 7); body[0] = 0xff; body[1] = 0xd8; return body; };

// A nest site in camera A1's zone, logged as detected; `extra` adds person entries (protection, no nest).
async function site(extra: ('protectionInstalled' | 'noNestFound')[] = []): Promise<string>
{
    const video = await prisma.video.create({ data: { cameraId: cameraA1.id, source: 'SIMULATION', path: 'x.mp4', originalName: 'x.mp4' } });
    const alert = await prisma.alert.create({ data: { videoId: video.id, cameraId: cameraA1.id, zoneId: cameraA1.zoneId, kind: 'DIGGING', message: 'Digging activity detected; nesting unresolved.', startT: 1, endT: 2, lng: cameraA1.lng, lat: cameraA1.lat } });
    await prisma.siteEvent.create({ data: { alertId: alert.id, type: 'detected', author: 'Camera', at: new Date(T0 - 60_000) } });
    for (const type of extra)
    {
        await addSiteEvent(prisma, { alertId: alert.id, type, userId: adminId, author: 'Ad', at: new Date(T0 - 30_000) });
    }
    return alert.id;
}

// One worker result at `clock`, after a fresh frame from the device.
async function seen({ spanMs = 2_500, score = 0.82, track = 'P1', device = deviceId } = {}): Promise<string>
{
    store.put(device, jpeg(), clock);
    const body = { at: clock, dark: false, width: 320, height: 240, objects: [{ track, label: 'person', score, box: [194, 104, 31, 86] }], trails: [{ track, label: 'person', points: [[clock - spanMs, 209, 147], [clock, 210, 147]] }] };
    const response = await postInternalDetections({ prisma, store, token: TOKEN, now: () => clock }, device, new Request(`http://web:3000/api/internal/detections/${device}`, { method: 'POST', body: JSON.stringify(body), headers: { authorization: `Bearer ${TOKEN}` } }));
    expect(response.status).toBe(200);
    return ((await response.json()) as { danger: string }).danger;
}

const cameraDangers = () => prisma.alert.findMany({ where: { kind: 'DANGER', siteId: null }, include: { events: { orderBy: [{ at: 'asc' }, { createdAt: 'asc' }] } }, orderBy: { createdAt: 'asc' } });

describe('camera-level danger', () =>
{
    it('raises exactly one alert for a linked camera with an active unprotected site', async () =>
    {
        await site();
        expect(await seen()).toBe('raised');
        const [alert] = await cameraDangers();
        expect(alert).toMatchObject({ message: MESSAGE, level: 1, kind: 'DANGER', siteId: null, videoId: null, cameraId: cameraA1.id, zoneId: cameraA1.zoneId, lng: cameraA1.lng, lat: cameraA1.lat, status: 'NEW', simulated: false, score: null });
        expect(alert.events.map(event => [event.type, event.author, event.note, event.at.getTime()])).toEqual([['danger', 'Camera', 'Person on camera A1 (track P1), 1 active unprotected site(s) in zone A', T0]]);
    });

    it('raises nothing when the device is not linked to a map camera', async () =>
    {
        await site();
        await prisma.camera.update({ where: { id: cameraA1.id }, data: { liveDeviceId: null } });
        expect(await seen()).toBe('none');
        expect(await cameraDangers()).toEqual([]);
    });

    it('raises nothing without an active unprotected site in the zone', async () =>
    {
        expect(await seen()).toBe('none');
        await site(['protectionInstalled']);
        clock += 1_000;
        expect(await seen()).toBe('none');
        await site(['noNestFound']);
        clock += 1_000;
        expect(await seen()).toBe('none');
        expect(await cameraDangers()).toEqual([]);
    });

    it('raises nothing for a track under 2 s or a score under 0.50', async () =>
    {
        await site();
        expect(await seen({ spanMs: 1_999 })).toBe('none');
        clock += 1_000;
        expect(await seen({ score: 0.49 })).toBe('none');
        expect(await cameraDangers()).toEqual([]);
    });

    it('appends repeat sightings to the open alert at most once a minute', async () =>
    {
        await site();
        expect(await seen()).toBe('raised');
        clock += 30_000;
        expect(await seen({ track: 'P2' })).toBe('none');
        clock += 30_000;
        expect(await seen({ track: 'P2' })).toBe('logged');
        clock += 59_999;
        expect(await seen()).toBe('none');
        const [alert, ...more] = await cameraDangers();
        expect(more).toEqual([]);
        expect(alert.events.map(event => event.note)).toEqual([
            'Person on camera A1 (track P1), 1 active unprotected site(s) in zone A',
            'Person on camera A1 (track P2), 1 active unprotected site(s) in zone A',
        ]);
    });

    it('raises a new alert only after the previous one is resolved and 10 minutes have passed', async () =>
    {
        await site();
        expect(await seen()).toBe('raised');
        const [first] = await cameraDangers();
        clock += 120_000;
        await addSiteEvent(prisma, { alertId: first.id, type: 'dangerResolved', userId: adminId, author: 'Ad', at: new Date(clock) });
        const resolvedAt = clock;
        clock = resolvedAt + 5 * 60_000;
        expect(await seen()).toBe('none');
        clock = resolvedAt + 10 * 60_000 - 1;
        expect(await seen()).toBe('none');
        clock = resolvedAt + 10 * 60_000;
        expect(await seen()).toBe('raised');
        expect((await cameraDangers()).map(alert => alert.status)).toEqual(['REVIEWED', 'NEW']);
    });

    it('never creates two open alerts from concurrent results', async () =>
    {
        await site();
        store.put(deviceId, jpeg(), clock);
        const post = (at: number) =>
        {
            const body = { at, dark: false, width: 320, height: 240, objects: [{ track: 'P1', label: 'person', score: 0.9, box: [1, 2, 3, 4] }], trails: [{ track: 'P1', label: 'person', points: [[at - 3_000, 1, 1], [at, 2, 1]] }] };
            return postInternalDetections({ prisma, store, token: TOKEN, now: () => clock }, deviceId, new Request('http://web:3000/x', { method: 'POST', body: JSON.stringify(body), headers: { authorization: `Bearer ${TOKEN}` } }));
        };
        const results = await Promise.all([post(clock - 2), post(clock - 1), post(clock)]);
        expect(results.every(response => response.status === 200 || response.status === 409)).toBe(true);
        expect(await cameraDangers()).toHaveLength(1);
    });

    it('leaves outcomes and sites alone, shows in the snapshot, and resolving it touches no site', async () =>
    {
        const siteId = await site();
        const before = await loadMapSnapshot(prisma, new Date(T0));
        expect(await seen()).toBe('raised');
        const after = await loadMapSnapshot(prisma, new Date(T0));
        expect(after.outcomes).toEqual(before.outcomes);
        expect(after.dangerCount).toBe(before.dangerCount + 1);
        const camera = after.alerts.find(alert => alert.kind === 'DANGER' && alert.siteId === null)!;
        expect(camera).toMatchObject({ message: MESSAGE, videoId: null, simRunId: null, cameraCode: 'A1', zoneCode: 'A', level: 1, siteId: null });
        expect(after.alerts.find(alert => alert.id === siteId)?.site).toEqual(before.alerts.find(alert => alert.id === siteId)?.site);
        const siteEvents = await prisma.siteEvent.count({ where: { alertId: siteId } });
        await addSiteEvent(prisma, { alertId: camera.id, type: 'dangerResolved', userId: adminId, author: 'Ad', at: new Date(T0 + 1_000) });
        expect(await prisma.siteEvent.count({ where: { alertId: siteId } })).toBe(siteEvents);
        expect((await prisma.alert.findUniqueOrThrow({ where: { id: camera.id } })).status).toBe('REVIEWED');
    });

    it('refuses a video-less alert that is not a camera-level danger (database CHECK)', async () =>
    {
        await expect(prisma.alert.create({ data: { cameraId: cameraA1.id, zoneId: cameraA1.zoneId, kind: 'DIGGING', message: 'x', startT: 0, endT: 0 } })).rejects.toThrow();
    });
});
```

Update `tests/unit/internal-routes.test.ts`: the stored-result expectation stays `{ stored: true, danger: 'none' }` (no person, so no database work).

`tests/unit/snapshot.test.ts`, new case: an `AlertRow` with `kind: 'DANGER'`, `siteId: null`, `videoId: null`, `video: null`, `level: 1` maps to `videoId: null, simRunId: null` and leaves `outcomes` equal to the same rows without it.

`tests/unit/playback.test.ts`, new case: `alertKey({ id: 'd1', videoId: null, simRunId: null })` is `'alert:d1'`.

`tests/unit/dangerFeed.test.tsx`, new cases (build the alert with `siteAlert('cd1', { danger: 'active' }, { kind: 'DANGER', level: 1, siteId: null, videoId: null, cameraCode: 'A1', zoneCode: 'A', message: 'Danger · person seen on camera A1 near active nest sites — check now' })` from `siteFixtures.ts`; `resolveDanger` is mocked as in the file's existing cases):
- the Active list shows a card whose text includes `Camera alert · person detected (not measured distance)`, `Camera A1 · Zone A`, and the message. The card comes before any site-danger group card, and no "Person on the beach near" title is built from it.
- **Resolve** (volunteer/admin only; absent for viewers) calls `resolveDanger('cd1')` and shows `Resolved`.
- a resolved one in Inactive reads `Danger resolved by …` with `Camera A1 · Zone A`.

`tests/unit/siteDrawer.test.tsx`, new case: a camera-level danger shows `Camera alert · person detected (not measured distance)` and `Camera A1`, has no `Nest site at risk`, no `Person approach` and no `Within`, and keeps the **Resolve danger** form for volunteers.

Run: `cd dashboard/web && npx vitest run tests/unit/cameraDanger.test.ts tests/integration/live-detection.test.ts tests/unit/snapshot.test.ts tests/unit/playback.test.ts tests/unit/dangerFeed.test.tsx tests/unit/siteDrawer.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the rule**

`src/lib/danger.ts`, at the end:
```ts
export const CAMERA_DANGER_LABEL = 'Camera alert · person detected (not measured distance)';

/** Camera-level danger from live detection: no clip and no nest site. Never a measured distance to a nest. */
export const isCameraDanger = (alert: { kind: string; siteId: string | null; videoId: string | null }): boolean =>
    alert.kind === 'DANGER' && alert.siteId === null && alert.videoId === null;
```

`src/lib/detections/cameraDanger.ts`:
```ts
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { publishChange } from '@/lib/changes';
import { summarizeSite } from '@/lib/sites/summary';
import type { DetectionsView, SiteEventType } from '@/lib/types';

export const CAMERA_DANGER_MIN_TRACK_MS = 2_000;
export const CAMERA_DANGER_MIN_SCORE = 0.5;
export const CAMERA_DANGER_REPEAT_MS = 10 * 60_000;
export const CAMERA_DANGER_LOG_EVERY_MS = 60_000;
export const CAMERA_DANGER_AUTHOR = 'Camera';

export type CameraDangerResult = 'none' | 'raised' | 'logged';

export const cameraDangerMessage = (code: string) => `Danger · person seen on camera ${code} near active nest sites — check now`;
export const cameraDangerNote = (code: string, track: string, sites: number, zone: string) =>
    `Person on camera ${code} (track ${track}), ${sites} active unprotected site(s) in zone ${zone}`;

// A person in this result, scored at least 0.50, whose track has been seen for at least 2 s; the longest-seen wins.
export function qualifyingPerson(detections: DetectionsView): { track: string; score: number } | null
{
    let best: { track: string; score: number; span: number } | null = null;
    for (const object of detections.objects)
    {
        if (object.label !== 'person' || object.score === undefined || object.score < CAMERA_DANGER_MIN_SCORE)
        {
            continue;
        }
        const times = detections.trails.find(trail => trail.track === object.track)?.points.map(point => point[0]) ?? [];
        const span = times.length > 0 ? Math.max(...times) - Math.min(...times) : 0;
        if (span >= CAMERA_DANGER_MIN_TRACK_MS && (!best || span > best.span))
        {
            best = { track: object.track, score: object.score, span };
        }
    }
    return best && { track: best.track, score: best.score };
}

// Nest sites (not DANGER rows) in the zone whose log says active and unprotected right now.
async function activeUnprotectedSites(tx: Prisma.TransactionClient, zoneId: string): Promise<number>
{
    const sites = await tx.alert.findMany({
        where: { zoneId, kind: { not: 'DANGER' }, status: { in: ['NEW', 'REVIEWED', 'FIELD_CONFIRMED'] } },
        select: { kind: true, events: { select: { type: true, at: true, createdAt: true } } },
    });
    return sites.filter(site =>
    {
        const summary = summarizeSite(site.events.map(event => ({ ...event, type: event.type as SiteEventType })), site.kind);
        return summary.active && summary.protection === 'unprotected';
    }).length;
}

/**
 * Spec §6: one open camera-level DANGER per camera; repeat sightings append at most one log entry a minute; a new
 * alert only once the previous one was resolved at least 10 minutes ago. The camera row lock serialises results.
 */
export async function raiseCameraDanger(prisma: PrismaClient, deviceId: string, detections: DetectionsView, now: Date): Promise<CameraDangerResult>
{
    const person = qualifyingPerson(detections);
    if (!person)
    {
        return 'none';
    }
    const device = await prisma.liveDevice.findUnique({
        where: { id: deviceId },
        select: { disabledAt: true, camera: { select: { id: true, code: true, zoneId: true, lng: true, lat: true, zone: { select: { code: true } } } } },
    });
    const camera = device && !device.disabledAt ? device.camera : null;
    if (!camera)
    {
        return 'none';
    }
    const result = await prisma.$transaction(async (tx): Promise<CameraDangerResult> =>
    {
        await tx.$queryRaw`SELECT id FROM "Camera" WHERE id = ${camera.id} FOR UPDATE`;
        const sites = await activeUnprotectedSites(tx, camera.zoneId);
        const note = cameraDangerNote(camera.code, person.track, sites, camera.zone.code);
        const open = await tx.alert.findFirst({ where: { cameraId: camera.id, kind: 'DANGER', siteId: null, videoId: null, status: 'NEW' }, orderBy: { createdAt: 'desc' }, select: { id: true } });
        if (open)
        {
            // Locked and re-read: a volunteer may have resolved it meanwhile, and a `danger` entry after that would re-open it.
            await tx.$queryRaw`SELECT id FROM "Alert" WHERE id = ${open.id} FOR UPDATE`;
            const events = await tx.siteEvent.findMany({ where: { alertId: open.id }, select: { type: true, at: true }, orderBy: [{ at: 'desc' }, { createdAt: 'desc' }] });
            if (events.some(event => event.type === 'dangerResolved'))
            {
                return 'none';
            }
            const last = events.find(event => event.type === 'danger');
            if (last && now.getTime() - last.at.getTime() < CAMERA_DANGER_LOG_EVERY_MS)
            {
                return 'none';
            }
            await tx.siteEvent.create({ data: { alertId: open.id, type: 'danger', author: CAMERA_DANGER_AUTHOR, userId: null, note, at: now } });
            return 'logged';
        }
        if (sites === 0)
        {
            return 'none';
        }
        const previous = await tx.alert.findFirst({
            where: { cameraId: camera.id, kind: 'DANGER', siteId: null, videoId: null },
            orderBy: { createdAt: 'desc' },
            select: { events: { where: { type: 'dangerResolved' }, orderBy: { at: 'desc' }, take: 1, select: { at: true } } },
        });
        const resolvedAt = previous?.events[0]?.at;
        if (previous && (!resolvedAt || now.getTime() - resolvedAt.getTime() < CAMERA_DANGER_REPEAT_MS))
        {
            return 'none';
        }
        const alert = await tx.alert.create({
            data: {
                videoId: null, cameraId: camera.id, zoneId: camera.zoneId, kind: 'DANGER', message: cameraDangerMessage(camera.code),
                level: 1, siteId: null, lng: camera.lng, lat: camera.lat, radiusM: 0, startT: 0, endT: 0, score: null, simulated: false, detectedAt: now,
            },
            select: { id: true },
        });
        await tx.siteEvent.create({ data: { alertId: alert.id, type: 'danger', author: CAMERA_DANGER_AUTHOR, userId: null, note, at: now } });
        return 'raised';
    });
    if (result !== 'none')
    {
        publishChange('site-event');
    }
    return result;
}
```

`src/lib/detections/http.ts`: import `raiseCameraDanger` and `type CameraDangerResult`. Replace the final `return json({ stored: true, danger: 'none' });` with:
```ts
    let danger: CameraDangerResult = 'none';
    try
    {
        danger = await raiseCameraDanger(deps.prisma, deviceId, detections, new Date(now));
    }
    catch (error)
    {
        // The result is stored either way; never log detections or the token.
        console.error('Camera danger check failed:', error instanceof Error ? error.message : 'unknown error');
    }
    return json({ stored: true, danger });
```

- [ ] **Step 4: Nullable video through the snapshot and the UI**

- `src/lib/types.ts`: `AlertView.videoId: string | null;` with the comment `/** Null for camera-level dangers (no clip). */`.
- `src/server/snapshot.ts`: `AlertRow` gets `videoId: string | null; video: { simRunId: string | null } | null;`. In `toMapSnapshot`, set `simRunId: alert.video?.simRunId ?? null`. `loadMapSnapshot` is unchanged (Prisma returns `video: null`).
- `src/lib/live/importChunk.ts` and `src/lib/sim/importRun.ts`: `sites.push({ ..., videoId: alert.videoId, ... })` / `videoId: created.videoId` become `videoId: videos[view].id` (the same value, now typed `string`; `StoredSite.videoId` stays required). Without this `tsc` fails once `Alert.videoId` is nullable.
- `src/features/map/playback.ts`:
```ts
export function alertKey(alert: { id: string; videoId: string | null; simRunId: string | null }): string
{
    // A camera-level danger has no clip: its own key never matches a playing feed.
    return alert.simRunId ?? alert.videoId ?? `alert:${alert.id}`;
}
```
- `src/features/alerts/DangerCards.tsx`: add `CameraDangerCard({ danger, canResolve, onSelect, selected }: { danger: AlertView; canResolve: boolean; onSelect: (alert: AlertView) => void; selected: boolean })`. It uses the same red level-1 styling as `DangerGroupCard` (`DangerBadge`, alarm bar, clock):
  - title `CAMERA_DANGER_LABEL`;
  - line `Camera {cameraCode} · Zone {zoneCode} · {stamp}`, then `danger.message` in small text;
  - the whole header is a button that calls `onSelect(danger)`, with `aria-label` `Level 1 danger. Camera alert on camera {code}, zone {zone}, {clock}`;
  - with `canResolve`, a **Resolve** button (`aria-label` `Resolve camera alert on camera {code}`) calls `resolveDanger(danger.id)`. While busy it shows a spinner, after success `Resolved`, and on failure the error in `role="alert"`.

  In `ResolvedDangerCard`, the sub-line reads `Camera {cameraCode} · Zone {zoneCode}` when `isCameraDanger(danger)`.
- `src/features/alerts/AlertsFeed.tsx`: `const cameraDangers = active.filter(isCameraDanger);` and `groupDangers(active.filter(alert => alert.kind === 'DANGER' && !isCameraDanger(alert)))`. Render `cameraDangers.map(... <CameraDangerCard .../>)` first in the Active list, before the group cards.
- `src/features/sites/SiteDrawer.tsx`: `const cameraAlert = isCameraDanger(alert);`.
  - When it is set, the "Nest site at risk" box becomes a box titled `CAMERA_DANGER_LABEL` with the text `Camera {cameraCode} · Zone {zoneCode}. A person was seen on this camera while the zone had active unprotected nest sites. No distance to a nest was measured.`
  - The danger `<dl>` shows `Camera` (`{cameraCode}`) and `Raised` instead of `Person approach` and `Within`.
  - The Resolve danger form is unchanged.
- `src/features/map/MapView.tsx`: a danger pin whose `siteId` is null uses `aria-label`/`title` `CAMERA_DANGER_LABEL`. Site dangers keep "Danger: person near a nest site".

- [ ] **Step 5: Run and commit**

```bash
cd dashboard/web && npm run db:test:prepare && npx tsc --noEmit && npx vitest run
git add dashboard/web/prisma/schema.prisma dashboard/web/prisma/migrations/20261010150000_camera_level_danger/migration.sql \
  dashboard/web/src/lib/types.ts dashboard/web/src/lib/danger.ts dashboard/web/src/lib/detections/cameraDanger.ts \
  dashboard/web/src/lib/detections/http.ts dashboard/web/src/server/snapshot.ts dashboard/web/src/lib/live/importChunk.ts \
  dashboard/web/src/lib/sim/importRun.ts dashboard/web/src/features/map/playback.ts dashboard/web/src/features/alerts/DangerCards.tsx dashboard/web/src/features/alerts/AlertsFeed.tsx \
  dashboard/web/src/features/sites/SiteDrawer.tsx dashboard/web/src/features/map/MapView.tsx \
  dashboard/web/tests/unit/cameraDanger.test.ts dashboard/web/tests/integration/live-detection.test.ts \
  dashboard/web/tests/unit/internal-routes.test.ts dashboard/web/tests/unit/snapshot.test.ts dashboard/web/tests/unit/playback.test.ts \
  dashboard/web/tests/unit/dangerFeed.test.tsx dashboard/web/tests/unit/siteDrawer.test.tsx
git status --short
git commit -m "feat(dashboard): camera-level danger alert when a person is seen on a linked live camera"
```

---

### Task 6: Detection overlay on `/live`, the expanded view and the map camera panel

**Files:**
- Create: `dashboard/web/src/features/phones/DetectionOverlay.tsx`, `dashboard/web/src/features/phones/useDetectionsToggle.ts`, `dashboard/web/src/features/phones/useDeviceDetections.ts`, `dashboard/web/tests/unit/detectionOverlay.test.tsx`
- Modify: `dashboard/web/src/features/phones/LiveScreen.tsx`, `dashboard/web/src/features/cameras/CameraPanel.tsx`, `dashboard/web/tests/unit/liveScreen.test.tsx`, `dashboard/web/tests/unit/cameraPanelLive.test.tsx`

**Interfaces:**
- Consumes: `DetectionsView`, `LiveDeviceView.detections` (T1), `useLiveDevices(intervalMs)`, `LivePicture`.
- Produces:
  - `DetectionOverlay.tsx`: `DETECTION_NOTE = 'Detection is a viewing aid; it can miss people and mistake objects.'`; `trackColor(track: string): string`; `objectLabel(object: DetectedObject): string` (`person 0.82` / `possible turtle`); `detectionCounts(d: DetectionsView): { people: number; turtles: number }`; `DetectionOverlay({ detections })` (SVG, picture pixels); `DetectionStatus({ detections })` (the counts line, `Detection off` or `Too dark to detect`); `DetectionNote({ detections })` (footer and the "Possible turtle (rule)" line).
  - `useDetectionsToggle.ts`: `DETECTIONS_KEY = 'nesttrace.detections'`; `useDetectionsToggle(): [boolean, (on: boolean) => void]`. Default on; every `localStorage` access is in try/catch.
  - `useDeviceDetections.ts`: `useDeviceDetections(deviceId: string | null, enabled: boolean): DetectionsView | null` (polls `/api/live/devices` every 1 s while enabled and a device is set; never throws).

- [ ] **Step 1: Failing DOM tests**

`tests/unit/detectionOverlay.test.tsx`:
```tsx
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DETECTION_NOTE, DetectionNote, DetectionOverlay, DetectionStatus, detectionCounts, objectLabel, trackColor } from '@/features/phones/DetectionOverlay';
import type { DetectionsView } from '@/lib/types';

afterEach(cleanup);

const detections: DetectionsView = {
    at: 3_000, dark: false, width: 320, height: 240,
    objects: [
        { track: 'P1', label: 'person', score: 0.8249, box: [194, 104, 31, 86] },
        { track: 'T1', label: 'possible turtle', box: [40, 120, 48, 24] },
    ],
    trails: [
        { track: 'P1', label: 'person', points: [[1_000, 200, 147], [2_000, 205, 147], [3_000, 210, 147]] },
        { track: 'T1', label: 'possible turtle', points: [[3_000, 64, 132]] },
    ],
};

describe('detection overlay', () =>
{
    it('draws boxes, labels and fading trails in picture pixels', () =>
    {
        const { container } = render(<DetectionOverlay detections={detections} />);
        const svg = container.querySelector('svg')!;
        expect(svg.getAttribute('viewBox')).toBe('0 0 320 240');
        expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
        const person = container.querySelector('rect[data-track="P1"]')!;
        expect([person.getAttribute('x'), person.getAttribute('y'), person.getAttribute('width'), person.getAttribute('height')]).toEqual(['194', '104', '31', '86']);
        expect(person.getAttribute('stroke')).toBe(trackColor('P1'));
        expect(screen.getByText('person 0.82')).toBeTruthy();
        expect(screen.getByText('possible turtle')).toBeTruthy();
        const segments = [...container.querySelectorAll('line[data-track="P1"]')];
        expect(segments).toHaveLength(2);
        expect(Number(segments[0].getAttribute('stroke-opacity'))).toBeLessThan(Number(segments[1].getAttribute('stroke-opacity')));
        expect(segments[1].getAttribute('stroke-opacity')).toBe('1');
        expect(container.querySelectorAll('line[data-track="T1"]')).toHaveLength(0);
    });

    it('labels, colours and counts', () =>
    {
        expect(objectLabel(detections.objects[0])).toBe('person 0.82');
        expect(objectLabel(detections.objects[1])).toBe('possible turtle');
        expect(trackColor('P1')).not.toBe(trackColor('P2'));
        expect(trackColor('P1')).not.toBe(trackColor('T1'));
        expect(detectionCounts(detections)).toEqual({ people: 1, turtles: 1 });
    });

    it('says what the detector is doing', () =>
    {
        const { rerender } = render(<DetectionStatus detections={detections} />);
        expect(screen.getByText('People 1 · Possible turtles 1')).toBeTruthy();
        rerender(<DetectionStatus detections={null} />);
        expect(screen.getByText('Detection off')).toBeTruthy();
        rerender(<DetectionStatus detections={{ ...detections, dark: true, objects: [], trails: [] }} />);
        expect(screen.getByText('Too dark to detect')).toBeTruthy();
        rerender(<DetectionNote detections={detections} />);
        expect(screen.getByText(DETECTION_NOTE)).toBeTruthy();
        expect(DETECTION_NOTE).toBe('Detection is a viewing aid; it can miss people and mistake objects.');
        expect(screen.getByText(/Possible turtle \(rule\)/)).toBeTruthy();
        rerender(<DetectionNote detections={null} />);
        expect(screen.queryByText(DETECTION_NOTE)).toBeNull();
    });
});
```

Add to `tests/unit/liveScreen.test.tsx` (`stubFetch` already serves `/api/live/devices`; add `beforeEach(() => localStorage.clear())`):
```tsx
describe('LiveScreen detections', () =>
{
    const seen = { ...phone, detections: { at: 1, dark: false, width: 320, height: 240, objects: [{ track: 'P1', label: 'person' as const, score: 0.82, box: [1, 2, 3, 4] as [number, number, number, number] }], trails: [] } };

    it('draws the overlay and the counts under the tile, with the footer note', async () =>
    {
        frame.url = 'blob:1';
        stubFetch([seen]);
        render(<LiveScreen user={viewer} bar={bar} connect={null} />);
        expect(await screen.findByText('person 0.82')).toBeTruthy();
        expect(screen.getByText('People 1 · Possible turtles 0')).toBeTruthy();
        expect(screen.getByText('Detection is a viewing aid; it can miss people and mistake objects.')).toBeTruthy();
    });

    it('says Detection off when the worker sends nothing', async () =>
    {
        stubFetch([phone]);
        render(<LiveScreen user={viewer} bar={bar} connect={null} />);
        expect(await screen.findByText('Detection off')).toBeTruthy();
    });

    it('hides everything with the Detections toggle and remembers it', async () =>
    {
        frame.url = 'blob:1';
        stubFetch([seen]);
        const { unmount } = render(<LiveScreen user={viewer} bar={bar} connect={null} />);
        const toggle = await screen.findByRole('button', { name: 'Detections' });
        expect(toggle.getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(toggle);
        expect(screen.queryByText('person 0.82')).toBeNull();
        expect(screen.queryByText('People 1 · Possible turtles 0')).toBeNull();
        expect(localStorage.getItem('nesttrace.detections')).toBe('off');
        unmount();
        render(<LiveScreen user={viewer} bar={bar} connect={null} />);
        expect((await screen.findByRole('button', { name: 'Detections' })).getAttribute('aria-pressed')).toBe('false');
    });

    it('draws the overlay in the expanded view too', async () =>
    {
        frame.url = 'blob:1';
        stubFetch([seen]);
        render(<LiveScreen user={viewer} bar={bar} connect={null} />);
        await screen.findByText('person 0.82');
        fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
        expect(within(screen.getByRole('dialog', { name: 'Dune phone' })).getByText('person 0.82')).toBeTruthy();
    });
});
```

`tests/unit/cameraPanelLive.test.tsx`: add `const detections = vi.hoisted(() => ({ value: null as unknown }));` and `vi.mock('@/features/phones/useDeviceDetections', () => ({ useDeviceDetections: () => detections.value }));`, then a case:
- while live with `detections.value` holding one person, the panel shows `person 0.82` over the picture and `People 1 · Possible turtles 0`;
- with `detections.value = null` it shows `Detection off`;
- after `localStorage.setItem('nesttrace.detections', 'off')` it shows neither.

Run: `cd dashboard/web && npx vitest run tests/unit/detectionOverlay.test.tsx tests/unit/liveScreen.test.tsx tests/unit/cameraPanelLive.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Implement `DetectionOverlay.tsx` and the hooks**

`DetectionOverlay.tsx` (client component), behaviour:
- `PALETTE = ['#F5B544', '#5AC8FA', '#FF7AB6', '#7CE38B', '#B69CFF', '#FF9F5A']`. `trackColor(track)` = `PALETTE[(Number(track.slice(1)) - 1 + (track[0] === 'T' ? 3 : 0)) % 6]`.
- `objectLabel`: `person ${score.toFixed(2)}` for people, `possible turtle` otherwise.
- `DetectionOverlay`: an `aria-hidden` `<svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 {width} {height}" preserveAspectRatio="xMidYMid meet">`. The picture uses `object-contain`, so the overlay lines up with it exactly as `MotionBox` does.
  - Each trail with ≥ 2 points becomes `<line data-track>` segments in the track colour. Segment `i` of `n` gets `strokeOpacity={n === 1 ? 1 : 0.2 + 0.8 * i / (n - 1)}` (oldest 0.2, newest exactly `1`), with `strokeWidth={2}` and `vectorEffect="non-scaling-stroke"`.
  - Each object gets a `<rect data-track fill="none" stroke={trackColor}>` at its box, plus a `<text>` label just above the box (inside the top edge when y < 12). The label has a font size of `Math.max(10, height / 22)`, the same fill, and `paintOrder="stroke"` with a dark stroke for contrast. A possible turtle's `<g>` also carries `<title>Possible turtle (rule)</title>`.
- `DetectionStatus`:
  - `null` → `Detection off` (muted);
  - `dark` → `Too dark to detect`;
  - otherwise `People {n} · Possible turtles {m}` (`font-mono text-[11px]`).
- `DetectionNote`: nothing for `null`. Otherwise two separate `<p>` elements (`text-[11px] text-ink-muted`): `DETECTION_NOTE`, then `Possible turtle (rule): a slow, wide moving shape, not a confirmed turtle.`

`useDetectionsToggle.ts`: `useSyncExternalStore` over `localStorage['nesttrace.detections']` (`'off'` = off, anything else = on). The server snapshot is `true`. The setter writes `'on'`/`'off'` inside try/catch and notifies subscribers, so every tile and the panel follow at once.

`useDeviceDetections.ts`:
- while `enabled && deviceId`, fetch `/api/live/devices` (`cache: 'no-store'`) every 1000 ms while the tab is visible, and return that device's `detections`;
- `null` when disabled, when the device is missing, or on any fetch error;
- clears its interval on unmount or when its inputs change.

- [ ] **Step 3: Wire `LiveScreen` and `CameraPanel`**

`LiveScreen.tsx`:
- `const [detectionsOn, setDetectionsOn] = useDetectionsToggle();` and `useLiveDevices(detectionsOn ? 1000 : 3000)`.
- In the header actions (for every role, before the admin buttons) add a `Detections` button with `aria-pressed={detectionsOn}`, the `ScanSearch` icon (lucide-react) and the existing `action` styling (amber ring when on), which flips it.
- `Tile` and `Expanded` take `detectionsOn`. When it is on and the device is online:
  - `<DetectionOverlay detections={device.detections} />` goes inside `LivePicture` when `device.detections` is non-null and not dark;
  - `<DetectionStatus detections={device.detections} />` goes under the camera line;
  - `<DetectionNote detections={device.detections} />` goes at the bottom of the tile footer.
- The board `MotionBox` and badge stay as they are and draw under the detection overlay.

`CameraPanel.tsx`:
- `const [detectionsOn] = useDetectionsToggle();` and `const detections = useDeviceDetections(showLive ? phone!.id : null, detectionsOn);`.
- In the live picture container, after the `<img>`, render `{detectionsOn && detections && !detections.dark && <DetectionOverlay detections={detections} />}`.
- Below the picture, while `showLive && detectionsOn`, render `<DetectionStatus detections={detections} />` and `<DetectionNote detections={detections} />`.

- [ ] **Step 4: Run and commit**

```bash
cd dashboard/web && npx tsc --noEmit && npx vitest run
git add dashboard/web/src/features/phones/DetectionOverlay.tsx dashboard/web/src/features/phones/useDetectionsToggle.ts \
  dashboard/web/src/features/phones/useDeviceDetections.ts dashboard/web/src/features/phones/LiveScreen.tsx \
  dashboard/web/src/features/cameras/CameraPanel.tsx dashboard/web/tests/unit/detectionOverlay.test.tsx \
  dashboard/web/tests/unit/liveScreen.test.tsx dashboard/web/tests/unit/cameraPanelLive.test.tsx
git status --short
git commit -m "feat(dashboard): person and possible-turtle boxes, trails and counts on live tiles and the camera panel"
```

---

### Task 7: Docs, end-to-end with a fake board and the worker, then the real ESP32 board and a phone

**Files:**
- Modify: `dashboard/README.md`, `CLAUDE.md`, `agent.md`

- [ ] **Step 1: Docs**

`dashboard/README.md`, new section `## Live detection` after "ESP32 camera boards":
1. What it does: people (YOLOX-nano, Apache-2.0, score ≥ 0.40) and **possible turtles** (a rule: slow, wide moving shapes; never a confirmed turtle) on live phone and board pictures, with track ids and 30 s trails. The **Detections** toggle is remembered per browser. It is a viewing aid: it can miss people and mistake objects.
2. Setup: put `WORKER_TOKEN=$(openssl rand -hex 32)` in `dashboard/.env`, then `docker compose up -d --build`. The `worker` image downloads the model once at build and checks its SHA-256. At runtime it is on an internal-only network (no internet, no published port). `/api/internal/*` is for the worker only: Caddy answers 404 to the LAN, and the routes refuse without the token. Without `WORKER_TOKEN`, tiles say "Detection off".
3. Camera alert: when a person is seen for 2 s on a phone or board **linked to a map camera**, and that camera's zone has an active unprotected nest site, a red level-1 card appears: **"Camera alert · person detected (not measured distance)"**. There is one per camera until a volunteer or admin resolves it, and the next one comes at least 10 minutes after the resolve. Repeat sightings are logged on it at most once a minute. It is not tied to one nest, does not change any site's Saved/Not saved status, and is not a measured distance.
4. Limits: CPU only, up to 2 frames/s per device, about 6 devices. "Too dark to detect" below 25/255 mean brightness; night or infrared detection is out of scope. Boxes refresh about every second.
5. Worker tests on the host: `cd dashboard/worker && python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt`, the model download and `shasum` check from Task 2 Step 1, then `.venv/bin/pytest -q`. Inside the image: `docker compose run --rm --no-deps worker python -m pytest -q`.

In the "Live phone cameras" step 5 and the "ESP32 camera boards" step 4, change "never reaches the detector" to "never reaches the digging detector".

`CLAUDE.md`, "Two separate applications" item 2: the Python worker in `dashboard/worker` is live detection (people with YOLOX-nano, a possible-turtle rule, tracks and trails) over the internal API `/api/internal/*` (bearer `WORKER_TOKEN`; Caddy 404). Add the host test command to "Commands".

`agent.md`, "Real dashboard" paragraph: "these frames and recordings are real footage, never committed, and never fed to the detector" becomes "... never fed to the digging detector; the live detection worker (`dashboard/worker`) reads them in memory only, to draw people and possible-turtle boxes and to raise the camera-level danger alert, and it never imports `pipeline/`".

- [ ] **Step 2: Full verification**

```bash
cd dashboard/web && npm run db:test:prepare && npx vitest run && npx tsc --noEmit && npx next build
cd ../worker && .venv/bin/pytest -q
cd ../.. && npm test        # research suite, untouched by this plan, must still pass
git status --short          # no .env, models, .venv, recordings, artifacts, media or .superpowers entries
```

- [ ] **Step 3: End-to-end with a fake board, the real worker and Playwright (through Caddy)**

Preconditions:
- `docker compose up -d --build` with `WORKER_TOKEN` set; `docker compose ps` shows `worker` running.
- A fresh site in zone A: `cd dashboard/web && npm run sim:import -- --run ../../artifacts/public/A-seaward-humans-demo-929 --pair A`, so zone A has active unprotected sites. The script checks with `psql` that at least one non-DANGER alert in zone A has an open status and no `protectionInstalled` entry.
- Copy the CA like Plan F: `docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt <scratchpad>/plan-g/root.crt`, and run the script with `NODE_EXTRA_CA_CERTS=<scratchpad>/plan-g/root.crt node <scratchpad>/plan-g/e2e.mjs`.

The script imports `chromium` from `/Users/segfault/Documents/islanderhack2026/nesttrace/node_modules/playwright/index.mjs` and reads `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` and `WORKER_TOKEN` from `dashboard/.env`. It never prints the token. Steps and assertions:
1. **Board:** admin signs in at `https://localhost:3443/login`. On `/live` it adds a board named `E2E detect`, reads the device id and token from the dialog, and presses **Done**.
2. **Link:** on `/setup/cameras`, set camera **A1**'s Source to `E2E detect`.
3. **Fake board:** POST `dashboard/worker/tests/fixtures/person-beach-320.jpg` to `https://localhost:3443/api/live/frame/<id>` with `Authorization: Bearer <board token>` every 200 ms for 25 s. Every response must be 200.
4. **Overlay (`/live`):** within 6 s, the `E2E detect` tile shows an SVG text matching `/^person 0\.\d\d$/`. Within 8 s it shows a `line[data-track="P1"]`, plus `People 1 · Possible turtles 0` and the footer note. The rect for P1 is within ±6 px of (194, 104, 31, 86).
5. **Camera alert (map `/`):**
   - within 10 s of the first frame, the Active list shows a card with `Camera alert · person detected (not measured distance)` and `Camera A1 · Zone A`, and the top-bar danger chip is visible;
   - `psql` shows exactly one row with `kind='DANGER' AND "siteId" IS NULL AND "videoId" IS NULL`, `message` = `Danger · person seen on camera A1 near active nest sites — check now`, `level` 1;
   - after the 25 s of sending, still exactly one row, and its log has 1 or 2 `danger` entries (at most one a minute).
   - **Resolve** on the card makes it leave Active. Sending 10 s more raises no new row (10-minute rule).
6. **Toggle:** on `/live`, **Detections** off hides the boxes and counts and survives a reload, and on again brings them back.
7. **Worker stopped:** `docker compose stop worker` while the fake board keeps sending. Within 12 s the tile shows `Detection off` and no `rect[data-track]`. After `docker compose start worker`, the boxes return within 10 s.
8. **Viewer:** a viewer-role context sees the same boxes and counts on `/live`, and no Resolve button on the camera card.
9. **Cleanup:** Remove `E2E detect` (its camera returns to the simulation loop). Screenshots of steps 4, 5 and 7 go to `<scratchpad>/plan-g/`.

Expected: every assertion passes. On failure, fix the owning task's code (with a test) and rerun; do not loosen the assertions.

- [ ] **Step 4: LAN refusal matrix**

From another device on the LAN (or the laptop, using `LAN_HOST`), with `T` = the worker token read locally:
```bash
for p in /api/internal/devices /api/internal /API/Internal/devices /api/%69nternal/devices //api/internal/devices /api/internal/frame/x; do
  printf '%s ' "$p"; curl -sk --path-as-is -o /dev/null -w '%{http_code}\n' "https://$LAN_HOST:3443$p"; done                 # all 404
curl -sk -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $T" "https://$LAN_HOST:3443/api/internal/devices"         # 404
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/internal/devices                                            # 401 (loopback only, no token)
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/README.md CLAUDE.md agent.md
git status --short
git commit -m "docs: live detection worker, camera alert and the internal API"
```

- [ ] **Step 6: Real ESP32 board and a phone (with the user)**

Ask the user to do this, then record the results in the task notes:
1. The ESP32 board (already sending as device **"ESP32-S3 GC0308"**) and a phone (`/cam`) both send. Standing in front of the board shows a `person 0.xx` box with a P id and a trail that follows you on `/live`. The phone tile does the same at the same time, so round-robin keeps both updating. Note `docker stats --no-stream` CPU for `worker`.
2. Covering the board's lens turns its tile to `Too dark to detect` within about 2 s, and uncovering it brings the boxes back.
3. Link the board to a camera in a zone with an active unprotected site. Stay in view for more than 2 s: the camera alert card appears with the board's camera code, the map shows the pulsing marker at that camera, and **Resolve danger** works. Unlink it and repeat: no alert.
4. Move a dark, flat object (a closed laptop or a shoebox, wider than tall) slowly across the board's view for 5 s. It may show as `possible turtle` with a T id. Write down whether it did; the rule is low-confidence by design, and the result is information, not a pass/fail.
5. `docker compose stop worker`: both tiles say `Detection off` within about 11 s. Then `docker compose start worker`.

---

## Self-review

**Spec coverage**
- §1 decisions:
  - YOLOX-nano official ONNX with OpenCV DNN, no Ultralytics → T2 Dockerfile and T3 detector.
  - Possible turtle as a rule, never "turtle" → T4 rule, T6 labels, T7 README.
  - Track ids and trails → T4 tracker, T6 overlay.
  - `dashboard/worker` service → T2/T4.
  - Boundaries (no `pipeline/`, only the one alert, frames stay local) → T2 `test_packaging.py`, T1 boundary scan of worker files, T4 internal network, T5 rule.
- §2 worker:
  - Python 3.12, pinned OpenCV, numpy, httpx; no ports; internal network → T2/T4.
  - Model URL plus SHA-256 in the Dockerfile, build fails on mismatch → T2 (`sha256sum -c`) and `test_dockerfile_pins_the_model_release_and_hash`.
  - 500 ms loop, changed frames only, ≤ 2 frames/s, round-robin → T2 `Scheduler` and its tests.
  - Internal API, bearer token, constant time, unset refused, Caddy 404 → T1 and T7 Step 4.
  - Worker failure → "Detection off" → T1 freshness, T6 status, T7 Step 3.7.
- §3 rules: person 0.40 / 0.45 / 1% → T3. Possible-turtle conditions → T4 `blob_shape_ok` and `is_possible_turtle`, tested for wide-slow passing and tall, fast, tiny, huge and on-person failing. Dark < 25/255 → T3 `is_dark`, T4 pipeline, T6 status.
- §4 tracking: IoU ≥ 0.3, Hungarian, same label, 3 s end, 30 s / 60 points, `P`/`T` ids → T4. Results stored beside the newest frame → T1.
- §5 UI: boxes, labels, track colours, fading trails on tiles and in the expanded view; the toggle in localStorage; the counts line; the map panel overlay; `detections` on `/api/live/devices` for any role; the footer note → T1 and T6.
- §6 alert: when, what, how often, where it shows (red card first, top-bar chip via `dangerCount`, pulsing marker at the camera position, Resolve danger), not counted in outcomes, the label, unlinked never → T5 and T7 Step 3.5.
- §7 out of scope: no distance alerts, no training, no night/IR, no recordings, no GPU.
- §8 testing: every bullet maps to a named test file or e2e step above.

**Placeholder scan:** no TBD/TODO. Every worker file is given in full and was run (34 tests, host and image). The web logic (token, schema, store, handlers, the danger rule) is given in full. The UI steps use explicit behaviour lists with DOM tests pinning the load-bearing strings and geometry, as in Plans C, E and F.

**Type consistency:**
- `DetectionsView` (types) is produced by `parseDetections` and stored by `FrameStore.putDetections`, which `detections()` and `listDevices` return. It is consumed by `qualifyingPerson`/`raiseCameraDanger`, `DetectionOverlay`, `DetectionStatus`, `DetectionNote` and `useDeviceDetections`.
- The worker's `DevicePipeline.process` returns exactly the `detectionsSchema` keys: `at` int, `dark`, `width`, `height`, objects with `score` only for `person`, `track` `P<n>`/`T<n>`, trails `[[int ms, x, y]]` ≤ 60.
- `CameraDangerResult` flows from `raiseCameraDanger` into the `postInternalDetections` JSON.
- `AlertView.videoId: string | null` is consumed by `alertKey`, `isCameraDanger` and `SiteDrawer`.
