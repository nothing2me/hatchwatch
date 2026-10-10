# Feed bandwidth and simulation cost

**Status:** measured from the continuous live corpus on the development machine
(Windows, AMD GPU, OnePlus-style recycled phone simulated at 8 fps 1280 × 720).
Reproduce with [`scripts/feed-cost.mjs`](../scripts/feed-cost.mjs), which reads
only public `artifacts/public/live-*` outputs.

This answers the roadmap item *"Audit device bandwidth requirements"* and
*"Evaluate simulation costs"*.

## Measured values (current photoreal daylight scene)

40 published chunks from the 24-hour live runner, 57.8 minutes of wall time:

| Metric | Value |
|---|---:|
| Publish cycle (one 40 s clip, 2 cameras) | **88.8 s** mean |
| Simulation speed vs real time | **0.45×** (footage is ~longer than real time) |
| Source video per chunk (2 × 40 s) | ~16.3 MB (range 15.5 – 17.1) |
| Data rate, pair | **676 MB per clip-hour** |
| Data rate, per camera | **338 MB/h ≈ 0.75 Mbps** mean |
| Blind extraction + detection (both views) | **27.9 s** mean per chunk |
| Video retained (LIVE_KEEP = 40 chunks) | ~651 MB ≈ 26.7 min of footage |
| Pins published over 40 chunks | 3 |

### Night footage (order of magnitude)

The registered very-dark runs recorded at **73.5 MiB per 40 s pair** on the
older scene — ≈ 0.92 MB/s, **~7.4 Mbps for the pair, ~3.7 Mbps per camera**,
roughly **10× the daylight rate**. Sensor/ISO noise defeats compression. Expect
the same blow-up on any real low-light phone camera; a similar effect is why
the very-dark clips (also ~10× dimmer mean gray) exist as a registered failure.

## Extrapolations

| Scenario | Per camera | Pair | For 24 h continuous |
|---|---:|---:|---:|
| Sim daylight 8 fps (measured) | 338 MB/h · 0.75 Mbps | 676 MB/h | **16.2 GB generated**; ~0.65 GB retained (`LIVE_KEEP`) |
| Sim very-dark (older scene) | ~3.7 Mbps | ~7.4 Mbps | ~80 GB generated (if it ran) |
| Real phone 720p@30 H.264 (estimate) | 2.5 – 5 Mbps | 5 – 10 Mbps | 27 – 54 GB per camera per day |

A recycled-phone deployment that streams raw 720p@30 continuous is
6–15 GB per camera per day — infeasible for solar and cellular budgets. The
simulator's design (8 fps, pair, 0.75 Mbps) is the right *shape* for a
low-budget device: **record edge-side, upload decimated/diff clips**, stream
only on alert.

## Simulation cost per real hour of coverage

To cover one real hour of beach patrol with the current node:

- Footage needed: 90 clips × 40 s = 1 h of clip time (2 cameras each).
- Recording/rendering: 90 × ~61 s (88.8 − 27.9 analysis) ≈ **1.5 machine-hours**.
- Blind analysis: 90 × 27.9 s ≈ **0.7 machine-hours**.
- Total ≈ **2.2 h of node + CPU time per hour of footage**, ~676 MB stored per
  hour of footage, growing at ~0.05 GB/min during runs.

This is why the roadmap's "continuous" gate must be phrased as *continuously
produced, honestly labeled*, not real-time: at 0.45× speed, a 24 h patrol takes
>53 h of simulator time. GPU-rendered recording dominates the budget.

## Recommendations

1. **Keep the edge-decimated feed.** Encode the live clip at 8 fps and in the
   diff/motion domain (already done for `pure-motion`) for the bandwidth class
   of a low-budget device; never assume 24/7 raw streams.
2. **Add a freshness/throughput monitor.** Track the reported 88.8 s cycle as a
   health metric (roadmap gate: 99 % of chunks published, recovery from failed
   chunk). A stalled runner is currently invisible until chunks stop appearing.
3. **Night encoding:** expect 10× data growth when night footage is enabled and
   plan retention/pruning around it, or run denoising on-device before encoding
   (the night-denoising workstream).
4. **Cap retained media per device:** `LIVE_KEEP` at 40 chunks ≈ 651 MB is a
   reasonable baseline; when multiplying by zones/cameras, keep the cap per
   camera, not per zone.

## Caveats

- Numbers are from the current photoreal daylight scene on one machine; encode
  settings, noise level and hardware change the rates.
- Night rates come from the older recorded scene (different codec settings may
  apply); treat as an order of magnitude until re-measured on current footage.
- Real-phone estimates assume H.264 720p30; actual bitrates depend on encoder,
  scene motion and illumination.