# Six-turtle two-camera site-pin validation (v4)

This is a **synthetic video result**. A pin marks an inspection region for digging activity. It does **not** confirm a buried nest or egg. The 84 × 32 m particle beach holds 134,400 simulated grains; six turtles arrive at staggered times and dig at separate sites in each 40-second run. Two 1280 × 720 cameras face inward along the beach from opposite sides.

A post-hoc audit of the earlier stress runs (`607, 613, 617, 619, 631`) showed that pins supported by **both** camera detections matched 30/30 sites with no extras, while looping the same two-camera predictor with the existing per-camera rules produced 30/30 matches but 9 extra alerts from Camera 02 alone. The 2.4 m same-site grouping radius was chosen after that audit, so those runs cannot validate it. Ten **untouched** seeds (`661, 673, 677, 683, 691, 701, 709, 719, 727, 733`) and all source/settings hashes were frozen in [`config/pin-registration.json`](config/pin-registration.json) before recording, then evaluated by [`scripts/pin_batch.py`](scripts/pin_batch.py). Grouping rules are in [`config/pin-settings.json`](config/pin-settings.json). The full per-run record is in [`results/pin-v4.json`](results/pin-v4.json).

| Result | Pins | Value |
|---|---:|---:|
| Sites matched | 59/60 | recall 0.983 |
| Extra pins | 1 | 0.10 per run |
| Missed sites | 1 | — |
| Mean center error | 0.58 m | radius 0.90 m |
| Mean inspection area | 15.27 m² | registered budget |
| Simulated eggs covered | 59/60 | not egg recognition |

The registered target was one matched pin per site with **zero** extra pins. It was missed by a single boundary case: on seed `691` the western site was pinned **0.93 m** from the simulated dig center, 3 cm outside the 0.90 m radius. Every other site in the ten runs was covered. Of the 60 pins, **51 carried two-camera evidence** (green on the map) and **9 carried a single view** (amber); 14 nearby candidates were suppressed. Whole-run bootstrap intervals were recall **0.95–1.00** and extra pins **0.0–0.3** per run. Ten related synthetic seeds cannot establish performance on another beach or camera.

## What a pin does and does not mean

[`scripts/pin_negative_audit.py`](scripts/pin_negative_audit.py) re-ran the pin rule over the historical single-turtle demonstrations:

| Scenario | Pins | Observable digs | Hidden eggs |
|---|---:|---:|---:|
| Travel | 0 | 0 | 0 |
| Rest | 0 | 0 | 0 |
| Abandoned body pit | 1 | 1 | 0 |
| Obstructed dig | 1 | 1 | 1 |
| Weak motion | 0 | 1 | 1 |
| Unrelated sand movement | 1 | 0 | 0 |
| Dig with no eggs | 1 | 1 | 0 |

Travel and resting produced no pins. Failure modes remain: a **weak** dig was missed, and **unrelated** sand movement produced a pin. Digging without eggs and abandoned body pits also produce pins. The dashboard therefore labels every marker a *digging activity pin* and separates corroborated (two-camera) pins from provisional (single-camera) ones. The current detector was still unable to place pins in the very-dark condition; see [`SWARM_RESULTS.md`](SWARM_RESULTS.md).
