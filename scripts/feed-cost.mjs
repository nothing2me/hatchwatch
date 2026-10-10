// Feed bandwidth and simulation-cost audit from the recorded live corpus.
//
// Reads only public artifacts (live-*/camera-*.mp4, live-chunk.json,
// analysis.json) and reports per-chunk sizes, publish cadence, data rate per
// camera-hour, and extraction/detection cost. Reproducible offline.
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = join(root, 'artifacts/public');
const CHUNK_SECONDS = 40;

const chunks = (readdirSync(publicRoot, { withFileTypes: true }))
    .filter(e => e.isDirectory() && e.name.startsWith('live-'))
    .map(e => e.name)
    .filter(id => existsSync(join(publicRoot, id, 'live-chunk.json')))
    .sort();

const starts = [];
let totalBytes = 0;
let analysis = [];
let pins = 0;
for (const id of chunks)
{
    const dir = join(publicRoot, id);
    const manifest = JSON.parse(readFileSync(join(dir, 'live-chunk.json'), 'utf8'));
    const started = Date.parse(manifest.recording_started_at);
    if (Number.isFinite(started)) starts.push(started);
    for (const cam of [0, 1])
    {
        const file = join(dir, `camera-${cam}.mp4`);
        totalBytes += existsSync(file) ? statSync(file).size : 0;
    }
    const analysisFile = join(dir, 'analysis.json');
    if (existsSync(analysisFile)) analysis.push(JSON.parse(readFileSync(analysisFile, 'utf8')).runtime_seconds ?? 0);
    const pinFile = join(dir, 'pins/predictions.json');
    if (existsSync(pinFile)) pins += JSON.parse(readFileSync(pinFile, 'utf8')).methods.pins.length;
}

const minutes = (starts[starts.length - 1] - starts[0]) / 60000;
const clips = chunks.length;
const meanCycleS = minutes > 0 ? ((minutes * 60) / Math.max(1, clips - 1)) : 0;
const clipHours = clips * 2 * (CHUNK_SECONDS / 3600);
const mb = totalBytes / 2 ** 20;
const meanAnalysisS = analysis.length ? analysis.reduce((a, b) => a + b, 0) / analysis.length : 0;
const simSpeed = 40 / meanCycleS; // clip time per wall time
const mbPerHourPair = minutes > 0 ? mb / (minutes / 60) : 0;
const mbPerHourCam = mbPerHourPair / 2;

console.log(JSON.stringify({
    chunks: clips,
    spanMinutes: +minutes.toFixed(1),
    meanCycleS: +meanCycleS.toFixed(1),
    simClipTimeOverWallTime: +simSpeed.toFixed(2),
    totalVideoMB: +mb.toFixed(1),
    clipHours,
    meanMBperHourPair: +mbPerHourPair.toFixed(0),
    meanMBperHourPerCamera: +mbPerHourCam.toFixed(0),
    meanMbpsPerCamera: +(mbPerHourCam * 8 / 3600).toFixed(2),
    meanAnalysisS: +meanAnalysisS.toFixed(1),
    totalReportedPins: pins,
}, null, 2));