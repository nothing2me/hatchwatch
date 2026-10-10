# HatchWatch Dashboard: Post-merge Cleanup (Cameras, Masks, Settings, Rename)

Date: 2026-10-10
Status: Decisions given in chat after merging `origin/main` (9a97558): "1 ok, 2 sample data, 3 combine, 4 no alerts if people not in the mask, 5 yes update, 6 rename everywhere, 7 go ahead (make sure nothing breaks)", plus "update the readme and mermaid diagrams".
Builds on: branch `feat/dashboard-fullstack` at the merge of main.

## 1. Simulated labels (decision 1)
Restore the labels main removed: the "Simulated" video badge, the camera panel note, the alert card note and the site drawer source line for simulated footage. Real phone/board footage keeps its LIVE labels. Update main's two tests that assert the labels are absent (`cameraVideo.test.tsx`, `mapScreen.test.tsx`) to assert they are present for simulated videos.

## 2. Demo data label (decision 2)
All current data is simulated. Keep the demo patrol (`DEMO_PATROL=1`), but every place that counts outcomes or patrol actions (analytics tiles, outcomes, historical record, patrol response times) shows a clear "Includes demo patrol (simulated)" note whenever any counted entry was written by the demo patrol. No numbers are hidden.

## 3. One Cameras page (decision 3)
Merge main's `/cameras` (recorded clips per map camera) and our `/live` (phones and boards) into one **Cameras** page at `/cameras`; `/live` and `/live/motion` redirect (motion view moves to `/cameras/motion`).
- Map cameras grouped by zone. A camera linked to an online phone/board shows the **live** picture (LIVE badge, detections overlay, motion badge for boards); a linked but offline device shows "Phone offline" / "Board offline" over the recorded clip; unlinked cameras show the recorded clip with the "Simulated" badge.
- A **Devices** section lists phones and boards not linked to a camera, as live tiles, plus the admin Devices list (kind, Rotate token, Remove).
- Header actions stay: Detections toggle, Connect phone, Add board camera; admin Recordings list stays.
- One top-bar item "Cameras".

## 4. Per-camera masks; no person alert outside the mask (decision 4)
- Masks become **per camera** (stored on `Camera.maskPolygon`, normalised 0–1 picture coordinates, closed polygon, 3–64 points), edited from Settings → Cameras (admin) over the camera's current picture (live device picture if linked, else latest clip). The editor says the mask applies to that camera only.
- A camera with no mask = whole picture counts.
- **Detection worker / alert:** a person counts toward the camera danger alert only if the bottom-centre of its box (feet) is inside the linked camera's mask. People outside the mask are still drawn, in grey, labelled "outside watch area", and never raise or append to an alert.
- **Simulator compatibility:** the dashboard keeps writing the research runner's mask file in the format the runner reads (main's `camera-masks.json` in `artifacts/operator`), now keyed per camera code with the old per-slot keys derived so existing runner versions keep working. The runner change to prefer per-camera keys is optional and must not alter registered experiment code paths.
- Map/tiles may draw the mask outline faintly.

## 5. Settings routes (decision 5)
`/setup` → `/settings`, `/setup/users` → `/settings/users`, `/setup/cameras` → `/settings/cameras`; old paths redirect permanently; all links, tests and docs updated.

## 6. Rename to HatchWatch everywhere (decision 6)
Rename every user-visible string, code identifier, package name, doc, firmware text, page title, log prefix and localStorage key (old keys read once and migrated). **Kept, for data and contract safety (documented in README):**
- Postgres database/user names, Docker Compose project, container and volume names (renaming loses existing data).
- Wire/contract identifiers are renamed **with backward compatibility**: the board motion header becomes `X-HatchWatch-Motion` and the dashboard still accepts `X-NestTrace-Motion`; research schema ids (`nesttrace.tracks`, `nesttrace.people`, live-chunk) are accepted under both old and new names by the importers, and new files are written with the new names only where the research code is not frozen.
- Frozen research files (`pipeline/*`, `config/*`, `results/*`, `*RESULTS.md`) are not edited.
- The detector alert wording stays exactly: "Digging activity detected; nesting unresolved."

## 7. Remove the dead prototype (decision 7)
Delete main's resurrected `dashboard/src/`, `dashboard/server/`, `dashboard/test/` and anything only they use, after confirming nothing else references them (grep, build, all test suites).

## 8. Docs
Update the root README (overview, quick start, the four Mermaid diagrams: cameras page, masks in the alert path, settings routes, HatchWatch name), the dashboard README and CLAUDE.md/agent.md (additive). Diagrams must render (checked with the Mermaid CLI).

## 9. Testing
Every existing suite stays green (dashboard unit + integration, worker pytest, root `npm test`, `next build`, firmware compile). New tests: label presence; demo-patrol note; Cameras page states (live, offline device, recorded clip, devices section, redirects); per-camera mask save/validation and research file compatibility; worker/alert mask rule (inside raises, outside never raises or appends, no mask = whole picture); settings redirects; header dual-accept; localStorage key migration. End-to-end: real ESP32 linked to E1 with a mask, person inside → alert, outside → grey box, no alert.
