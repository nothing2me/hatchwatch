# NestTrace results — synthetic daylight prototype

**Historical one-turtle result:** these measurements used the simulator at Git revision `f50d04c`. The current higher-density, three-turtle simulator changes the footage distribution and requires its own stress evaluation in `STRESS_RESULTS.md`. The results below must not be read as validation of the current simulator.

The detector identifies **observable digging activity**, not buried eggs. These are results from rendered videos of a particle beach, not field footage. The source, settings, inspection budget, and ten clean validation seeds were frozen before the reserved batch; hashes are in `config/frozen.json`. The same contributor authored simulator, challenges, and detector, so challenge design was not independent.

## Registered clean validation

Ten Model A runs, one observable digging site and one simulated egg location per run. A match required a center within 0.90 m, the true site inside a 0.90 m inspection circle, at least one second of temporal overlap, and one-to-one assignment. Each region was 2.545 m², below the registered 3.016 m² maximum. These figures use Camera 01 unless noted.

The full seed-level metrics are in [`results/validation.json`](results/validation.json).

| Method | Sites found | Extra alerts | Precision | Mean center error | Mean total inspection area/run |
|---|---:|---:|---:|---:|---:|
| Frozen reference | 10/10 | 20 | 0.33 | 0.486 m | 7.634 m² |
| Delayed motion | 10/10 | 0 | 1.00 | 0.592 m | 2.545 m² |
| Blob tracking | 10/10 | 0 | 1.00 | 0.613 m | 2.545 m² |
| Combined evidence | **10/10** | **0** | **1.00** | **0.574 m** | **2.545 m²** |

**Gate A passed:** the registered target was at least 8/10 sites and at most 0.2 extra alerts per run; the observed result was 10/10 with 0 extras. The combined method improved mean center error by only 0.018 m over delayed motion and 0.039 m over tracking on these clean runs. Frozen reference placed the matched site closer on average, but generated two extra inspection regions per run. All ten inspection regions included the simulated egg location; this is a secondary synthetic coverage measurement, not evidence that video can identify eggs.

Seed-level bootstrap resampling gave a 95% interval of 0.522–0.630 m for the combined method's mean center error. Its bootstrap recall interval is [1.00, 1.00] because every one of the ten observed runs succeeded; that degenerate interval should not be read as certainty about new conditions. The approximate Wilson 95% lower bound for 10/10 independent successes is 0.72, and independence of real conditions has not been established.

## Two-camera fusion

Before evaluating fusion, `config/fusion-registration.json` fixed a 1.5 m spatial pairing rule, one-second temporal overlap, equal-weight midpoint for matched views, and single-view fallback. Clean validation produced 10/10 matched sites, no extras, and **0.605 m** mean center error at the same 2.545 m² area. Camera 01's combined method was the strongest single-camera result under the registered recall, false-alert, and localization ranking: 10/10, no extras, **0.574 m** mean error. **Gate B failed on clean validation**: fusion added 0.031 m of mean error and did not improve coverage. No fusion-localized candidate is promoted in the dashboard. The map does display each camera's projected motion independently for inspection.

The paired comparison is in [`results/fusion-validation.json`](results/fusion-validation.json).

Compared with frozen-reference detection on these ten runs, fusion retained 10/10 sites while removing **20 extra alerts** and reducing mean total inspection area from **7.634 to 2.545 m²/run**; its matched centers were **0.119 m farther** from truth. Compared with the simple motion tracker, fusion retained 10/10 sites and zero extras at the same inspection area, with only **0.008 m** lower mean center error. That small difference is not a demonstrated general benefit, and fusion underperformed the strongest single-camera combined method. Its measured input cost was roughly twice the video storage (**4.36 vs 2.13 MB/run**) and extraction time (**22.9 vs 11.5 s/run**) on this machine; **33.8 s/run** includes both cameras and detection, and energy was not measured.

The ten clean recordings averaged **2.13 MB** for Camera 01 and **4.36 MB** for both cameras. Measured extraction averaged **11.5 s** for one camera and **22.9 s** for both, including decoding, preprocessing, and diagnostic exports. Full two-camera analysis averaged **33.8 s** per run on this development machine, excluding browser video generation. Those timings vary with hardware and concurrent work; no energy saving is claimed.

## Challenges and transfer

Seven single-seed Model A demonstrations probe conditions outside the clean validation distribution. Ordinary travel and rest produced no alerts. The detector localized the abandoned digging site and the no-eggs digging site, correctly leaving egg deposition unresolved; both led to a nonproductive inspection in the synthetic truth. It missed the obstructed and weak-motion digging sites. Unrelated sand motion produced one false alert. These are one example per condition, not condition-level rates. The full per-run metrics are in [`results/demonstrations.json`](results/demonstrations.json).

Applying the fixed fusion rule to the same seven demonstrations recovered the **one obstructed site** from Camera 02 when Camera 01 missed it. Fusion still missed weak disturbance and still produced the unrelated-motion false alert; travel and rest remained quiet. Across these mixed demonstrations it found 3/4 observable sites with one false alert ([`results/fusion-demonstrations.json`](results/fusion-demonstrations.json)). This single obstruction example is exploratory, and it does not reverse the failed clean-validation Gate B.

Without changing detector settings, the three development seeds rendered with structurally different sand Model B produced **3/3** localized sites, no extra alerts, and **0.213 m** mean center error ([`results/development-model-B.json`](results/development-model-B.json)). This is a small transfer check using the same seed numbers as development, not a reserved Model B validation set.

The included repository example is one **development** run, not a reserved test. The twenty-seed final test split is registered but has not been executed, so the clean validation findings do not establish generalization to other scenario distributions.

## Resource tradeoffs

An exploratory paired comparison on one development recording ([`results/efficiency.json`](results/efficiency.json)) kept the detector threshold fixed. Halving frame rate preserved its one detected site in about **12.0 s** of single-camera analysis; halving image width and height lost the site in about **7.3 s**. A 100 kb/s encoded version preserved the site in about **23.0 s** and occupied **0.30 MB**. These are one-run observations, and the variants were re-encoded, so their timings mix codec behavior with extraction cost. Reduced resolution was not selected. Energy and peak memory were not measured.

## Limits

The sand is a coarse, bounded particle model, not a real beach. Camera calibration fits declared visible marker centers on a planar approximation; the tiny fit residual is not a real-world accuracy estimate. Elevated turtle motion and airborne sand have parallax, while the map overlay estimates a ground projection. Simple stabilization and global illumination correction did not validate behavior under moving shadows, strong camera shake, nighttime, infrared, weather, or real turtles. The labels remain **“Digging activity detected; nesting unresolved,” “Localized activity; insufficient evidence to classify,”** and **“No candidate detected.”**
