# HatchWatch camera housing — reference design (printable)

**Status:** a 3D-printable reference design for mounting a recycled-phone camera
on the beach. It is a hackathon deliverable, **not a field-certified
enclosure**: weather sealing, thermal behaviour and salt-air durability must be
tested before any real deployment. Generate the parts with
`python scripts/generate_housing_stl.py`; outputs land in
`artifacts/housing/`.

## Parts

| File | Role | Size (W×H×D) | Triangles |
|---|---|---:|---:|
| `hatchwatch-housing-body.stl` | main shell | 122 × 118 × 81 mm | 1 320 |
| `hatchwatch-housing-lid.stl` | flat lid with 4 screw holes | 120 × 5 × 58 mm | 588 |
| `hatchwatch-housing-solar.stl` | tilted solar panel plate (25°) | 96 × 25 × 54 mm | 12 |

Body shell walls are 3.2 mm. All solids are unions of oriented hexahedra
(auto-normalled facets) sized for 0.2 mm layer FDM prints.

## What the design covers (roadmap requirements)

- **Plexiglass camera insert.** A raised rim + inner lip on the front-top face
  seats a Ø≈14 mm, 2 mm plexiglass disc inside the shell; the phone lens looks
  out through it. The window is positioned high on the housing so sand kicked
  up by the surf or a passer-by falls past it.
- **Sand-catching resistant, smooth build.** The shell has no horizontal
  ledges above the window, the lid is flush, and the base is a sealed socket —
  no seams for blowing sand to accumulate; the bottom panel is one piece with
  the walls. A drainage lip (cable ring) exits at the rear bottom.
- **Phone / battery / wiring bay.** Interior volume ≈ 114 × 84 × 49 mm,
  divided by two steps: a phone-tray ledge and a battery shelf, leaving room
  for wiring channels. Fits a standard ~155 × 75 × 8 mm phone plus a small
  Li-Ion/18650 pack and regulator.
- **Solar panel provision.** Two standoffs on the roof carry the separately
  printed `solar` plate at ~25° tilt (south-facing on this beach, which runs
  ~39° with the Gulf south-east). Charge wiring drops through the lid into the
  bay.
- **Pole mounting.** A 45 mm-deep, Ø40 mm socket at the base grips a PVC or
  galvanized pole (anchoring options: see `docs/ANCHORING.md`).

## Print and assembly notes

- Material: PETG or ASA/ABS (UV + heat); ASA preferred in direct sun. 0.2 mm
  layers, 3–4 perimeters, 20–30 % infill; supports only under the window rim
  overhang.
- Lid attaches with 4 M3 screws into the bosses (Ø2.4 mm pilot holes) or with
  a marine-grade silicone bead for a closed unit.
- Seal the lid seam with silicone gasket, pot the cable entry with
  conformal-coat/flexible sealant, add a silica-gel pack inside.
- There is no electronics regulator board in this revision — the battery shelf
  and cable lip are sized for a 5 V solar regulator + USB to the phone.

## Bill of materials (low-budget estimate)

| Item | Est. cost |
|---|---:|
| PETG/ASA filament (≈ 250 g body + lid) | $6–10 |
| Recycled phone (camera/battery) | $0–30 |
| 6 V / 5 W solar panel (small) | $8–15 |
| 5 V USB charge regulator | $4–8 |
| 18650 cell or small Li-Ion | $5–10 |
| M3 screws, silicone, plexiglass disc | $3–5 |
| Pole (PVC/steel) + anchor (see anchoring doc) | $5–25 |
| **Total per unit** | **$31–100** |

## Integration

- The dashboard demo renders this housing on a pole in the simulator scene
  (`web/environment.ts`); see the sim-integration work in this branch.
- The housing is operator hardware: it never feeds the detector. The camera
  view it produces would be a *new physical input distribution* requiring
  fresh registered validation (same rule as any footage change).

## Boundaries

- Reference geometry only — the STL is a printable starting point, not
  validated waterproofing. Field tests (rain, salt, heat, drone/birds,
  anchor pull-out) are required before claiming operational readiness.
- Dimensions are illustrative of a ~5.5″ phone; regenerate for another device.