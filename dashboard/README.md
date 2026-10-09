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

# 3. Dashboard backend on 127.0.0.1:5182 (drop ":demo" to turn the simulated patrol off)
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
| `NESTTRACE_DASHBOARD_API_PORT` | `5182` | Backend port (loopback only) |
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

## Tests

```powershell
npm --prefix dashboard test
```

The tests cover the adapter contract (including manifests that try to point at private files), map placement, the store's logging, fading, archiving and persistence, the demo patrol, and an integration check that runs the real backend against a fixture chunk built from real pipeline output.
