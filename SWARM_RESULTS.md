# Six-turtle paired daylight and very-dark stress test (v3)

This is a **synthetic video result**, not field validation or confirmation of buried eggs. The 84 × 32 m particle beach contains 134,400 simulated grains. Six turtles arrive at staggered times and dig at separate sites in each 40-second run. Two 1280 × 720 cameras face inward along the beach from opposite sides, 5.6 m above the sand. The visible-light night condition reuses each daylight seed's turtle positions and timing, with much dimmer lighting and independent frame noise. It does not model infrared.

Five seeds (`607, 613, 617, 619, 631`) and the source/settings hashes were registered in [`config/swarm-registration.json`](config/swarm-registration.json) after development seed `601` and before recording the ten stress runs. The detector received only saved-video difference signals, timestamps, public calibration, and the same fixed [`config/settings-swarm.json`](config/settings-swarm.json) for day and night. Ground truth was read only after inference. The full per-run record and whole-run bootstrap intervals are in [`results/swarm-v3.json`](results/swarm-v3.json).

| Condition and method | Camera | Matched sites | Extra alerts | Missed sites | Mean center error |
|---|---:|---:|---:|---:|---:|
| Daylight, delayed motion | 01 | 19/30 | 4 | 11 | 0.62 m |
| Daylight, combined evidence | 01 | **21/30** | **5** | **9** | **0.63 m** |
| Daylight, delayed motion | 02 | 21/30 | 7 | 9 | 0.62 m |
| Daylight, combined evidence | 02 | **30/30** | **9** | **0** | **0.59 m** |
| Very dark, combined evidence | 01 | **0/30** | **0** | **30** | undefined |
| Very dark, combined evidence | 02 | **0/30** | **0** | **30** | undefined |

The registered daylight target was at least 24/30 matched sites **and** at most five extra alerts per camera. Neither camera met both conditions: Camera 01 missed the recall target, while Camera 02 exceeded the false-alert allowance. Camera 01 matched 4, 4, 4, 5, and 4 sites by seed; Camera 02 matched all six in every seed but raised 1–2 extras per run. Each predicted inspection circle retained the registered 0.90 m radius. In the very-dark condition, the combined detector produced no candidate on any of the five seeds. A zero-alert result here is a complete miss, not good nighttime precision. The tracker-only method emitted 9 and 12 extra alerts for Cameras 01 and 02 respectively while matching only 3 and 2 sites.

One paired frame at seed 607 averaged **194.5/255** gray levels in daylight and **19.5/255** at night, roughly tenfold dimmer in mean image intensity. This is an image statistic, not a lux measurement. The five-run bootstrap recall interval for daylight Camera 01 was 0.67–0.77; Camera 02 was 1.00–1.00 in these resamples. With only five related synthetic seeds, those intervals do not establish performance on another beach or camera. Dark mean center error is undefined because there were no combined-method matches.

The AMD Direct3D11 renderer averaged **110.8 s/run** in daylight and **113.5 s/run** at night. Two-camera extraction and detection averaged **41.2 s/run** and **48.5 s/run**, respectively. The two source videos averaged **12.7 MiB/run** in daylight and **73.5 MiB/run** at night; the noise made night video harder to compress. GPU QA on development seed 601 counted **8,397 grains moved more than 8 cm** by 27 seconds. The older three-turtle mode still passed a compatibility check on the denser beach, and hidden egg state did not alter rendered pixels.

## Exploratory low-light preprocessing, outside the registered test

To answer whether image enhancement can recover motion, [`scripts/lowlight_probe.py`](scripts/lowlight_probe.py) transformed **development seed 601 only**, then passed each saved enhanced video through the unchanged extractor, detector, settings, and evaluator. These are exploratory single-seed results, not a revised nighttime validation. The original dark video produced 0/6 matches and 0 extras from either camera.

| Development preprocessing | Camera 01 | Camera 02 |
|---|---:|---:|
| Brightness ×4 | 2/6 matches, 6 extras | 3/6 matches, 5 extras |
| 7×7 blur, then brightness ×4 | not tested | 2/6 matches, 6 extras |
| Local contrast (CLAHE) | not tested | 1/6 matches, 7 extras |
| Three-frame temporal median, then brightness ×4 | not tested | 3/6 matches, 5 extras |

Brightness made some true motion cross the detector's fixed thresholds, but also amplified noise into false alerts. The tested spatial and temporal filters did not improve that tradeoff; CLAHE also caused 12 registration failures in the Camera 02 clip. This does **not** rule out better variance-aware background modeling, longer temporal persistence, denoising, or an actual infrared-capable camera. Those require a new development design and fresh reserved seeds before making a nighttime accuracy claim. Synthetic sensor noise cannot stand in for measured field footage.
