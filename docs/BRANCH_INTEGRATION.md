# Branch integration — 2026-10-10

All remote branches were fetched. Main was fast-forwarded to `d20e5ce`, which already contains `codex/photoreal-beach` and `codex/nesttrace`.

The `feat/dashboard-fullstack` changes through `02ba891` are integrated with the current photoreal simulation and dashboard. Conflict resolutions retain the current calibration overlays, watch masks, activity filters, camera navigation, historical playback, and HatchWatch branding, alongside phone/ESP32 frames, recordings, detection overlays, and camera-level danger alerts.

## Outstanding alternative implementations

- `live-device-cameras` at `79d43f7`: WebRTC signaling, device assignment, QR pairing, live camera tiles, and side-by-side motion. It overlaps the fullstack branch's `/cam`, live-device API, database model, and source selector, which use JPEG uploads with recording and a detection worker instead.
- `live-phone-cameras` at `ac472e0`: phone capture, motion polling, relay, and recordings for the retired React/Vite dashboard and port-5182 backend. Bringing its deleted application files back into the active dashboard would reintroduce the former deployment architecture.

These branches remain available separately. They have not been marked merged or discarded. Decide whether to retain them as alternatives or explicitly integrate separate camera transports before merging them into main.

## Latest handoff: next steps

Source: `d20e5ce` commit body and `GOAL_TODOS.md`.

1. Measure daylight and night precision, recall, duplicates, location error, and alert latency on fresh development seeds and negative controls.
2. Exercise low-light visibility, camera availability, runner restarts, media retention, and watchdog/heartbeat recovery.
3. Verify map/site interactions on desktop and narrow screens, plus database-backed historical analytics across empty windows and restarts.
4. Register a fresh evaluation on the current photoreal scene and wide camera grid before an accuracy claim. The older 59/60 result is from a different scene. Real IR footage is required for field claims; the NIR renderer is a proxy.
5. Keep frozen registrations untouched and preserve the simulator/dashboard public-data boundary.

## Local setup still needed

This checkout has no `dashboard/.env` or `dashboard/web/.env`. Configure the documented secrets and database URLs, deploy migrations, and seed before exercising database integration or the running dashboard. Use Node 24 or newer. The fullstack branch additionally documents Caddy HTTPS, device tokens, recordings, and the detection worker in `dashboard/README.md`.

## Validation

- Simulator: 34 tests passed, 2 skipped.
- Dashboard: 445 unit/boundary tests covered. The full run passed 438 and exposed seven Windows-specific fixture failures; all 18 tests in the three affected files then passed after portable-path and encoder-fixture corrections.
- Dashboard TypeScript checked clean before the fixture corrections; the follow-up type check also validates the portable fixture.
- Database integration, live physical cameras, firmware hardware, and the Python detection worker were not exercised in this integration.
