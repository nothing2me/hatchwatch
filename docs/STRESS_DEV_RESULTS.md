# Detector stress batch (development) — current photoreal scene

**Status:** development run on the *current* photoreal beach and local turtle
model. These are **not** registered validation runs: they use unregistered
seeds, the working tree is recorded, and their purpose is to probe how the
fixed detector behaves under stress conditions on the new footage. Results are
saved for comparison; none of this tunes or revalidates the registered
experiments (`PIN_RESULTS.md`, `SWARM_RESULTS.md`).

Reproduce with the Vite dev server on 127.0.0.1:5173:

```powershell
node scripts/dev-stress.mjs
```

Raw per-view numbers: `results/dev-stress.json`. The detector ran blind on the
saved videos with the fixed `config/settings-swarm.json`; evaluation read
private truth only after inference.

## Result

| Condition | Meaning | View 0 (tp / fp / fn) | View 1 (tp / fp / fn) | Full-method candidate? |
|---|---|---|---|---|
| `travel` | crawl only, never dig (negative) | 0 / 0 / 0 | 0 / 0 / 0 | none |
| `unrelated` | empty beach, no turtles (negative) | 0 / 0 / 0 | 0 / 0 / 0 | none |
| `no-eggs` | digging with no simulated eggs | 0 / 0 / 1 | 0 / 0 / 1 | only frozen (unclassified) |
| `weak` | digging at 15 % strength | 0 / 0 / 1 | 0 / 0 / 1 | only frozen (unclassified) |
| `obstructed` | obstacle stands on the beach | 0 / 0 / 1 | 0 / 0 / 1 | one frozen candidate, one view |

## Reading

- **Negatives stay clean:** crawl-only and empty-beach runs produce **zero**
  predictions and zero false alarms in either view. The detector does not fire
  on ordinary travel or the empty scene (same result as the historical pin
  negative audit, now on the current scene).
- **Recall regressed on the new footage:** every digging condition missed its
  single site. The `full` method found **0/5** observable dig sites across the
  three positive conditions, matching the continuous live corpus, where 40
  six-turtle chunks yielded only **3 pins** (≈0.075 pins/chunk) despite six
  digs per clip. The new photoreal scene changed the video distribution —
  texture, foam, shadows, turtle model — enough that the fixed motion
  thresholds no longer re-fire digging.
- **Obstacle is not a false-alarm source:** the obstruction produced fewer
  real candidates than the clean digging runs, but detection still missed the
  occluded-site dig. There is no evidence the obstacle itself raised false
  alarms.

## What this means for the demo

The demo must state plainly that detection has **not** been revalidated on the
new footage. The strongest truthful claims are: the negatives are clean, the
pipeline runs end to end, and the earlier registered 59/60 pin result belongs
to the pre-photoreal scene. Re-establishing recall on the current scene needs a
fresh registered evaluation (new seeds, new settings registration) before any
accuracy claim is made — the same conclusion as the previous review, now
measured on the new scene rather than inferred.