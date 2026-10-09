# NestTrace dashboard

Monitoring app for sea turtle crawl and digging activity on the Holiday Beach stretch of Port Aransas. It is separate from the research simulator in the repository root and never reads simulator state, the research API, or private evaluator truth (see `../agent.md`).

## Run

Requires Docker Desktop (running) and, for development outside Docker, Node 24.

```bash
cd dashboard
cp .env.example .env            # then set AUTH_SECRET (openssl rand -base64 32) and SEED_ADMIN_PASSWORD
docker compose up --build
```

Open http://localhost:3000 and sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. The first start creates zones A–D, cameras A1–D2 and a read-only `viewer@nesttrace.local` account whose password is printed in the `web` logs (`docker compose logs web | grep viewer`).

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

## Limits

Map imagery comes from Esri World Imagery and needs internet; without it the map shows zones and cameras on a dark background. Zone and camera positions were converted from the earlier map image and are accurate to roughly ±20 m. Alerts never confirm a nest; only a person in the field can mark an alert field-confirmed.
