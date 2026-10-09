# Real dashboard workspace

This directory is reserved for the team’s real NestTrace dashboard. The current `web/` application is a synthetic research simulator and evidence viewer. Build the real dashboard here as a separate application with its own package, runtime, tests, deployment, credentials, and real-data storage.

The dashboard can later consume a reviewed, versioned adapter for prediction JSON, public calibration, evidence videos, and projected motion maps. It must not depend on simulator objects, seeds, private evaluator truth, or the local research API. See the repository’s [`agent.md`](../agent.md) for the boundary and alert wording.

## Running the dashboard

This is a standalone React + Vite app with its own `package.json`; it does not
use the root package or the research simulator. Requires Node 18+.

```powershell
cd dashboard
npm install
npm run dev
```

Open **http://localhost:5180**. All numbers are sample data from
`src/data/sampleData.js`. The UI reads data only through `subscribe()` on a
data source (`src/data/dataSource.js`), so the future pipeline adapter can be
swapped in by changing one line in `src/App.jsx`.
