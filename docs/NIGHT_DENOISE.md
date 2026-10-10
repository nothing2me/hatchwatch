# Night-time denoising probe (development)

**Status:** development measurement on the current photoreal very-dark scene
(`A-swarm-night-dev-601`, unregistered). No registered experiment is tuned or
revalidated here.

Reproduce: `python scripts/night_denoise_probe.py --run A-swarm-night-dev-601`
(after recording the dev night run). Raw numbers:
`results/night-denoise.json`.

## Method

Four signal constructions feed **the same fixed detector and settings**
(`config/settings-swarm.json`), so differences come from the signal alone:

| Variant | Construction |
|---|---|
| `fixed` | current extractor: static first-2 s median baseline + delayed difference (control) |
| `floor` | per-pixel noise floor (baseline-window std, ≥1.5) subtracted from persistent/delayed differences |
| `temporal` | `floor` + a 3-frame temporal consistency gate |
| `running` | `temporal` + running-average background (last `window_seconds`) instead of the static baseline |

The scene: `swarm-night`, six turtles digging at separate sites, seeds/staging
unregistered.

## Measured (combined evidence method, per view)

| Variant | σ | View 0 tp / fp / fn | View 1 tp / fp / fn |
|---|---:|---|---:|
| fixed | – | 0 / **1** / 6 | 0 / 0 / 6 |
| floor | 2.0 | 0 / 0 / 6 | 0 / 0 / 6 |
| floor | 2.5 – 3.5 | 0 / 0 / 6 | 0 / 0 / 6 |
| temporal | 2.0 – 3.5 | 0 / 0 / 6 | 0 / 0 / 6 |
| running | 2.0 – 3.5 | 0 / 0 / 6 | 0 / 0 / 6 |

## Reading

- **Denoising works as a false-alert suppressor.** The current fixed pipeline
  raises one noise-driven false positive on View 0; every noise-normalized
  variant removes it at all σ, with a clean zero-FP result.
- **Denoising does not recover missed digs.** Recall stays 0/6 across every
  variant and σ. The very-dark problem is not flicker that denoising can
  suppress — the digging motion signal itself falls below the fixed motion
  threshold after noise-floor subtraction. Post-hoc filtering can only make an
  already-too-weak signal weaker.
- Conclusion: night accuracy needs **signal acquisition work** (more light,
  longer integration, gain matched to the measured noise floor, or IR), and
  then a **fresh registered threshold/validation pass** — consistent with the
  roadmap gates. Denoising should be kept as the false-alert control once the
  signal is strong enough to detect.

## Caveat

One dev run on the current photoreal night scene; σ sweep is exploratory, not a
registered accuracy claim. The older registered very-dark result (0/30 per
camera on the previous scene) is unchanged by this probe.