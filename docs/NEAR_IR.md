# Night-only active near-IR acquisition (development)

The `swarm-nir` scenario is an **opt-in night simulation**. Daytime scenarios and the registered visible-light `swarm-night` experiment are unchanged. It keeps the dispersed six-turtle beach layout, dims the moon/ambient lighting, places a broad emitter at each camera, and records monochrome camera frames with modest seeded sensor noise. The existing blind extractor and detector receive only the saved public videos and calibration. Hidden turtle states enter evaluation only after inference. The default emitter setting is 5,000 Three.js intensity units; `--nir-power` allows controlled development sweeps from 1,000 to 7,000.

This is an **active near-IR imaging proxy**, not a spectral renderer. Three.js illuminates ordinary RGB materials; the sensor proxy converts the result to grayscale. The simulation does not measure 850/940 nm reflectance of real sand, turtle shells, wet surf, grass, or the actual sensitivity/noise of a phone camera. The emitter's Three.js intensity is an artistic scene setting, not a measured LED power or safe field illumination level. Therefore, results here cannot establish field accuracy or ecological safety.

## Field implementation to test

1. Keep a normal RGB day feed. At night, switch an NIR-sensitive camera to monochrome mode by moving/removing its IR-cut filter, and enable a downward-aimed NIR LED only while the night mode is active. A normal phone camera with a fixed IR-cut filter may not work; verify the recycled phone's sensor/filter hardware or use an external camera module.
2. Start with a shielded, camera-aligned 850 nm illuminator and compare 940 nm in a permitted pilot. Measure actual irradiance, useful range, exposure, noise, battery draw, and any visible red glow. Fix camera exposure/gain for a test interval so temporal differences are interpretable; retune only on separate development data.
3. Calibrate both views at the actual mount height and ground distance. Collect paired real day/night footage with controlled empty-beach, waves, wind, people, crawling, digging, and occlusion cases. Keep the detector blind to labels until predictions are saved. Test independent nights and sites before making a performance claim.
4. Have the local wildlife authority and a sea-turtle biologist review the illumination, mounting, and monitoring protocol before placing active lighting on a nesting beach. Infrared is not automatically harmless to turtles, and visible-light leakage or reflections matter. A passive thermal camera is another option, but it is a different sensor and would require its own detector validation.

The day/night IR-cut switch and monochrome output follow [Axis's camera documentation](https://help.axis.com/en-us/axis-p3807-pve). [Axis's IR overview](https://whitepapers.axis.com/en-us/ir-in-surveillance) describes 850 nm as a common active illumination wavelength. [U.S. Fish & Wildlife Service guidance](https://www.fws.gov/story/2024-09/shining-light) explains the impact of beach lighting on nesting turtles. These sources support the field plan, not the simulated detection accuracy.

## Reproduce this exploratory test

With Vite serving port 5173, select **Six turtles - active near-IR night (development)** in the research UI, or run:

```powershell
node scripts/record.mjs --scenario swarm-nir --seed 614 --model A --id nir-dev-614-p5000
.\.venv\Scripts\python.exe scripts/analyze.py nir-dev-614-p5000 --both --settings config/settings-nir-dev.json
.\.venv\Scripts\python.exe pipeline/pin_fuse.py --camera-0 artifacts/public/nir-dev-614-p5000/view-0/detection/predictions.json --camera-1 artifacts/public/nir-dev-614-p5000/view-1/detection/predictions.json --registration config/pin-settings.json --output artifacts/public/nir-dev-614-p5000/pins/predictions.json
.\.venv\Scripts\python.exe pipeline/evaluate.py --predictions artifacts/public/nir-dev-614-p5000/pins/predictions.json --truth artifacts/private/nir-dev-614-p5000/truth.json --registration config/registration.json --output artifacts/private/nir-dev-614-p5000/pin-evaluation.json
```

The live dashboard runner also accepts `--scenario swarm-nir` for a night-only demonstration. Its default stays `swarm-spread` (daylight). Switching a deployed system should be controlled by its local dusk/night schedule and observed light level, not by this research UI.

For the travel-only negative control, record `--scenario nir-travel --seed 716 --id nir-negative-travel-716`, then analyze and fuse it with the same NIR development settings and pin rules. Its private truth contains no digging sites. Neither NIR scenario changes the registered experiment definitions.

## Exploratory measurements

Development seeds and the current simulator source are unregistered. A first pass used the existing `config/settings-swarm.json` unchanged. After reviewing its misses, a separate `config/settings-nir-dev.json` lowered only `full_threshold` from 0.50 to 0.30; `config/pin-settings.json` stayed unchanged. The public operator watch mask was applied at extraction. This is post-hoc development tuning, **not** a validated detector setting. These figures are **simulation-only** and must not be merged with the registered very-dark visible-light result.

| Seed / scene power | Camera 0 combined TP/FP/FN | Camera 1 combined TP/FP/FN | Fused pins TP/FP/FN |
|---|---:|---:|---:|
| 611 / 3,500, original settings | 1 / 3 / 5 | 2 / 0 / 4 | 3 / 2 / 3 |
| 612 / 3,500, original settings | 0 / 0 / 6 | 0 / 0 / 6 | 0 / 0 / 6 |
| 613 / 3,500, original settings | 0 / 0 / 6 | 0 / 0 / 6 | 0 / 0 / 6 |
| 612 / 5,000, original settings | 0 / 0 / 6 | 0 / 0 / 6 | 0 / 0 / 6 |
| 611 / 3,500, NIR development setting | 4 / 4 / 2 | 4 / 4 / 2 | 5 / 3 / 1 |
| 612 / 3,500, NIR development setting | 5 / 0 / 1 | 6 / 0 / 0 | 6 / 0 / 0 |
| 613 / 3,500, NIR development setting | 3 / 5 / 3 | 5 / 2 / 1 | 5 / 1 / 1 |
| 612 / 5,000, NIR development setting | 5 / 0 / 1 | 6 / 0 / 0 | 6 / 0 / 0 |
| 614 / 5,000, new seed with NIR development setting | 4 / 4 / 2 | 6 / 1 / 0 | 6 / 0 / 0 |
| 615 / 5,000, new seed with NIR development setting | 5 / 3 / 1 | 5 / 3 / 1 | 5 / 1 / 1 |
| 716 / 5,000, **travel only, no digging** | 0 / 8 / 0 | 0 / 4 / 0 | **0 / 5 / 0** |

Increasing scene power from 3,500 to 5,000 on the same seed raised a sampled beach-region mean grayscale level from 157 to 177 (8-bit values) while clipped pixels rose from 0.03% to 0.35%. The animals remain visible and sand texture remains readable. A 6,500-unit preview began to wash out the central beach, so the default stops at 5,000. **Higher illumination alone did not improve detections in the matched seed.**

The two new positive seeds found 11 of 12 digging sites with one false pin after post-hoc development tuning. But the no-digging travel run produced **five false pins**. A threshold sweep from 0.30 through 0.45 did not remove those false alerts without sacrificing many true sites. This is **not yet reliable digging detection**: the current motion/frozen-difference fusion cannot distinguish some crawling trails and paused turtles from excavation. The next detector work must use an independently measured digging-specific temporal/spatial cue, then test it on fresh travel, nesting, waves, and people footage. Do not present these development numbers as field accuracy.
