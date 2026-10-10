# Camera geometry: coverage, zone sizing and the two-camera correlation limit

**Status:** analysis based on the dashboard's public configuration and the
registered detection tolerances. It answers three questions from the review:

1. Do the cameras leave blind spots inside a zone?
2. Is a zone sized to the cameras' reach?
3. How far apart can two cameras be before correlated motion is inaccurate?

Numbers are produced by [`scripts/camera-geometry.mjs`](../scripts/camera-geometry.mjs),
which reads the same seed data the dashboard map uses, so the geometry below is
the geometry the map draws. It is a geometric audit, **not** a measured result,
and it is not a replacement for a registered camera-pair experiment.

## Layouts under analysis

| Layout | Who | Cameras | Separation | FOV | Range |
|---|---|---:|---:|---:|---:|
| Simulator (current) | `web/simulation.ts` | opposed at x = ±28 m, h = 5.6 m | **56 m** | 48° | calibrated ground 24 × 16 m |
| Seeded dashboard zones A–D | `seed-data.ts` | pairs on the dune line, inward | **316–452 m** | 44° | 245–370 m |
| Admin-placed pair (default) | `placePair.ts` | ends of a 120 m land edge, toed 20° | **120 m** | 60° | 90 m |

The seeded zone *outlines* are far bigger than the “120 m zone” text implies:
map-derived polygons 218–354 m per side (±20 m accuracy). The analysed
simulator region (24 × 16 m) is much smaller than the beach (84 × 32 m) — pin
accuracy claims apply only inside the calibrated 24 × 16 m region.

## 1. Blind spots: yes, and they are large

Zone coverage (grid sample of the zone polygon, fov/range cone per camera):

| Zone | Covered | Both cameras | **Blind** | Worst blind point → nearest camera | Baseline |
|---|---:|---:|---:|---:|---:|
| A | 74.6 % | **0.0 %** (A2 offline) | 25.4 % | 227 m | 452 m |
| B | 82.4 % | 66.7 % | 17.6 % | 213 m | 425 m |
| C | 70.0 % | 55.6 % | 30.0 % | 160 m | 316 m |
| D | 76.3 % | 61.4 % | 23.7 % | 179 m | 357 m |

Highlights:

- **Zone A has no dual-camera coverage at all** — A2 is seeded `OFFLINE`, so the
  whole zone is single-view. Two-camera correlation is impossible there today.
- The blind remainder is the landward strip and the far along-beach corners:
  a 44° cone at 245–370 m covers a wedge, not the rectangle the zone polygon
  describes.
- The **admin default pair is the worst geometry on the map**: of an admins
  placed 120 × 60 m zone, only **58.5 % is covered and just 1.6 % by both
  cameras** (the two 60° cones, each toed 20° inward, overlap in only a ~20°
  sector near mid-beach; each half of the zone is single-view). 41.5 % is blind.
  A patrol walking the zone cannot rely on two-view depth anywhere but a narrow
  central band.

## 2. Zone size vs camera reach: mismatched both ways

- **Seeded zones:** each camera's range (245–370 m) far exceeds the zone, so
  length is not the problem — *footprint shape* is: a 44° cone at 300+ m sweeps
  a huge arc, wasting resolution (below) while pinning nothing in the corners.
- **Admin default:** 90 m range against a 120 m-long, 60 m-deep zone. The far
  far corner is 134 m from the opposite camera; every corner is reachable only
  by its own camera (60 m), never both. Zone *size* is therefore larger than
  the reliable *dual-view* reach of the default pair.
- **Simulator:** the calibrated region (24 × 16 m) is deliberately smaller than
  the beach; outside it there is no calibrated accuracy. This is correct by
  design if the goal is a bounded proof, but the demo must not imply the
  cameras watch the whole 84 × 32 m beach.

## 3. Maximum separation for correlated motion

A turtle whose shell stands `q` above the reference plane projects to a ground
point shifted radially away from a camera at height `h` by approximately
`g·q/h` (planar projection), where `g` is the ground distance to the camera.
Two cameras with baseline `B` therefore disagree about an elevated body by
`≈ B·q/h` at the midline.

With h = 5.6 m and q ≈ 0.35 m:

| Baseline B | Disagreement | ≤ 1.0 m (track fusion) | ≤ 2.4 m (pin grouping) | ≤ 0.9 m (pin radius) |
|---|---:|---|---:|---:|
| 14 m | 0.9 m | ✓ | ✓ | ✓ |
| 16 m | 1.0 m | ✓ | ✓ | ✗ |
| 24 m | 1.5 m | ✗ | ✓ | ✗ |
| 32 m | 2.0 m | ✗ | ✓ | ✗ |
| 38 m | 2.4 m | ✗ | ✓ | ✗ |
| 40 m | 2.5 m | ✗ | ✗ | ✗ |
| 56 m (simulator) | 3.5 m | ✗ | ✗ | ✗ |
| 316+ m (seeded) | 19+ m | ✗ | ✗ | ✗ |

**Reading:**

- To keep the *registered 0.9 m inspection radius* honest against raw elevated
  bodies, two cameras should be no more than **~14–16 m apart**.
- The *pin-grouping* tolerance (2.4 m) holds up to **~38 m**.
- The current simulator runs at 56 m, where the naive bound says 3.5 m — yet
  the registered pin validation measured 0.58 m mean center error with 51/60
  pins two-camera fused. That is because detector points are derived from the
  **contact-area motion signals**, not the projected shell top; the naive bound
  is a worst case the pipeline already beats. It does **not** mean the bound can
  be ignored at scale: beyond ~40 m, expect gradually more single-view pins and
  more grouping failures as sites move off the midline.
- The seeded dashboard pairs (316–452 m) are far beyond any correlation limit.
  Their “pairs” are coverage pairs, not stereo pairs; treat their pins as
  single-view evidence, never two-camera.

## Resolution at range

1280 px wide frame, fov treated as horizontal (16:9 assumed for the seeded 44°):

| Camera | Range | Ground resolution |
|---|---:|---:|
| A1/A2, B1/B2 | 370 / 350 m | ~22–23 cm/px |
| D1/D2 | 285 m | ~18 cm/px |
| C1/C2 | 245 m | ~15.5 cm/px |
| Admin default | 90 m | ~6 cm/px |
| Simulator | 24 × 16 m region | ~1.5 cm/px |

A 0.9 m pin is ~4 px across at 350 m and ~150 px in the simulator. The seeded
ranges make dark footage unusable (consistent with the 0/30 very-dark result).

## Recommendations

1. **Enforce geometry at pair creation.** Instead of “120 m zone, cameras at the
   ends, 90 m range”, default to a pair whose cones intersect over most of the
   inspected strip: reduce effective zone length to ≤ 60 m, raise fov to ≥ 75°,
   or move cameras to mid-beach aimed slightly apart. Add a live “blind spot”
   estimate in the camera editor showing the union and overlap of the two cones
   over the zone before saving.
2. **Zone A:** seed A2 online (or flag the zone as single-view in the UI) so the
   map does not suggest two-camera evidence where none exists.
3. **Register a separation sweep** (16/24/32/40/48/56 m × 5 fresh seeds on the
   untouched pin registration pattern) and report fused-pin recall and center
   error per baseline. Until that runs, treat the values above as the geometric
   expectation, with 56 m working empirically in the simulator only because of
   contact-area detection.
4. **Keep the calibrated ground region visibly honest** on the demo map: the
   motion overlays and their legend already say the projected area is
   24 × 16 m; extend that statement to the pinned accuracy claim.

## Caveats

- Seeded zone/camera positions are map-converted to ±20 m; percentages are
  sensitive to that error near cone edges.
- The cone test treats `fovDeg` as horizontal like the dashboard map does; real
  lenses may differ (aspect ratio).
- This is geometry, not measured accuracy. Only a registered evaluation can
  certify a separation limit.