# Real dashboard workspace

This directory is reserved for the team’s real NestTrace dashboard. The current `web/` application is a synthetic research simulator and evidence viewer. Build the real dashboard here as a separate application with its own package, runtime, tests, deployment, credentials, and real-data storage.

The dashboard can later consume a reviewed, versioned adapter for prediction JSON, public calibration, evidence videos, and projected motion maps. It must not depend on simulator objects, seeds, private evaluator truth, or the local research API. See the repository’s [`agent.md`](../agent.md) for the boundary and alert wording.
