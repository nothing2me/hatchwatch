# Active goal: reliable day and night site alerts

Target: reach at least 99% precision and recall for day and night on a declared, repeatable set of runs. Keep registered experiments frozen and report synthetic and real footage separately.

## Live demo and camera health

- [x] Find why Camera A2 was shown offline and correct existing database status.
- [x] Restore the live alert path end to end: detector publishing and dashboard import, including the 32-candidate contract.
- [x] Spread more turtles across the full beach in the live simulation with seeded random spacing.
- [ ] Measure precision, recall, duplicate pins, location error, and alert latency across multiple new daylight seeds and negative controls; tune until the target is met.
- [ ] Repeat the same declared stress suite for the night setup, including low-light visibility and camera availability.
- [ ] Check that the continuous runner keeps publishing and the dashboard keeps importing after restarts and media retention.

## Map and workflow

- [x] Keep site pins visible during playback; make them clickable for site actions and Google Maps coordinates.
- [x] Open zone details and historical playback from a zone right-click.
- [x] Simplify the map legend.
- [x] Add multi-select activity filters and scrolling after roughly four cards in the sites panel.
- [ ] Visually verify those interactions in the running dashboard at desktop and narrow widths.

## Historical analytics

- [x] Replace the approximate “Everything logged” view with a database-backed historical sheet and time-window selector.
- [ ] Verify history counts and window boundaries against the running database, including empty windows and service restarts.
