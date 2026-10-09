# NestTrace Dashboard — Plan A: Merge and Simulation Feeds — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the six-turtle simulator from `origin/main` into the branch, record four demo runs, import their public outputs into the dashboard through a validated `sim-import-v1` adapter, and loop the footage on every online camera with a Raw/Motion toggle and time-synced digging pins on the map.

**Architecture:** Research side (repo root) records runs into `artifacts/public/<run>/` exactly as `scripts/pin_batch.py` does. A dashboard CLI (`dashboard/web/scripts/sim-import.ts`) reads only those public files, validates them with zod, copies media into `dashboard/media/sim/<run>/` (bind-mounted at `/media` in Compose), and writes `Video` (source `SIMULATION`) and `Alert` rows. An authenticated Range-capable route streams the media. The camera panel plays the loop and publishes its clock (4 Hz) to `MapScreen`, which shows only the pins whose time window contains the clock.

**Tech Stack:** Existing Plan 1 stack (Next.js 16.4.0, React 19.3.0, Prisma 7.10.0, Postgres 16, Vitest 5, zod 4.6.5, MapLibre via react-map-gl 8.1.3). Research side: Node 24 + Playwright Chrome recorder, Python 3.12 venv (`.venv`).

**Spec:** `docs/superpowers/specs/2026-10-09-simulation-and-live-cameras-design.md` (Part A = §2). Parent spec: `docs/superpowers/specs/2026-10-09-nesttrace-dashboard-design.md`.

## Global Constraints

- The dashboard never imports from repo-root `web/`, calls `scripts/server.mjs`/port 5174, or reads any `private/` path. Simulation data enters only via the `sim-import-v1` CLI reading `artifacts/public/<run>/`.
- Alert message for pins is exactly `Digging activity detected; nesting unresolved.` UI labels simulated alerts "Simulated · approximate position". Never "confirmed nest".
- Demo seeds: `901`, `907`, `911`, `919`, model `A`. Run ids: `A-swarm-demo-901` (pair A), `A-swarm-demo-907` (B), `A-swarm-demo-911` (C), `A-swarm-night-demo-919` (D, scenario `swarm-night`). Never use a seed listed in any `config/*registration*.json`.
- Frozen research files are not edited: `config/*`, `pipeline/*`, `results/*`, `*RESULTS.md`.
- Commit messages: no `Co-Authored-By` and no AI attribution. Stage explicit paths only; never stage `artifacts/`, `dashboard/media/`, `.superpowers/`, or `.env` files.
- Ports unchanged: web `127.0.0.1:3000`, db `127.0.0.1:5433`, research Vite 5173 / API 5174.
- Simulated ground frame: point `[x, y]` metres, `x` along the shoreline, `y` inland (positive = away from the sea; the simulator's water is at negative `z`). Map placement: true scale, origin at the zone centroid, `+x` along the zone's along-beach bearing (land-south corner → land-north corner), `+y` toward bearing − 90°.
- Zone ring order from the seed: `[landNorth, landSouth, seaSouth, seaNorth, landNorth]`.

## Review Focus

1. **Import run twice / import a second run onto the same pair** → no duplicate videos or alerts for that run; the camera plays the newest import. Pinned in Task 5 (idempotence test + newest-video test).
2. **Media request with a crafted path or another file id** → path always comes from the DB row and must stay under `MEDIA_ROOT`; traversal yields 404. Pinned in Task 4 (`resolveMediaPath` test).
3. **Range header edge cases** (`bytes=0-`, `bytes=-500`, past-end start, malformed) → 206 with correct `Content-Range`, or 416 for unsatisfiable. Pinned in Task 4 (`parseRange` tests).
4. **Raw/Motion toggle mid-loop** → playback continues from the same second, not from zero. Pinned in Task 6 (CameraVideo test asserts restored `currentTime`).
5. **Run without pins file (or zero pins)** → videos import, no alerts, no crash; a `private` path is refused before anything is copied. Pinned in Task 5.

---

## File Structure

```
scripts/demo_runs.py                      (research) record + analyse + pin-group the four demo runs
tests/test_demo_runs.py                   (research) seed-guard test
dashboard/
  docker-compose.yml                      media volume → bind mount ./media
  .env.example                            MEDIA_ROOT for host dev
  .gitignore                              media/
  web/
    prisma/schema.prisma                  VideoSource, EvidenceTier, new Video/Alert fields
    prisma/migrations/<ts>_sim_feeds/     generated
    scripts/sim-import.ts                 CLI entry
    src/lib/media.ts                      mediaRoot(), resolveMediaPath()
    src/lib/range.ts                      parseRange()
    src/lib/geo.ts                        + bearingBetween()
    src/lib/sim/schema.ts                 zod schemas for pins + calibration (sim-import-v1)
    src/lib/sim/frame.ts                  zoneFrame(), simPointToLngLat()
    src/lib/sim/importRun.ts              importSimRun()
    src/lib/types.ts                      CameraVideo, AlertView additions
    src/server/snapshot.ts                video + alert fields
    src/app/api/media/video/[videoId]/route.ts
    src/features/cameras/CameraVideo.tsx  looping player, Raw/Motion, clock
    src/features/cameras/CameraPanel.tsx  uses CameraVideo, SIMULATED badge
    src/features/map/playback.ts          visibleAlerts(), activeAlertIds()
    src/features/map/MapScreen.tsx        playback state → MapView + AlertsFeed
    src/features/map/MapView.tsx          tier colours, gated alerts
    src/features/alerts/AlertsFeed.tsx    active highlight, simulated label
```

---

### Task 1: Merge `origin/main` (simulator only)

**Files:**
- Modify (conflict resolution): `agent.md`, `README.md`, anything under `dashboard/`
- No new code.

**Interfaces:**
- Produces: branch contains `origin/main`'s simulator (`web/`, `pipeline/pin_fuse.py`, `pipeline/fuse.py`, `config/pin-settings.json`, `config/settings-swarm.json`, scenarios `swarm`, `swarm-night`) and the unchanged Next.js `dashboard/`.

- [ ] **Step 1: Restore the root lockfile and fetch**

The only local change to `package-lock.json` is the package name (`islanderhack26` → `nesttrace`) from an earlier `npm install`; restore it so the merge starts clean.
```bash
cd /Users/segfault/Documents/islanderhack2026/nesttrace
git diff --stat package-lock.json      # expect: 1 file, 2 insertions, 2 deletions
git checkout -- package-lock.json
git fetch origin
git status --short                     # expect only: ?? .superpowers/
```

- [ ] **Step 2: Merge without committing**

```bash
git merge --no-ff --no-commit origin/main
git status --short | grep -E '^(UU|AA|DU|UD|AU|UA|DD) '
```
Expected: conflicts limited to `agent.md`, `README.md`, `dashboard/README.md`, and `dashboard/src/**`/`dashboard/package*.json`/`dashboard/vite.config.js`/`dashboard/index.html` (deleted by us, modified by them).

- [ ] **Step 3: Resolve dashboard conflicts in favour of the Next.js app**

```bash
# Files we deleted and they modified or added: keep them deleted.
git status --short | awk '/^(DU|UD|AU|UA) / {print $2}' | grep '^dashboard/' | xargs -r git rm -q --cached --ignore-unmatch
git status --short | awk '/^A  / {print $2}' | grep '^dashboard/src/' | xargs -r git rm -q --cached --ignore-unmatch
rm -rf dashboard/src dashboard/index.html dashboard/vite.config.js dashboard/package.json dashboard/package-lock.json dashboard/public
git checkout --ours -- dashboard/README.md && git add dashboard/README.md
ls dashboard        # expect: README.md docker-compose.yml web (plus .env/.env.example/.gitignore, media if present)
```
macOS `xargs` has no `-r`; if it errors on empty input, run each pipeline only when its `git status` filter prints something.

- [ ] **Step 4: Resolve `agent.md`**

Take `origin/main`'s "Current experiment status" section (swarm, stress, pin registrations, "not infrared") and keep this branch's dashboard paragraphs. Final "Real dashboard" section must read:
```markdown
## Real dashboard (team-owned application)

The real monitoring dashboard lives under `dashboard/` as a Docker Compose app: `web/` (Next.js, port 3000) and Postgres (host port 5433). It owns users, access control, persistent records, and camera feeds. Do not make production behavior depend on a running simulator, the local research API, synthetic seed configuration, or evaluator truth.

Simulation footage reaches the dashboard only through the `sim-import-v1` adapter (`dashboard/web/scripts/sim-import.ts`), which reads public run outputs (`camera-*.mp4`, `view-*/pure-motion.mp4`, `calibration-*.json`, `timestamps.json`, `pins/predictions.json`) and refuses `private/` paths. `dashboard/web/tests/boundary.test.ts` fails if dashboard code references the simulator, the research API, or private truth.
```
Then `git add agent.md`.

- [ ] **Step 5: Resolve root `README.md`**

Take `origin/main`'s version, then replace its dashboard sentence ("The team’s **real dashboard scaffold** lives in [`dashboard/`](dashboard/README.md) as a separate application with sample data and its own runtime on port 5180.") with:
```markdown
The team’s **real dashboard** lives in [`dashboard/`](dashboard/README.md): a Docker Compose app (Next.js on port 3000, Postgres) with logins, a satellite map, and camera feeds. It imports reviewed simulation outputs through a separate adapter and never reads simulator state or private truth.
```
`git add README.md`.

- [ ] **Step 6: Verify both apps and commit the merge**

```bash
git diff --cached --name-only | grep -E '^dashboard/src/' && echo "STRAY VITE FILES" || echo "clean"
npm install                                   # root deps may have changed
.venv/bin/python -m pip install -q -r requirements.txt
npm test                                      # tsc --noEmit + pytest
cd dashboard/web && npm run db:test:prepare && npx vitest run && npx tsc --noEmit && cd ../..
git checkout -- package-lock.json 2>/dev/null || true   # drop the name-only rewrite again if npm reintroduced it
git commit -m "Merge origin/main: six-turtle simulator and two-camera pins

Keeps the Next.js dashboard. The Vite nest-log work from origin/main
(dashboard/src) is not carried into the app; it remains in history."
```
Expected: "clean"; root `npm test` passes; dashboard vitest passes (48 tests); tsc clean.

---

### Task 2: Record the four demo runs (research side)

**Files:**
- Create: `scripts/demo_runs.py`, `tests/test_demo_runs.py`

**Interfaces:**
- Consumes: `scripts/record.mjs` (`--seed --scenario --model --id`), `scripts/analyze.py RUN --both --settings config/settings-swarm.json`, `pipeline/pin_fuse.py --camera-0 --camera-1 --registration config/pin-settings.json --output`.
- Produces: `artifacts/public/<run>/{camera-0.mp4,camera-1.mp4,calibration-0.json,calibration-1.json,timestamps.json,analysis.json,view-0/pure-motion.mp4,view-1/pure-motion.mp4,pins/predictions.json}` for the four run ids; `demo_runs.registered_seeds(config_dir) -> set[int]`; `demo_runs.DEMO_RUNS: list[tuple[str, str, int]]` (run_id, scenario, seed).

- [ ] **Step 1: Write the failing test**

`tests/test_demo_runs.py`:
```python
import json

import pytest

from scripts import demo_runs


def test_registered_seeds_collects_every_registration(tmp_path):
    (tmp_path / 'a-registration.json').write_text(json.dumps({'seeds': [1, 2]}))
    (tmp_path / 'b-registration.json').write_text(json.dumps({'splits': {'validation': [3], 'test': [4, 5]}}))
    (tmp_path / 'settings.json').write_text(json.dumps({'seeds': [99]}))
    assert demo_runs.registered_seeds(tmp_path) == {1, 2, 3, 4, 5}


def test_demo_seeds_are_not_registered():
    used = demo_runs.registered_seeds(demo_runs.ROOT / 'config')
    assert not ({seed for _, _, seed in demo_runs.DEMO_RUNS} & used)


def test_guard_rejects_registered_seed(tmp_path):
    (tmp_path / 'x-registration.json').write_text(json.dumps({'seeds': [907]}))
    with pytest.raises(SystemExit, match='907'):
        demo_runs.check_seeds(tmp_path)
```
`scripts/` must be importable from tests: if `tests/` cannot import `scripts.demo_runs`, add an empty `scripts/__init__.py` only if one does not exist and no other test relies on its absence; otherwise insert the repo root on `sys.path` at the top of the test (`sys.path.insert(0, str(Path(__file__).resolve().parents[1]))`).

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_demo_runs.py -q`
Expected: FAIL — `cannot import name 'demo_runs'`.

- [ ] **Step 3: Implement `scripts/demo_runs.py`**

```python
"""Record, analyse and pin-group the four dashboard demo runs.

Uses fresh seeds that no registration file lists, writes only under
artifacts/public and artifacts/private, and never touches config/ or results/.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

DEMO_RUNS = [
    ('A-swarm-demo-901', 'swarm', 901),
    ('A-swarm-demo-907', 'swarm', 907),
    ('A-swarm-demo-911', 'swarm', 911),
    ('A-swarm-night-demo-919', 'swarm-night', 919),
]


def _ints(value):
    if isinstance(value, bool):
        return set()
    if isinstance(value, int):
        return {value}
    if isinstance(value, list):
        return set().union(*(_ints(item) for item in value)) if value else set()
    if isinstance(value, dict):
        return set().union(*(_ints(item) for item in value.values())) if value else set()
    return set()


def _seed_values(node):
    found = set()
    if isinstance(node, dict):
        for key, value in node.items():
            if 'seed' in key.lower() or key in ('splits',):
                found |= _ints(value)
            else:
                found |= _seed_values(value)
    elif isinstance(node, list):
        for item in node:
            found |= _seed_values(item)
    return found


def registered_seeds(config_dir):
    seeds = set()
    for path in Path(config_dir).glob('*registration*.json'):
        seeds |= _seed_values(json.loads(path.read_text()))
    return seeds


def check_seeds(config_dir):
    clash = sorted({seed for _, _, seed in DEMO_RUNS} & registered_seeds(config_dir))
    if clash:
        raise SystemExit(f'Demo seeds already registered: {clash}')


def complete(run_id):
    public = ROOT / 'artifacts/public' / run_id
    needed = ['camera-0.mp4', 'camera-1.mp4', 'calibration-0.json', 'calibration-1.json', 'timestamps.json',
              'analysis.json', 'view-0/pure-motion.mp4', 'view-1/pure-motion.mp4', 'pins/predictions.json']
    return all((public / name).is_file() for name in needed)


def run_one(run_id, scenario, seed):
    public = ROOT / 'artifacts/public' / run_id
    subprocess.run(['node', 'scripts/record.mjs', '--seed', str(seed), '--scenario', scenario, '--model', 'A', '--id', run_id], cwd=ROOT, check=True)
    subprocess.run([sys.executable, 'scripts/analyze.py', run_id, '--both', '--settings', 'config/settings-swarm.json'], cwd=ROOT, check=True)
    (public / 'pins').mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, 'pipeline/pin_fuse.py',
                    '--camera-0', str(public / 'view-0/detection/predictions.json'),
                    '--camera-1', str(public / 'view-1/detection/predictions.json'),
                    '--registration', 'config/pin-settings.json',
                    '--output', str(public / 'pins/predictions.json')], cwd=ROOT, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--only', help='Run id to (re)record')
    parser.add_argument('--force', action='store_true', help='Re-record even if complete')
    args = parser.parse_args()
    check_seeds(ROOT / 'config')
    for run_id, scenario, seed in DEMO_RUNS:
        if args.only and run_id != args.only:
            continue
        if complete(run_id) and not args.force:
            print(f'{run_id}: complete, skipping', flush=True)
            continue
        print(f'{run_id}: recording {scenario} seed {seed}', flush=True)
        run_one(run_id, scenario, seed)
        pins = json.loads((ROOT / 'artifacts/public' / run_id / 'pins/predictions.json').read_text())['methods']['pins']
        print(f'{run_id}: {len(pins)} pins', flush=True)


if __name__ == '__main__':
    main()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_demo_runs.py -q && npm test`
Expected: 3 passed; full root suite passes.

- [ ] **Step 5: Record the runs**

Requires the root Vite server (port 5173) serving the merged simulator; restart it if it was running pre-merge code.
```bash
lsof -ti tcp:5173 | xargs kill 2>/dev/null || true
npm run dev > /tmp/nesttrace-vite.log 2>&1 &          # background; wait until it prints "ready"
.venv/bin/python scripts/demo_runs.py
```
Expected: each run prints `recording …` then `N pins`. Daylight runs should usually have several pins; the night run may have 0 (SWARM_RESULTS.md reports very-dark places no pins) — that is a valid outcome, record it in the report. Total time ~10–15 min.

- [ ] **Step 6: Commit (code only)**

```bash
git add scripts/demo_runs.py tests/test_demo_runs.py
git commit -m "feat(research): record four fresh-seed dashboard demo runs"
```

---

### Task 3: Schema, media mount and snapshot fields

**Files:**
- Modify: `dashboard/web/prisma/schema.prisma`, `dashboard/docker-compose.yml`, `dashboard/.env.example`, `dashboard/.gitignore`, `dashboard/web/src/lib/types.ts`, `dashboard/web/src/server/snapshot.ts`, `dashboard/web/src/features/cameras/CameraPanel.tsx` (prop rename only), `dashboard/web/tests/unit/snapshot.test.ts`, `dashboard/web/tests/unit/mapScreen.test.tsx`
- Create: `dashboard/web/prisma/migrations/<timestamp>_sim_feeds/migration.sql` (generated), `dashboard/web/src/lib/media.ts`
- Test: `dashboard/web/tests/unit/media.test.ts`, updated `snapshot.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export type VideoSource = 'UPLOAD' | 'SIMULATION';
  export type EvidenceTier = 'TWO_CAMERA' | 'SINGLE_CAMERA';
  export interface CameraVideo { id: string; source: VideoSource; durationS: number | null; hasMotion: boolean; simRunId: string | null }
  // CameraView: replaces latestVideoId with
  video: CameraVideo | null;
  // AlertView adds
  videoId: string; simRunId: string | null; startT: number; endT: number; evidenceTier: EvidenceTier | null; simulated: boolean;
  // media.ts
  export function mediaRoot(): string;                               // absolute; env MEDIA_ROOT, default <repo>/dashboard/media
  export function resolveMediaPath(relative: string, root?: string): string | null; // null if outside root
  ```

- [ ] **Step 1: Schema change**

In `schema.prisma` add:
```prisma
enum VideoSource {
  UPLOAD
  SIMULATION
}

enum EvidenceTier {
  TWO_CAMERA
  SINGLE_CAMERA
}
```
Change `model Video`:
```prisma
model Video {
  id             String      @id @default(cuid())
  cameraId       String
  camera         Camera      @relation(fields: [cameraId], references: [id])
  source         VideoSource @default(UPLOAD)
  /// Path relative to MEDIA_ROOT.
  path           String
  /// Pure-motion variant, relative to MEDIA_ROOT (simulation imports).
  pureMotionPath String?
  /// Research run id for simulation imports.
  simRunId       String?
  originalName   String
  durationS      Float?
  fps            Float?
  width          Int?
  height         Int?
  uploadedById   String?
  uploadedBy     User?       @relation(fields: [uploadedById], references: [id])
  createdAt      DateTime    @default(now())
  jobs           Job[]
  tracks         Track[]
  alerts         Alert[]

  @@index([cameraId, createdAt])
  @@index([simRunId])
}
```
In `model Alert` add after `outsideCalibratedArea`:
```prisma
  evidenceTier          EvidenceTier?
  simulated             Boolean             @default(false)
```
Run (from `dashboard/web`, db container up): `npx prisma migrate dev --name sim_feeds && npm run db:test:prepare`
Expected: new migration folder; client regenerated; test DB migrated.

- [ ] **Step 2: Media bind mount and env**

`dashboard/docker-compose.yml` → in `web.volumes` replace `- media:/media` with `- ./media:/media`, and remove `media:` from the top-level `volumes:` list (keep `pgdata:`).
`dashboard/.env.example` → change `MEDIA_ROOT=/media` to:
```bash
# Host path for media when running Next.js or CLIs outside Docker (Compose overrides with /media).
MEDIA_ROOT=../media
```
Update your local `dashboard/.env` and `dashboard/web/.env` the same way (not committed).
`dashboard/.gitignore` → add a line `media/`.

- [ ] **Step 3: Write failing media tests**

`dashboard/web/tests/unit/media.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { mediaRoot, resolveMediaPath } from '@/lib/media';

describe('media paths', () =>
{
    const root = '/srv/media';

    it('resolves a relative path inside the root', () =>
    {
        expect(resolveMediaPath('sim/RUN/camera-0.mp4', root)).toBe('/srv/media/sim/RUN/camera-0.mp4');
    });

    it('rejects traversal and absolute paths', () =>
    {
        expect(resolveMediaPath('../etc/passwd', root)).toBeNull();
        expect(resolveMediaPath('sim/../../etc/passwd', root)).toBeNull();
        expect(resolveMediaPath('/etc/passwd', root)).toBeNull();
        expect(resolveMediaPath('', root)).toBeNull();
    });

    it('mediaRoot is absolute and honours MEDIA_ROOT relative to cwd', () =>
    {
        const previous = process.env.MEDIA_ROOT;
        process.env.MEDIA_ROOT = '../media';
        try
        {
            expect(mediaRoot()).toBe(resolve(process.cwd(), '../media'));
        }
        finally
        {
            process.env.MEDIA_ROOT = previous;
        }
    });
});
```
Run: `npx vitest run tests/unit/media.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement `src/lib/media.ts`**

```ts
import { isAbsolute, relative, resolve, sep } from 'node:path';

// Absolute media directory. Compose sets /media; host dev uses ../media (dashboard/media).
export function mediaRoot(): string
{
    return resolve(process.cwd(), process.env.MEDIA_ROOT || '../media');
}

// Joins a DB-stored relative path onto the media root; null if it would escape the root.
export function resolveMediaPath(relativePath: string, root: string = mediaRoot()): string | null
{
    if (!relativePath || isAbsolute(relativePath))
    {
        return null;
    }
    const full = resolve(root, relativePath);
    const inside = relative(root, full);
    if (!inside || inside.startsWith('..') || inside.split(sep).includes('..') || isAbsolute(inside))
    {
        return null;
    }
    return full;
}
```
Run: `npx vitest run tests/unit/media.test.ts` → PASS (3).

- [ ] **Step 5: Update types and snapshot (tests first)**

In `src/lib/types.ts` add `VideoSource`, `EvidenceTier`, `CameraVideo` exactly as in Interfaces; in `CameraView` replace `latestVideoId: string | null;` with `video: CameraVideo | null;`; in `AlertView` add `videoId: string; simRunId: string | null; startT: number; endT: number; evidenceTier: EvidenceTier | null; simulated: boolean;`.

Update `tests/unit/snapshot.test.ts` fixtures and expectations:
- camera rows' `videos` become `[{ id: 'v9', source: 'SIMULATION', durationS: 61.5, pureMotionPath: 'sim/R/motion-0.mp4', simRunId: 'R' }]` and `[]`;
- expect `snapshot.cameras[0].video` toEqual `{ id: 'v9', source: 'SIMULATION', durationS: 61.5, hasMotion: true, simRunId: 'R' }` and `snapshot.cameras[1].video` toBeNull();
- alert rows add `videoId: 'v9', video: { simRunId: 'R' }, startT: 12, endT: 30, evidenceTier: 'TWO_CAMERA', simulated: true` (and for a2: `videoId: 'v9', video: { simRunId: null }, startT: 0, endT: 1, evidenceTier: null, simulated: false`);
- expect `snapshot.alerts[0]` toMatchObject `{ videoId: 'v9', simRunId: 'R', startT: 12, endT: 30, evidenceTier: 'TWO_CAMERA', simulated: true }`.

Update `tests/unit/mapScreen.test.tsx` fixture: `latestVideoId: null` → `video: null`.
Run: `npx vitest run tests/unit/snapshot.test.ts` → FAIL.

- [ ] **Step 6: Implement snapshot changes**

In `src/server/snapshot.ts`:
- `CameraRow.videos` type → `{ id: string; source: VideoSource; durationS: number | null; pureMotionPath: string | null; simRunId: string | null }[]`.
- `AlertRow` adds `videoId: string; video: { simRunId: string | null }; startT: number; endT: number; evidenceTier: EvidenceTier | null; simulated: boolean`.
- In `toMapSnapshot` cameras: replace `latestVideoId: …` with
```ts
        video: camera.videos[0]
            ? {
                id: camera.videos[0].id,
                source: camera.videos[0].source,
                durationS: camera.videos[0].durationS,
                hasMotion: camera.videos[0].pureMotionPath !== null,
                simRunId: camera.videos[0].simRunId,
            }
            : null,
```
- alerts add `videoId: alert.videoId, simRunId: alert.video.simRunId, startT: alert.startT, endT: alert.endT, evidenceTier: alert.evidenceTier, simulated: alert.simulated,`.
- In `getMapSnapshot` camera include `videos`:
```ts
                videos: {
                    where: { OR: [{ source: 'SIMULATION' }, { jobs: { some: { status: 'DONE' } } }] },
                    select: { id: true, source: true, durationS: true, pureMotionPath: true, simRunId: true },
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                },
```
- alert include adds `video: { select: { simRunId: true } }`.
- `CameraPanel.tsx`: update the header comment to say the player is shown when `camera.video` is set (Task 6 adds it). No behaviour change.

Run: `npx vitest run && npx tsc --noEmit` → all PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add dashboard/docker-compose.yml dashboard/.env.example dashboard/.gitignore dashboard/web/prisma dashboard/web/src/lib/media.ts dashboard/web/src/lib/types.ts dashboard/web/src/server/snapshot.ts dashboard/web/src/features/cameras/CameraPanel.tsx dashboard/web/tests
git commit -m "feat(dashboard): video source, evidence tier and media root for simulation feeds"
```

---

### Task 4: Authenticated Range media route

**Files:**
- Create: `dashboard/web/src/lib/range.ts`, `dashboard/web/src/app/api/media/video/[videoId]/route.ts`
- Test: `dashboard/web/tests/unit/range.test.ts`, `dashboard/web/tests/unit/media-route.test.ts`

**Interfaces:**
- Consumes: `getSession` (`@/lib/auth/guard`), `prisma`, `resolveMediaPath`.
- Produces: `parseRange(header: string | null, size: number): { start: number; end: number } | 'unsatisfiable' | null` (null = no/ignored header → full body); `GET /api/media/video/:videoId?variant=raw|motion`.

- [ ] **Step 1: Failing `parseRange` tests**

`tests/unit/range.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseRange } from '@/lib/range';

describe('parseRange', () =>
{
    const size = 1000;
    it('handles open-ended, bounded and suffix ranges', () =>
    {
        expect(parseRange('bytes=0-', size)).toEqual({ start: 0, end: 999 });
        expect(parseRange('bytes=100-199', size)).toEqual({ start: 100, end: 199 });
        expect(parseRange('bytes=-500', size)).toEqual({ start: 500, end: 999 });
        expect(parseRange('bytes=900-5000', size)).toEqual({ start: 900, end: 999 });
    });
    it('returns null when absent or malformed (serve whole file)', () =>
    {
        expect(parseRange(null, size)).toBeNull();
        expect(parseRange('items=0-1', size)).toBeNull();
        expect(parseRange('bytes=abc', size)).toBeNull();
        expect(parseRange('bytes=0-1,5-6', size)).toBeNull();
    });
    it('flags unsatisfiable ranges', () =>
    {
        expect(parseRange('bytes=1000-', size)).toBe('unsatisfiable');
        expect(parseRange('bytes=500-100', size)).toBe('unsatisfiable');
        expect(parseRange('bytes=-0', size)).toBe('unsatisfiable');
    });
});
```
Run → FAIL.

- [ ] **Step 2: Implement `src/lib/range.ts`**

```ts
// Single-range HTTP Range parsing. Multi-range and malformed headers fall back to a full response.
export function parseRange(header: string | null, size: number): { start: number; end: number } | 'unsatisfiable' | null
{
    const match = header?.match(/^bytes=(\d*)-(\d*)$/);
    if (!match || (match[1] === '' && match[2] === ''))
    {
        return null;
    }

    if (match[1] === '')
    {
        const suffix = Number(match[2]);
        if (suffix === 0)
        {
            return 'unsatisfiable';
        }
        return { start: Math.max(0, size - suffix), end: size - 1 };
    }

    const start = Number(match[1]);
    const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
    if (start >= size || start > end)
    {
        return 'unsatisfiable';
    }
    return { start, end };
}
```
Run `npx vitest run tests/unit/range.test.ts` → PASS.

- [ ] **Step 3: Failing route test**

`tests/unit/media-route.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const getSession = vi.fn();
const findUnique = vi.fn();
vi.mock('@/lib/auth/guard', () => ({ getSession }));
vi.mock('@/lib/db', () => ({ prisma: { video: { findUnique } } }));

const { GET } = await import('@/app/api/media/video/[videoId]/route');

let root: string;
const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));

beforeAll(() =>
{
    root = mkdtempSync(join(tmpdir(), 'nt-media-'));
    mkdirSync(join(root, 'sim/R'), { recursive: true });
    writeFileSync(join(root, 'sim/R/camera-0.mp4'), bytes);
    writeFileSync(join(root, 'sim/R/motion-0.mp4'), bytes.subarray(0, 10));
    process.env.MEDIA_ROOT = root;
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
beforeEach(() =>
{
    getSession.mockResolvedValue({ id: 'u', email: 'a@b.cd', name: 'A', role: 'VIEWER' });
    findUnique.mockResolvedValue({ path: 'sim/R/camera-0.mp4', pureMotionPath: 'sim/R/motion-0.mp4' });
});

const call = (query = '', headers: Record<string, string> = {}) =>
    GET(new Request(`http://x/api/media/video/v1${query}`, { headers }), { params: Promise.resolve({ videoId: 'v1' }) });

describe('GET /api/media/video/:id', () =>
{
    it('401 without a session', async () =>
    {
        getSession.mockResolvedValue(null);
        expect((await call()).status).toBe(401);
    });

    it('404 for unknown video or escaping path', async () =>
    {
        findUnique.mockResolvedValueOnce(null);
        expect((await call()).status).toBe(404);
        findUnique.mockResolvedValueOnce({ path: '../outside.mp4', pureMotionPath: null });
        expect((await call()).status).toBe(404);
    });

    it('200 full body with accept-ranges', async () =>
    {
        const response = await call();
        expect(response.status).toBe(200);
        expect(response.headers.get('accept-ranges')).toBe('bytes');
        expect(response.headers.get('content-type')).toBe('video/mp4');
        expect(Buffer.from(await response.arrayBuffer()).length).toBe(1000);
    });

    it('206 partial content', async () =>
    {
        const response = await call('', { range: 'bytes=100-199' });
        expect(response.status).toBe(206);
        expect(response.headers.get('content-range')).toBe('bytes 100-199/1000');
        expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes.subarray(100, 200));
    });

    it('416 when unsatisfiable', async () =>
    {
        const response = await call('', { range: 'bytes=5000-' });
        expect(response.status).toBe(416);
        expect(response.headers.get('content-range')).toBe('bytes */1000');
    });

    it('serves the motion variant, 404 if absent', async () =>
    {
        expect(Buffer.from(await (await call('?variant=motion')).arrayBuffer()).length).toBe(10);
        findUnique.mockResolvedValueOnce({ path: 'sim/R/camera-0.mp4', pureMotionPath: null });
        expect((await call('?variant=motion')).status).toBe(404);
    });
});
```
Run → FAIL.

- [ ] **Step 4: Implement the route**

`src/app/api/media/video/[videoId]/route.ts`:
```ts
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { getSession } from '@/lib/auth/guard';
import { prisma } from '@/lib/db';
import { resolveMediaPath } from '@/lib/media';
import { parseRange } from '@/lib/range';

export const dynamic = 'force-dynamic';

// Streams a stored video. The file path always comes from the database row, never the request.
export async function GET(request: Request, context: { params: Promise<{ videoId: string }> }): Promise<Response>
{
    if (!(await getSession()))
    {
        return new Response('Unauthorized', { status: 401 });
    }

    const { videoId } = await context.params;
    const variant = new URL(request.url).searchParams.get('variant') === 'motion' ? 'motion' : 'raw';
    const video = await prisma.video.findUnique({ where: { id: videoId }, select: { path: true, pureMotionPath: true } });
    const relativePath = variant === 'motion' ? video?.pureMotionPath : video?.path;
    const fullPath = relativePath ? resolveMediaPath(relativePath) : null;

    let size: number;
    try
    {
        size = fullPath ? statSync(fullPath).size : -1;
    }
    catch
    {
        size = -1;
    }
    if (!fullPath || size < 0)
    {
        return new Response('Not found', { status: 404 });
    }

    const headers = new Headers({ 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' });
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
    const body = Readable.toWeb(createReadStream(fullPath, { start, end })) as ReadableStream;
    return new Response(body, { status: range ? 206 : 200, headers });
}
```

- [ ] **Step 5: Run tests, type-check, commit**

Run: `npx vitest run tests/unit/range.test.ts tests/unit/media-route.test.ts && npx vitest run && npx tsc --noEmit`
Expected: PASS; clean.
```bash
git add dashboard/web/src/lib/range.ts "dashboard/web/src/app/api/media" dashboard/web/tests/unit/range.test.ts dashboard/web/tests/unit/media-route.test.ts
git commit -m "feat(dashboard): authenticated range-capable media route"
```

---

### Task 5: `sim-import-v1` adapter and CLI

**Files:**
- Modify: `dashboard/web/src/lib/geo.ts` (add `bearingBetween`), `dashboard/web/package.json` (script)
- Create: `dashboard/web/src/lib/sim/schema.ts`, `dashboard/web/src/lib/sim/frame.ts`, `dashboard/web/src/lib/sim/importRun.ts`, `dashboard/web/scripts/sim-import.ts`
- Test: `dashboard/web/tests/unit/sim-frame.test.ts`, `dashboard/web/tests/integration/sim-import.test.ts`

**Interfaces:**
- Consumes: `destinationPoint`, `createPrismaClient`, `seedDatabase` (tests), `ALERT_MESSAGES`, `LngLat`.
- Produces:
  ```ts
  // geo.ts
  export function bearingBetween(from: LngLat, to: LngLat): number; // degrees 0..360, 0 = north
  // sim/frame.ts
  export interface ZoneFrame { origin: LngLat; alongBearing: number }
  export function zoneFrame(ring: LngLat[]): ZoneFrame;            // ring as seeded: [landNorth, landSouth, seaSouth, seaNorth, landNorth]
  export function simPointToLngLat(frame: ZoneFrame, point: [number, number]): LngLat;
  // sim/importRun.ts
  export const SIM_IMPORT_SCHEMA = 'sim-import-v1';
  export interface ImportResult { runId: string; videoIds: [string, string]; alertCount: number }
  export function importSimRun(options: { runDir: string; pair: 'A' | 'B' | 'C' | 'D'; mediaRoot: string; prisma: PrismaClient }): Promise<ImportResult>;
  ```
- CLI: `npm run sim:import -- --run <dir> --pair <A|B|C|D>`

- [ ] **Step 1: Failing frame tests**

`tests/unit/sim-frame.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { bearingBetween, destinationPoint } from '@/lib/geo';
import { simPointToLngLat, zoneFrame } from '@/lib/sim/frame';
import { SEED_ZONES } from '../../prisma/seed-data';

function metres(a: [number, number], b: [number, number]): number
{
    const k = Math.PI / 180;
    const x = (b[0] - a[0]) * k * Math.cos(((a[1] + b[1]) / 2) * k);
    return Math.hypot(x, (b[1] - a[1]) * k) * 6371008.8;
}

const ring = SEED_ZONES.find(zone => zone.code === 'B')!.outline.coordinates[0] as [number, number][];

describe('bearingBetween', () =>
{
    it('matches destinationPoint', () =>
    {
        const origin: [number, number] = [-97.06, 27.81];
        expect(bearingBetween(origin, destinationPoint(origin, 33, 200))).toBeCloseTo(33, 1);
        expect(bearingBetween(origin, destinationPoint(origin, 270, 200))).toBeCloseTo(270, 1);
    });
});

describe('zone frame', () =>
{
    const frame = zoneFrame(ring);

    it('puts the origin at the corner centroid', () =>
    {
        const corners = ring.slice(0, 4);
        const centroid: [number, number] = [corners.reduce((s, p) => s + p[0], 0) / 4, corners.reduce((s, p) => s + p[1], 0) / 4];
        expect(metres(frame.origin, centroid)).toBeLessThan(0.01);
        expect(simPointToLngLat(frame, [0, 0])).toEqual(frame.origin);
    });

    it('runs +x from land-south toward land-north (roughly NNE along this beach)', () =>
    {
        expect(frame.alongBearing).toBeCloseTo(bearingBetween(ring[1], ring[0]), 6);
        expect(frame.alongBearing).toBeGreaterThan(20);
        expect(frame.alongBearing).toBeLessThan(60);
    });

    it('keeps true scale and sends +y inland (away from the sea side)', () =>
    {
        const ahead = simPointToLngLat(frame, [12, 0]);
        expect(metres(frame.origin, ahead)).toBeCloseTo(12, 1);
        const inland = simPointToLngLat(frame, [0, 8]);
        expect(metres(frame.origin, inland)).toBeCloseTo(8, 1);
        const seaMid: [number, number] = [(ring[2][0] + ring[3][0]) / 2, (ring[2][1] + ring[3][1]) / 2];
        expect(metres(inland, seaMid)).toBeGreaterThan(metres(frame.origin, seaMid));
    });
});
```
Run → FAIL.

- [ ] **Step 2: Implement `bearingBetween` and `sim/frame.ts`**

Append to `src/lib/geo.ts`:
```ts
// Initial great-circle bearing from one point to another, degrees clockwise from north.
export function bearingBetween([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number
{
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δλ = toRad(lng2 - lng1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
```
(`toRad`/`toDeg` already exist in `geo.ts`; if they are named differently, use the existing helpers.)

`src/lib/sim/frame.ts`:
```ts
import { bearingBetween, destinationPoint } from '@/lib/geo';
import type { LngLat } from '@/lib/types';

export interface ZoneFrame
{
    origin: LngLat;
    alongBearing: number;
}

// Simulator ground frame placed on a zone: x along the shore (land-south → land-north),
// y inland, true scale, origin at the corner centroid.
export function zoneFrame(ring: LngLat[]): ZoneFrame
{
    const corners = ring.slice(0, 4);
    const origin: LngLat = [
        corners.reduce((sum, point) => sum + point[0], 0) / corners.length,
        corners.reduce((sum, point) => sum + point[1], 0) / corners.length,
    ];
    return { origin, alongBearing: bearingBetween(ring[1], ring[0]) };
}

export function simPointToLngLat(frame: ZoneFrame, [x, y]: [number, number]): LngLat
{
    if (x === 0 && y === 0)
    {
        return frame.origin;
    }
    const along = x === 0 ? frame.origin : destinationPoint(frame.origin, x >= 0 ? frame.alongBearing : frame.alongBearing + 180, Math.abs(x));
    return y === 0 ? along : destinationPoint(along, y >= 0 ? frame.alongBearing - 90 : frame.alongBearing + 90, Math.abs(y));
}
```
Run `npx vitest run tests/unit/sim-frame.test.ts` → PASS (4).

- [ ] **Step 3: Implement schemas**

`src/lib/sim/schema.ts`:
```ts
import { z } from 'zod';

// sim-import-v1: the only simulator files the dashboard reads, all from a run's public folder.
export const pinSchema = z.object({
    id: z.string(),
    point: z.tuple([z.number(), z.number()]),
    interval: z.tuple([z.number(), z.number()]),
    score: z.number(),
    evidence_tier: z.enum(['two_camera', 'single_camera']),
    source_views: z.array(z.number()).min(1),
});

export const pinsFileSchema = z.object({
    schema_version: z.literal(1),
    methods: z.object({ pins: z.array(pinSchema) }),
});

export const calibrationSchema = z.object({
    camera: z.number(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    ground_bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});

export const timestampsSchema = z.array(z.number()).min(2);

export type SimPin = z.infer<typeof pinSchema>;
```

- [ ] **Step 4: Failing integration test for `importSimRun`**

`tests/integration/sim-import.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrismaClient } from '@/lib/db';
import { importSimRun } from '@/lib/sim/importRun';
import { seedDatabase } from '../../prisma/seed';

const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
let work: string;

function makeRun(name: string, pins: unknown[] | null): string
{
    const dir = join(work, 'artifacts/public', name);
    mkdirSync(join(dir, 'view-0'), { recursive: true });
    mkdirSync(join(dir, 'view-1'), { recursive: true });
    for (const file of ['camera-0.mp4', 'camera-1.mp4', 'view-0/pure-motion.mp4', 'view-1/pure-motion.mp4'])
    {
        writeFileSync(join(dir, file), `video:${name}:${file}`);
    }
    for (const camera of [0, 1])
    {
        writeFileSync(join(dir, `calibration-${camera}.json`), JSON.stringify({ camera, width: 1280, height: 720, ground_bounds: [-12, 12, -8, 8] }));
    }
    writeFileSync(join(dir, 'timestamps.json'), JSON.stringify(Array.from({ length: 81 }, (_, i) => i * 0.125)));
    writeFileSync(join(dir, 'analysis.json'), JSON.stringify({ cameras: [0, 1], inference_complete: true }));
    if (pins)
    {
        mkdirSync(join(dir, 'pins'), { recursive: true });
        writeFileSync(join(dir, 'pins/predictions.json'), JSON.stringify({ schema_version: 1, methods: { pins } }));
    }
    return dir;
}

const pin = (id: string, tier: 'two_camera' | 'single_camera') => ({
    id, point: [2, 3], interval: [4, 9], score: 1.2, evidence_tier: tier, source_views: tier === 'two_camera' ? [0, 1] : [1],
});

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
    await prisma.$executeRawUnsafe('TRUNCATE "AuditLog","AlertStatusChange","AlertNote","Alert","Track","Job","Video","Camera","Zone","User" CASCADE');
    await seedDatabase(prisma, { adminEmail: 'admin@test.local', adminPassword: 'pw-for-tests' });
    work = mkdtempSync(join(tmpdir(), 'nt-sim-'));
});
afterAll(async () =>
{
    await prisma.$disconnect();
});

describe('importSimRun', () =>
{
    it('imports two looping videos and one alert per pin', async () =>
    {
        const runDir = makeRun('A-swarm-demo-907', [pin('pin-1', 'two_camera'), pin('pin-2', 'single_camera')]);
        const media = join(work, 'media');
        const result = await importSimRun({ runDir, pair: 'B', mediaRoot: media, prisma });

        expect(result.alertCount).toBe(2);
        const videos = await prisma.video.findMany({ where: { simRunId: 'A-swarm-demo-907' }, include: { camera: true }, orderBy: { camera: { code: 'asc' } } });
        expect(videos.map(video => [video.camera.code, video.source, video.path, video.pureMotionPath])).toEqual([
            ['B1', 'SIMULATION', 'sim/A-swarm-demo-907/camera-0.mp4', 'sim/A-swarm-demo-907/motion-0.mp4'],
            ['B2', 'SIMULATION', 'sim/A-swarm-demo-907/camera-1.mp4', 'sim/A-swarm-demo-907/motion-1.mp4'],
        ]);
        expect(videos[0].durationS).toBeCloseTo(10.125, 3);
        expect(videos[0].fps).toBeCloseTo(8, 3);
        expect(videos[0].width).toBe(1280);
        expect(readFileSync(join(media, 'sim/A-swarm-demo-907/motion-1.mp4'), 'utf8')).toBe('video:A-swarm-demo-907:view-1/pure-motion.mp4');
        expect(existsSync(join(media, 'sim/A-swarm-demo-907/import-manifest.json'))).toBe(true);

        const alerts = await prisma.alert.findMany({ orderBy: { score: 'desc' } });
        expect(alerts.every(alert => alert.message === 'Digging activity detected; nesting unresolved.')).toBe(true);
        expect(alerts.map(alert => alert.evidenceTier).sort()).toEqual(['SINGLE_CAMERA', 'TWO_CAMERA']);
        expect(alerts[0]).toMatchObject({ kind: 'DIGGING', simulated: true, startT: 4, endT: 9, videoId: videos[0].id, status: 'NEW' });
        expect(alerts[0].lng).not.toBeNull();
    });

    it('is idempotent for the same run', async () =>
    {
        const runDir = makeRun('A-swarm-demo-907', [pin('pin-1', 'two_camera')]);
        const media = join(work, 'media');
        await importSimRun({ runDir, pair: 'B', mediaRoot: media, prisma });
        await importSimRun({ runDir, pair: 'B', mediaRoot: media, prisma });
        expect(await prisma.video.count()).toBe(2);
        expect(await prisma.alert.count()).toBe(1);
    });

    it('imports videos without alerts when there is no pins file', async () =>
    {
        const runDir = makeRun('A-swarm-night-demo-919', null);
        const result = await importSimRun({ runDir, pair: 'D', mediaRoot: join(work, 'media'), prisma });
        expect(result.alertCount).toBe(0);
        expect(await prisma.video.count()).toBe(2);
    });

    it('refuses private paths and missing files before copying anything', async () =>
    {
        const media = join(work, 'media');
        const privateDir = join(work, 'artifacts/private/A-swarm-demo-907');
        mkdirSync(privateDir, { recursive: true });
        await expect(importSimRun({ runDir: privateDir, pair: 'B', mediaRoot: media, prisma })).rejects.toThrow(/private/);
        const broken = makeRun('A-broken', null);
        rmSync(join(broken, 'camera-1.mp4'));
        await expect(importSimRun({ runDir: broken, pair: 'B', mediaRoot: media, prisma })).rejects.toThrow(/camera-1\.mp4/);
        expect(existsSync(join(media, 'sim'))).toBe(false);
    });

    it('rejects a malformed pins file', async () =>
    {
        const runDir = makeRun('A-bad-pins', [{ id: 'x' }]);
        await expect(importSimRun({ runDir, pair: 'B', mediaRoot: join(work, 'media'), prisma })).rejects.toThrow();
        expect(await prisma.video.count()).toBe(0);
    });
});
```
Run: `npm run db:test:prepare && npx vitest run tests/integration/sim-import.test.ts` → FAIL (module not found).

- [ ] **Step 5: Implement `src/lib/sim/importRun.ts`**

```ts
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import type { PrismaClient } from '@/generated/prisma/client';
import { ALERT_MESSAGES, type LngLat } from '@/lib/types';
import { simPointToLngLat, zoneFrame } from './frame';
import { calibrationSchema, pinsFileSchema, timestampsSchema, type SimPin } from './schema';

export const SIM_IMPORT_SCHEMA = 'sim-import-v1';

export interface ImportResult
{
    runId: string;
    videoIds: [string, string];
    alertCount: number;
}

const REQUIRED = ['camera-0.mp4', 'camera-1.mp4', 'view-0/pure-motion.mp4', 'view-1/pure-motion.mp4', 'calibration-0.json', 'calibration-1.json', 'timestamps.json', 'analysis.json'];
// source file in the run folder -> destination name in media/sim/<run>/
const COPIES: [string, string][] = [
    ['camera-0.mp4', 'camera-0.mp4'],
    ['camera-1.mp4', 'camera-1.mp4'],
    ['view-0/pure-motion.mp4', 'motion-0.mp4'],
    ['view-1/pure-motion.mp4', 'motion-1.mp4'],
];

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

export async function importSimRun({ runDir, pair, mediaRoot, prisma }: {
    runDir: string; pair: 'A' | 'B' | 'C' | 'D'; mediaRoot: string; prisma: PrismaClient;
}): Promise<ImportResult>
{
    const dir = resolve(runDir);
    if (dir.split(sep).includes('private'))
    {
        throw new Error(`Refusing to import from a private path: ${dir}`);
    }
    const missing = REQUIRED.filter(file => !existsSync(join(dir, file)));
    if (missing.length)
    {
        throw new Error(`Run is missing required public files: ${missing.join(', ')}`);
    }

    const runId = basename(dir);
    const calibration = calibrationSchema.parse(readJson(join(dir, 'calibration-0.json')));
    const timestamps = timestampsSchema.parse(readJson(join(dir, 'timestamps.json')));
    const pinsPath = join(dir, 'pins/predictions.json');
    const pins: SimPin[] = existsSync(pinsPath) ? pinsFileSchema.parse(readJson(pinsPath)).methods.pins : [];

    const step = timestamps[1] - timestamps[0];
    const fps = 1 / step;
    const durationS = timestamps[timestamps.length - 1] + step;

    const zone = await prisma.zone.findUniqueOrThrow({ where: { code: pair } });
    const cameras = await Promise.all([1, 2].map(n => prisma.camera.findUniqueOrThrow({ where: { code: `${pair}${n}` } })));
    const ring = (zone.outline as { coordinates: LngLat[][] }).coordinates[0];
    const frame = zoneFrame(ring);

    // Copy media and write the manifest only after every input validated.
    const target = join(mediaRoot, 'sim', runId);
    mkdirSync(target, { recursive: true });
    for (const [source, destination] of COPIES)
    {
        copyFileSync(join(dir, source), join(target, destination));
    }
    const manifestFiles = [...REQUIRED, ...(existsSync(pinsPath) ? ['pins/predictions.json'] : [])];
    writeFileSync(join(target, 'import-manifest.json'), JSON.stringify({
        schema: SIM_IMPORT_SCHEMA,
        runId,
        pair,
        importedAt: new Date().toISOString(),
        files: Object.fromEntries(manifestFiles.map(file => [file, sha256(join(dir, file))])),
    }, null, 2));

    const relative = (name: string) => `sim/${runId}/${name}`;

    return prisma.$transaction(async tx =>
    {
        const old = await tx.video.findMany({ where: { simRunId: runId }, select: { id: true } });
        await tx.alert.deleteMany({ where: { videoId: { in: old.map(video => video.id) } } });
        await tx.video.deleteMany({ where: { simRunId: runId } });

        const videos = await Promise.all(cameras.map((camera, index) => tx.video.create({
            data: {
                cameraId: camera.id,
                source: 'SIMULATION',
                path: relative(`camera-${index}.mp4`),
                pureMotionPath: relative(`motion-${index}.mp4`),
                simRunId: runId,
                originalName: `${runId}/camera-${index}.mp4`,
                durationS,
                fps,
                width: calibration.width,
                height: calibration.height,
            },
        })));

        for (const simPin of pins)
        {
            const [lng, lat] = simPointToLngLat(frame, simPin.point);
            await tx.alert.create({
                data: {
                    videoId: videos[0].id,
                    cameraId: cameras[0].id,
                    zoneId: zone.id,
                    kind: 'DIGGING',
                    message: ALERT_MESSAGES.DIGGING,
                    score: simPin.score,
                    lng,
                    lat,
                    radiusM: 0.9,
                    startT: simPin.interval[0],
                    endT: simPin.interval[1],
                    evidenceTier: simPin.evidence_tier === 'two_camera' ? 'TWO_CAMERA' : 'SINGLE_CAMERA',
                    simulated: true,
                },
            });
        }

        return { runId, videoIds: [videos[0].id, videos[1].id] as [string, string], alertCount: pins.length };
    });
}
```
Note the order: validation (paths, files, zod, zone/camera lookups) happens before any copy, so the "refuses … before copying" and "malformed pins" tests leave `media/sim` absent and the DB untouched.

- [ ] **Step 6: CLI**

`dashboard/web/scripts/sim-import.ts`:
```ts
import 'dotenv/config';
import { createPrismaClient } from '../src/lib/db';
import { mediaRoot } from '../src/lib/media';
import { importSimRun } from '../src/lib/sim/importRun';

// Usage: npm run sim:import -- --run ../../artifacts/public/A-swarm-demo-907 --pair B
const args = Object.fromEntries(process.argv.slice(2).reduce<[string, string][]>((pairs, value, index, all) =>
{
    if (value.startsWith('--'))
    {
        pairs.push([value.slice(2), all[index + 1]]);
    }
    return pairs;
}, []));

const pair = String(args.pair ?? '').toUpperCase();
if (!args.run || !['A', 'B', 'C', 'D'].includes(pair))
{
    console.error('Usage: npm run sim:import -- --run <artifacts/public/RUN> --pair <A|B|C|D>');
    process.exit(2);
}

const prisma = createPrismaClient();
try
{
    const result = await importSimRun({ runDir: args.run, pair: pair as 'A' | 'B' | 'C' | 'D', mediaRoot: mediaRoot(), prisma });
    console.log(`Imported ${result.runId} onto ${pair}1/${pair}2 with ${result.alertCount} alert(s).`);
}
finally
{
    await prisma.$disconnect();
}
```
`package.json` scripts: add `"sim:import": "tsx scripts/sim-import.ts"`.
Add `"scripts/**/*.ts"` to `tsconfig.json` `include` if it is not already covered.

- [ ] **Step 7: Run tests, boundary, commit**

Run: `npx vitest run tests/integration/sim-import.test.ts tests/unit/sim-frame.test.ts && npx vitest run && npx tsc --noEmit`
Expected: PASS (5 integration + 4 unit), full suite green — including `boundary.test.ts` (the adapter takes the run path as an argument and contains no `artifacts/private` literal).
```bash
git add dashboard/web/src/lib/geo.ts dashboard/web/src/lib/sim dashboard/web/scripts/sim-import.ts dashboard/web/package.json dashboard/web/tsconfig.json dashboard/web/tests/unit/sim-frame.test.ts dashboard/web/tests/integration/sim-import.test.ts
git commit -m "feat(dashboard): sim-import-v1 adapter for public simulation runs"
```

---

### Task 6: Looping camera feed, Raw/Motion toggle, time-synced pins

**Files:**
- Create: `dashboard/web/src/features/cameras/CameraVideo.tsx`, `dashboard/web/src/features/map/playback.ts`
- Modify: `dashboard/web/src/features/cameras/CameraPanel.tsx`, `dashboard/web/src/features/map/MapScreen.tsx`, `dashboard/web/src/features/map/MapView.tsx`, `dashboard/web/src/features/alerts/AlertsFeed.tsx`, `dashboard/web/src/features/map/Legend.tsx`
- Test: `dashboard/web/tests/unit/playback.test.ts`, `dashboard/web/tests/unit/cameraVideo.test.tsx`, extend `dashboard/web/tests/unit/mapScreen.test.tsx`

**Interfaces:**
- Consumes: `CameraVideo`, `AlertView` (Task 3), `/api/media/video/:id?variant=` (Task 4).
- Produces:
  ```ts
  // playback.ts
  export interface Playback { key: string; t: number }           // key = simRunId ?? videoId
  export function playbackKey(video: { id: string; simRunId: string | null }): string;
  export function alertKey(alert: { videoId: string; simRunId: string | null }): string;
  export function isActive(alert: AlertView, playback: Playback | null): boolean; // same key and startT - 0.5 <= t <= endT + 0.5
  export function visibleAlerts(alerts: AlertView[], playback: Playback | null): AlertView[]; // no playback: all with position; with playback: active ones of that key
  // CameraVideo.tsx
  export type FeedVariant = 'raw' | 'motion';
  export function CameraVideo(props: { video: CameraVideo; onTime?: (t: number) => void }): JSX.Element;
  ```

- [ ] **Step 1: Failing playback tests**

`tests/unit/playback.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { AlertView } from '@/lib/types';
import { alertKey, isActive, playbackKey, visibleAlerts } from '@/features/map/playback';

const alert = (id: string, simRunId: string | null, startT: number, endT: number, position: [number, number] | null = [1, 2]): AlertView => ({
    id, kind: 'DIGGING', message: 'Digging activity detected; nesting unresolved.', status: 'NEW', zoneCode: 'B', cameraCode: 'B1',
    position, radiusM: 0.9, score: 1, createdAt: '2026-10-09T00:00:00.000Z', videoId: `v-${id}`, simRunId, startT, endT,
    evidenceTier: 'TWO_CAMERA', simulated: simRunId !== null,
});

describe('playback gating', () =>
{
    const alerts = [alert('a', 'R1', 10, 20), alert('b', 'R1', 30, 40), alert('c', 'R2', 10, 20), alert('d', 'R1', 10, 20, null)];

    it('keys simulation videos by run so both cameras of a pair share pins', () =>
    {
        expect(playbackKey({ id: 'v1', simRunId: 'R1' })).toBe('R1');
        expect(playbackKey({ id: 'v1', simRunId: null })).toBe('v1');
        expect(alertKey(alerts[0])).toBe('R1');
    });

    it('activates inside the window with half a second of slack', () =>
    {
        expect(isActive(alerts[0], { key: 'R1', t: 9.6 })).toBe(true);
        expect(isActive(alerts[0], { key: 'R1', t: 20.4 })).toBe(true);
        expect(isActive(alerts[0], { key: 'R1', t: 25 })).toBe(false);
        expect(isActive(alerts[0], { key: 'R2', t: 15 })).toBe(false);
        expect(isActive(alerts[0], null)).toBe(false);
    });

    it('shows all positioned alerts without playback, only active ones with it', () =>
    {
        expect(visibleAlerts(alerts, null).map(a => a.id)).toEqual(['a', 'b', 'c']);
        expect(visibleAlerts(alerts, { key: 'R1', t: 15 }).map(a => a.id)).toEqual(['a']);
        expect(visibleAlerts(alerts, { key: 'R1', t: 50 })).toEqual([]);
    });
});
```
Run → FAIL.

- [ ] **Step 2: Implement `playback.ts`**

```ts
import type { AlertView } from '@/lib/types';

export interface Playback
{
    key: string;
    t: number;
}

const SLACK_S = 0.5;

export function playbackKey(video: { id: string; simRunId: string | null }): string
{
    return video.simRunId ?? video.id;
}

export function alertKey(alert: { videoId: string; simRunId: string | null }): string
{
    return alert.simRunId ?? alert.videoId;
}

export function isActive(alert: AlertView, playback: Playback | null): boolean
{
    return playback !== null
        && alertKey(alert) === playback.key
        && playback.t >= alert.startT - SLACK_S
        && playback.t <= alert.endT + SLACK_S;
}

// Without playback every positioned alert is shown; while a feed plays only its active pins are.
export function visibleAlerts(alerts: AlertView[], playback: Playback | null): AlertView[]
{
    const positioned = alerts.filter(alert => alert.position !== null);
    return playback ? positioned.filter(alert => isActive(alert, playback)) : positioned;
}
```
Run → PASS (3).

- [ ] **Step 3: Failing CameraVideo test**

`tests/unit/cameraVideo.test.tsx`:
```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CameraVideo } from '@/features/cameras/CameraVideo';

afterEach(cleanup);

const video = { id: 'v1', source: 'SIMULATION' as const, durationS: 60, hasMotion: true, simRunId: 'R1' };

describe('CameraVideo', () =>
{
    it('loops the raw feed muted with a SIMULATED badge', () =>
    {
        render(<CameraVideo video={video} />);
        const element = screen.getByTestId('camera-video') as HTMLVideoElement;
        expect(element.getAttribute('src')).toBe('/api/media/video/v1?variant=raw');
        expect(element.loop).toBe(true);
        expect(element.muted).toBe(true);
        expect(screen.getByText('Simulated')).toBeTruthy();
    });

    it('switches to motion and resumes from the same time', () =>
    {
        render(<CameraVideo video={video} />);
        const element = screen.getByTestId('camera-video') as HTMLVideoElement;
        element.currentTime = 12.5;
        fireEvent.click(screen.getByRole('radio', { name: 'Motion' }));
        expect(element.getAttribute('src')).toBe('/api/media/video/v1?variant=motion');
        fireEvent(element, new Event('loadedmetadata'));
        expect(element.currentTime).toBeCloseTo(12.5);
    });

    it('hides the toggle when there is no motion variant', () =>
    {
        render(<CameraVideo video={{ ...video, hasMotion: false }} />);
        expect(screen.queryByRole('radio', { name: 'Motion' })).toBeNull();
    });

    it('reports the clock while playing', () =>
    {
        vi.useFakeTimers();
        const onTime = vi.fn();
        render(<CameraVideo video={video} onTime={onTime} />);
        const element = screen.getByTestId('camera-video') as HTMLVideoElement;
        element.currentTime = 3;
        vi.advanceTimersByTime(300);
        expect(onTime).toHaveBeenCalledWith(3);
        vi.useRealTimers();
    });
});
```
jsdom's `HTMLMediaElement.play` is not implemented; the component must call `play()` guarded (`element.play?.()?.catch?.(() => {})`) so tests don't throw. Run → FAIL.

- [ ] **Step 4: Implement `CameraVideo.tsx`**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import type { CameraVideo as CameraVideoData } from '@/lib/types';

export type FeedVariant = 'raw' | 'motion';

const CLOCK_MS = 250;

// Looping muted feed with an optional Raw/Motion switch. Publishes its clock so the map can gate pins.
export function CameraVideo({ video, onTime }: { video: CameraVideoData; onTime?: (t: number) => void })
{
    const ref = useRef<HTMLVideoElement>(null);
    const resumeAt = useRef<number | null>(null);
    const [variant, setVariant] = useState<FeedVariant>('raw');

    useEffect(() =>
    {
        if (!onTime)
        {
            return undefined;
        }
        const timer = setInterval(() =>
        {
            if (ref.current)
            {
                onTime(ref.current.currentTime);
            }
        }, CLOCK_MS);
        return () => clearInterval(timer);
    }, [onTime]);

    function choose(next: FeedVariant)
    {
        if (next !== variant)
        {
            resumeAt.current = ref.current?.currentTime ?? 0;
            setVariant(next);
        }
    }

    function restore()
    {
        const element = ref.current;
        if (element && resumeAt.current !== null)
        {
            element.currentTime = resumeAt.current;
            resumeAt.current = null;
            element.play?.()?.catch?.(() => undefined);
        }
    }

    return (
        <div className="relative mt-2 overflow-hidden rounded-lg border border-white/6 bg-night-950">
            <video
                ref={ref}
                data-testid="camera-video"
                className="block aspect-video w-full object-cover max-md:aspect-[5/2]"
                src={`/api/media/video/${video.id}?variant=${variant}`}
                autoPlay
                muted
                loop
                playsInline
                onLoadedMetadata={restore}
            />
            {video.source === 'SIMULATION' && (
                <span className="absolute top-2 left-2 rounded-md bg-night-950/80 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.14em] text-amber uppercase ring-1 ring-amber/40">
                    Simulated
                </span>
            )}
            {video.hasMotion && (
                <div role="radiogroup" aria-label="Feed view" className="absolute right-2 bottom-2 flex rounded-md bg-night-950/85 p-0.5 text-[11px] ring-1 ring-white/10">
                    {(['raw', 'motion'] as const).map(option => (
                        <button
                            key={option}
                            type="button"
                            role="radio"
                            aria-checked={variant === option}
                            onClick={() => choose(option)}
                            className={cn('rounded px-2 py-0.5 font-medium capitalize transition-colors focus-visible:outline-2 focus-visible:outline-amber',
                                variant === option ? 'bg-white/12 text-ink' : 'text-ink-muted hover:text-ink')}
                        >
                            {option === 'raw' ? 'Raw' : 'Motion'}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
```
Run `npx vitest run tests/unit/cameraVideo.test.tsx` → PASS (4).

- [ ] **Step 5: Wire CameraPanel, MapScreen, MapView, AlertsFeed, Legend**

`CameraPanel.tsx`:
- Props become `{ camera: CameraView; onClose: () => void; onTime?: (t: number) => void }`.
- Replace the placeholder block (the `div.relative.mt-2.grid.aspect-video…` with "No footage yet"/"Camera offline") with: `camera.video && camera.status === 'ONLINE' ? <CameraVideo key={camera.video.id} video={camera.video} onTime={onTime} /> : <existing placeholder block unchanged>`.

`MapScreen.tsx`:
```tsx
// new state and handlers (inside MapScreen)
const [playback, setPlayback] = useState<Playback | null>(null);
const selectedVideo = selectedCamera?.status === 'ONLINE' ? selectedCamera.video : null;
const handleTime = useCallback((t: number) =>
{
    if (selectedVideo)
    {
        setPlayback({ key: playbackKey(selectedVideo), t });
    }
}, [selectedVideo]);
useEffect(() =>
{
    setPlayback(null);
}, [selectedVideo?.id]);
```
- Pass `onTime={handleTime}` to `CameraPanel`; pass `playback={playback}` to `MapView` and `AlertsFeed`.
- Imports: `useEffect`, `Playback`, `playbackKey` from `./playback`.

`MapView.tsx`:
- Add prop `playback: Playback | null`.
- Build `alertsGeoJson` from `visibleAlerts(snapshot.alerts, playback)` (replace the current `snapshot.alerts.filter(alert => alert.position)`), with `properties: { status: alert.status, tier: alert.evidenceTier ?? 'NONE' }`, and add `playback` to the memo deps.
- Alert circle paint: `'circle-color': ['match', ['get', 'tier'], 'TWO_CAMERA', 'rgba(74,222,128,0.25)', 'SINGLE_CAMERA', 'rgba(255,181,71,0.25)', 'rgba(255,181,71,0.2)']`, `'circle-stroke-color': ['match', ['get', 'tier'], 'TWO_CAMERA', '#4ADE80', '#FFB547']` (cast like the existing `levelColor`).
- Update `tests/unit/mapScreen.test.tsx`'s MapView stub props type to accept `playback` (ignored).

`AlertsFeed.tsx`:
- Add prop `playback: Playback | null` (default `null`).
- For each alert: `const active = isActive(alert, playback)`; add `ring-1 ring-amber/60 bg-amber/10` when `active`.
- Under the meta line, when `alert.simulated`, render `<span className="mt-0.5 block text-[11px] text-ink-muted">Simulated · approximate position{alert.evidenceTier === 'TWO_CAMERA' ? ' · both cameras' : alert.evidenceTier === 'SINGLE_CAMERA' ? ' · one camera' : ''}</span>`.

`Legend.tsx`: replace the "Alert region" row with two rows: green ring "Pin · both cameras", amber ring "Pin · one camera" (same markup style as existing rows; colours `#4ADE80` / `#FFB547`).

- [ ] **Step 6: Extend MapScreen test**

Add to `tests/unit/mapScreen.test.tsx`:
```tsx
    it('plays footage for a camera that has a video', () =>
    {
        const withVideo: MapSnapshot = {
            ...snapshot,
            cameras: [{ ...snapshot.cameras[0], video: { id: 'v1', source: 'SIMULATION', durationS: 60, hasMotion: true, simRunId: 'R1' } }],
        };
        render(<MapScreen snapshot={withVideo} user={user} />);
        fireEvent.click(screen.getByText('cam B1'));
        expect(screen.getByTestId('camera-video').getAttribute('src')).toBe('/api/media/video/v1?variant=raw');
        expect(screen.queryByText('No footage yet')).toBeNull();
    });
```
Run: `npx vitest run && npx tsc --noEmit` → all PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add dashboard/web/src/features dashboard/web/tests/unit/playback.test.ts dashboard/web/tests/unit/cameraVideo.test.tsx dashboard/web/tests/unit/mapScreen.test.tsx
git commit -m "feat(dashboard): looping camera feeds with raw/motion toggle and time-synced pins"
```

---

### Task 7: Import the demo runs, verify end to end, document

**Files:**
- Modify: `dashboard/README.md`, `CLAUDE.md`
- Create (scratchpad only, not committed): Playwright check script

**Interfaces:**
- Consumes: Task 2 runs, Task 5 CLI, running Compose stack.

- [ ] **Step 1: Rebuild the stack and import**

```bash
cd dashboard
docker compose up -d --build            # web now bind-mounts ./media
cd web
for pair in A:A-swarm-demo-901 B:A-swarm-demo-907 C:A-swarm-demo-911 D:A-swarm-night-demo-919; do
  npm run sim:import -- --run ../../artifacts/public/${pair#*:} --pair ${pair%%:*}
done
ls ../media/sim
```
Expected: four "Imported … with N alert(s)" lines; four run folders under `dashboard/media/sim`.

- [ ] **Step 2: End-to-end check with Playwright (scratchpad script)**

Write a script in the session scratchpad that, against `http://127.0.0.1:3000` with system Chrome (`channel: 'chrome'`):
1. logs in as admin (credentials from `dashboard/.env`);
2. clicks camera B1; asserts the panel `video[data-testid=camera-video]` has `readyState >= 2` and `currentTime` advances over 2 s;
3. clicks "Motion"; asserts the `src` ends with `variant=motion` and `currentTime` stayed within 1 s of its value before the click;
4. waits up to one loop (≤ 90 s) for at least one alert circle feature to be visible (query the map: `map.querySourceFeatures('alerts').length > 0` via `window` access, or assert an AlertsFeed item gains the active ring class) — if pair B has no pins, use the pair with the most pins;
5. clicks A2 and asserts "Camera offline" (no video);
6. saves screenshots (desktop B1 raw, B1 motion, pin visible, phone 390×844 B1) to `<scratchpad>/plan-a/`.
Look at every screenshot; fix layout problems before committing.

- [ ] **Step 3: Docs**

`dashboard/README.md` — add a section:
```markdown
## Simulation feeds

Camera feeds loop footage recorded by the research simulator and imported through the `sim-import-v1` adapter. The adapter reads only a run's public outputs and refuses `private/` paths.

```bash
# repo root: record the four demo runs (needs `npm run dev` on port 5173)
.venv/bin/python scripts/demo_runs.py
# dashboard/web: import one run per zone pair
npm run sim:import -- --run ../../artifacts/public/A-swarm-demo-901 --pair A
npm run sim:import -- --run ../../artifacts/public/A-swarm-demo-907 --pair B
npm run sim:import -- --run ../../artifacts/public/A-swarm-demo-911 --pair C
npm run sim:import -- --run ../../artifacts/public/A-swarm-night-demo-919 --pair D
```

Media lands in `dashboard/media/` (git-ignored, bind-mounted into the container). Pins are placed at true scale around each zone's centre and labelled "Simulated · approximate position"; they mark digging activity for inspection, never a confirmed nest.
```
`CLAUDE.md` — in the dashboard commands line, append: `Simulation feeds: repo root .venv/bin/python scripts/demo_runs.py, then in dashboard/web npm run sim:import -- --run ../../artifacts/public/<run> --pair <A-D>.`

- [ ] **Step 4: Full verification and commit**

Run: root `npm test`; `cd dashboard/web && npx vitest run && npx tsc --noEmit`.
```bash
git add dashboard/README.md CLAUDE.md
git commit -m "docs(dashboard): simulation feed recording and import"
```

---

## Self-review notes

- Spec §2.1 → Task 1; §2.2 → Task 2; §2.3 → Tasks 3 (schema) + 5 (adapter, CLI, mapping, manifest, idempotence); §2.4 → Task 4; §2.5 → Task 6; §4 Part A tests → Tasks 2–7 (Playwright in Task 7); docs → Tasks 1, 7.
- Spec correction: pin grouping uses `config/pin-settings.json` (what `scripts/pin_batch.py` passes to `pin_fuse.py`), not `config/pin-registration.json` as §2.2 says.
- Types are consistent across tasks: `CameraVideo`, `AlertView` additions, `Playback`, `playbackKey`, `alertKey`, `isActive`, `visibleAlerts`, `importSimRun`, `zoneFrame`, `simPointToLngLat`, `bearingBetween`, `parseRange`, `resolveMediaPath`, `mediaRoot`.
