// Development stress batch for the detector on the CURRENT photoreal scene.
//
// Records fresh dev-only runs (never registered, never used to tune) for a set
// of stress conditions and reports per-view evaluated metrics, preserving all
// outputs. Run with the Vite dev server on 127.0.0.1:5173:
//
//   node scripts/dev-stress.mjs
//
// Conditions map to the simulator's existing scenarios:
//   travel      - turtles crawl but never dig             (negative)
//   unrelated   - no turtles, only ambient scenery        (negative)
//   no-eggs     - turtles dig; no eggs are simulated      (digging still expected)
//   weak        - digging at 15% strength                 (weak-motion stress)
//   obstructed  - an obstacle stands in the scene         (occlusion stress)
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const python = resolve(root, '.venv/Scripts/python.exe');
const publicRoot = resolve(root, 'artifacts/public');
const summaryRoot = resolve(root, 'artifacts/probes/dev-stress');

const cases = [
    { scenario: 'travel', seed: 61, id: 'A-travel-stress-dev-61' },
    { scenario: 'unrelated', seed: 62, id: 'A-unrelated-stress-dev-62' },
    { scenario: 'no-eggs', seed: 63, id: 'A-noeggs-stress-dev-63' },
    { scenario: 'weak', seed: 64, id: 'A-weak-stress-dev-64' },
    { scenario: 'obstructed', seed: 65, id: 'A-obstructed-stress-dev-65' },
];

function run(cmd, cwd = root)
{
    const result = spawnSync(cmd[0], cmd.slice(1), { cwd, encoding: 'utf8', timeout: 900_000 });
    if (result.status !== 0)
    {
        throw new Error(`${cmd.join(' ')} failed (${result.status}):\n${(result.stderr || result.stdout).slice(0, 2000)}`);
    }
    return result;
}

const rows = [];
for (const item of cases)
{
    console.log(`\n=== ${item.id} (${item.scenario}) ===`);
    try
    {
        run([process.execPath, 'scripts/record.mjs', '--scenario', item.scenario, '--seed', String(item.seed), '--id', item.id]);
        run([python, 'scripts/analyze.py', item.id, '--both', '--settings', 'config/settings-swarm.json']);
        const viewRows = [];
        for (const view of [0, 1])
        {
            const evalFile = resolve(root, `artifacts/private/${item.id}/evaluation-${view}.json`);
            if (!existsSync(evalFile)) continue;
            const evalData = JSON.parse(readFileSync(evalFile, 'utf8'));
            const full = evalData.methods?.full ?? {};
            const prediction = JSON.parse(readFileSync(resolve(root, `artifacts/public/${item.id}/view-${view}/detection/predictions.json`), 'utf8'));
            const counts = Object.fromEntries(Object.entries(prediction.methods ?? {}).map(([name, list]) => [name, list.length]));
            const errors = full.localization_errors_m ?? [];
            viewRows.push({ view, tp: full.tp ?? 0, fp: full.fp ?? 0, fn: full.fn ?? 0, meanCenterErrorM: errors.length ? +(errors.reduce((a, b) => a + b, 0) / errors.length).toFixed(2) : null, candidates: counts });
        }
        const metadata = JSON.parse(readFileSync(resolve(root, `artifacts/public/${item.id}/analysis.json`), 'utf8'));
        const row = { id: item.id, scenario: item.scenario, seed: item.seed, analysisSeconds: metadata.runtime_seconds, views: viewRows };
        rows.push(row);
        console.log(JSON.stringify(row, null, 1));
    }
    catch (error)
    {
        rows.push({ id: item.id, scenario: item.scenario, seed: item.seed, error: error.message });
        console.error(error.message);
    }
}

mkdirSync(summaryRoot, { recursive: true });
writeFileSync(resolve(summaryRoot, 'summary.json'), JSON.stringify(rows, null, 2));
console.log(`\nWrote ${summaryRoot}/summary.json`);