# Three-turtle density stress test (v2)

This is an **intermediate synthetic result** for the 60 × 24 m, 72,000-grain beach with three turtles arriving at staggered times and digging at separated locations. The five stress seeds and source hashes were registered in `config/stress-registration.json` after one separate development recording and before these five recordings. Detection used the original frozen thresholds without retuning. It read only video-derived difference arrays, timestamps, and public calibration; evaluation read private truth afterward.

| Method | Matched sites | Extra alerts | Missed sites | Mean center error |
|---|---:|---:|---:|---:|
| Camera 01, delayed motion | 10/15 | 0 | 5 | 0.59 m |
| Camera 01, combined evidence | 13/15 | 1 | 2 | 0.60 m |
| Camera 02, delayed motion | 14/15 | 0 | 1 | 0.62 m |
| Camera 02, combined evidence | **15/15** | **0** | **0** | **0.62 m** |

The registered exploratory target was at least 12/15 combined-method sites and at most three extra alerts. Both cameras met it; Camera 02 was stronger. Camera 01 missed one site in seed 503 and missed one site while raising one extra alert in seed 557. Every Camera 02 combined-method inspection circle included its simulated egg point, but this is synthetic coverage, not egg recognition. Each circle retained the original 0.90 m radius and 2.545 m² area. Full per-seed results are in [`results/stress-v2.json`](results/stress-v2.json).

The AMD Direct3D11 GPU rendered the five two-camera recordings in **51.5 s/run** on average; blind two-camera analysis averaged **30.6 s/run**. The two source videos averaged **7.67 MiB/run**. Physics QA counted **497 grains moved more than 8 cm** by 8 seconds of travel and **4,198** by 31 seconds for seed 503. Hidden egg state produced identical rendered frames when toggled.

Five synthetic runs from one authored simulator are too few to infer field performance. The camera-specific asymmetry matters: the stronger Camera 02 result does not mean every placement will preserve visibility. The later, larger six-turtle scenario requires fresh registration and evaluation; these figures do not validate it.
