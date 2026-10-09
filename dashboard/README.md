# NestTrace dashboard

Monitoring app for sea turtle crawl and digging activity on the Holiday Beach stretch of Port Aransas. It is separate from the research simulator in the repository root and never reads simulator state, the research API, or private evaluator truth (see `../agent.md`).

## Run

Requires Docker Desktop (running) and, for development outside Docker, Node 24.

```bash
cd dashboard
cp .env.example .env            # then set AUTH_SECRET (openssl rand -base64 32), SEED_ADMIN_PASSWORD and optionally SEED_VIEWER_PASSWORD
docker compose up --build
```

Open http://localhost:3000 and sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. The first start creates zones A–D, cameras A1–D2 and a read-only `viewer@nesttrace.local` account. Under Docker the viewer password is never printed: set `SEED_VIEWER_PASSWORD` in `.env` before the first start and it is used when the viewer is created (an existing viewer is never overwritten). To set or change it later, put the new value in `SEED_VIEWER_PASSWORD` and run `npm run db:reset-viewer` from `web/` (it updates the dev database named by `DATABASE_URL` and refuses if the variable is unset). The app refuses to start with `change-me` placeholder secrets.

The Compose file binds web (3000) and Postgres (5433) to 127.0.0.1 and sets `INSECURE_COOKIES=1` so the session cookie works over plain HTTP. That setup is for localhost-only use; put TLS in front and drop `INSECURE_COOKIES` before exposing it to a network.

## Develop

```bash
docker compose up -d db          # Postgres on localhost:5433
cd web && cp ../.env .env && npm install
npx prisma migrate dev           # apply migrations, generate client
npm run db:seed
npm run dev                      # http://localhost:3000
npm run db:test:prepare          # creates and migrates the nesttrace_test database named by TEST_DATABASE_URL
npm test                         # unit + integration + boundary (needs the db container)
npx vitest run tests/unit/geo.test.ts   # one file
```

## Simulation feeds

Camera feeds loop footage recorded by the research simulator and imported through the `sim-import-v1` adapter. The adapter reads only a run's public outputs and refuses `private/` paths.

```bash
# repo root: record the four demo runs (needs `npm run dev` on port 5173)
.venv/bin/python scripts/demo_runs.py
# dashboard/web: import one run per zone pair
npm run sim:import -- --run ../../artifacts/public/A-swarm-demo-901 --pair A
npm run sim:import -- --run ../../artifacts/public/A-swarm-demo-907 --pair B
npm run sim:import -- --run ../../artifacts/public/A-swarm-demo-911 --pair C
npm run sim:import -- --run ../../artifacts/public/A-swarm-night-demo-919 --pair D
```

If Playwright's bundled browser is missing, `scripts/demo_runs.py` needs `NESTTRACE_BROWSER` pointing at a Chrome binary, for example `export NESTTRACE_BROWSER="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.

Media lands in `dashboard/media/` (git-ignored, bind-mounted into the container). Pins are placed at true scale around each zone's centre and labelled "Simulated · approximate position"; they mark digging activity for inspection, never a confirmed nest.

## Limits

Map imagery comes from Esri World Imagery and needs internet; without it the map shows zones and cameras on a dark background. Zone and camera positions were converted from the earlier map image and are accurate to roughly ±20 m. Alerts never confirm a nest; only a person in the field can mark an alert field-confirmed.
