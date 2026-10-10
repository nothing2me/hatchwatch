// Continuous synthetic beach feed for the live demo.
//
// Records back-to-back six-turtle chunks on fresh seeds, runs the unchanged blind pipeline on each
// (extract -> detect -> two-camera pin grouping), then publishes a versioned manifest
// (schemas/live-chunk.v1.json) as artifacts/public/<chunk>/live-chunk.json. The manifest is written
// last, so a chunk is either complete or invisible to consumers. Each chunk is a fresh beach, so
// older disturbances vanish from the simulation; the dashboard decides how long old sites linger.
//
// Recording the next chunk overlaps with analysis of the previous one. Seeds listed in any
// config/*registration*.json are skipped so live chunks never reuse registered experiment seeds.
// Evaluation against private truth is never run here.
//
// Usage (Vite must be serving the simulator on 127.0.0.1:5173):
//   node scripts/live-runner.mjs [--scenario swarm-spread] [--model A] [--layout along|seaward] [--humans 0-4] [--keep 40] [--chunks 0]

import {spawn} from 'node:child_process';
import {mkdir, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) =>
{
    if (value.startsWith('--'))
    {
        pairs.push([value.slice(2), all[index + 1]]);
    }
    return pairs;
}, []));

const scenario = args.scenario || 'swarm-spread';
const model = args.model || 'A';
const keepChunks = Math.max(4, Number(args.keep || 40));
const maxChunks = Number(args.chunks || 0); // 0 = run until stopped
const seedBase = Number(args['seed-base'] || 910000);
const layout = args.layout || 'along';
const humans = args.humans === undefined ? 0 : Number(args.humans);
if (!['along', 'seaward'].includes(layout) || !Number.isInteger(humans) || humans < 0 || humans > 4)
{
    throw Error(`Unsupported live configuration: layout ${args.layout}, humans ${args.humans} (along|seaward, 0-4)`);
}

const supportedScenarios = {'swarm-spread': 'synthetic-daylight', swarm: 'synthetic-daylight', 'swarm-night': 'synthetic-very-dark'};
if (!supportedScenarios[scenario] || !['A', 'B'].includes(model))
{
    throw Error(`Unsupported live configuration: scenario ${scenario}, model ${model}`);
}

const publicRoot = resolve('artifacts/public');
const privateRoot = resolve('artifacts/private');
const python = process.platform === 'win32' ? resolve('.venv/Scripts/python.exe') : resolve('.venv/bin/python');
const chunkPattern = /^live-(\d{6})-([A-Za-z0-9]+)$/;
const clipSeconds = 40;
const fps = 8;
const groundBounds = [-12, 12, -8, 8];

let stopping = false;
const children = new Set();

function log(message)
{
    console.log(`[live ${new Date().toISOString()}] ${message}`);
}

function run(executable, commandArgs)
{
    return new Promise((ok, fail) =>
    {
        const child = spawn(executable, commandArgs, {cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe']});
        children.add(child);
        let errorText = '';
        child.stdout.on('data', chunk => process.stdout.write(chunk));
        child.stderr.on('data', chunk =>
        {
            errorText = (errorText + chunk).slice(-2000);
            process.stderr.write(chunk);
        });
        child.on('error', fail);
        child.on('close', code =>
        {
            children.delete(child);
            code === 0 ? ok() : fail(Error(`${commandArgs[0]} exited ${code}: ${errorText.trim().split('\n').pop() || ''}`));
        });
    });
}

// Every number stored under a key containing "seed" in the registration files.
async function readRegisteredSeeds()
{
    const seeds = new Set();
    function collect(value, keyHasSeed)
    {
        if (Array.isArray(value))
        {
            value.forEach(item => collect(item, keyHasSeed));
        }
        else if (value && typeof value === 'object')
        {
            for (const [key, inner] of Object.entries(value))
            {
                collect(inner, keyHasSeed || /seed/i.test(key));
            }
        }
        else if (keyHasSeed && Number.isInteger(value))
        {
            seeds.add(value);
        }
    }
    for (const name of await readdir('config'))
    {
        if (/registration.*\.json$/.test(name))
        {
            collect(JSON.parse(await readFile(resolve('config', name), 'utf8')), false);
        }
    }
    return seeds;
}

async function listLiveChunks()
{
    let names = [];
    try
    {
        names = await readdir(publicRoot);
    }
    catch
    {
        return [];
    }
    return names
        .map(name => ({name, match: chunkPattern.exec(name)}))
        .filter(entry => entry.match)
        .map(entry => ({name: entry.name, sequence: Number(entry.match[1]), published: existsSync(resolve(publicRoot, entry.name, 'live-chunk.json'))}))
        .sort((first, second) => first.sequence - second.sequence);
}

async function removeChunk(name)
{
    if (!chunkPattern.test(name))
    {
        return; // never delete anything the runner did not name
    }
    await rm(resolve(publicRoot, name), {recursive: true, force: true});
    await rm(resolve(privateRoot, name), {recursive: true, force: true});
}

async function applyRetention()
{
    const published = (await listLiveChunks()).filter(chunk => chunk.published);
    for (const chunk of published.slice(0, Math.max(0, published.length - keepChunks)))
    {
        await removeChunk(chunk.name);
        log(`Retention: removed ${chunk.name}`);
    }
}

async function recordChunk(sequence, seed)
{
    const chunkId = `live-${String(sequence).padStart(6, '0')}-${Date.now().toString(36)}`;
    const recordingStartedAt = new Date().toISOString();
    log(`Recording ${chunkId}`);
    await run('node', ['scripts/record.mjs', '--seed', String(seed), '--scenario', scenario, '--model', model, '--layout', layout, '--humans', String(humans), '--id', chunkId]);
    return {chunkId, sequence, recordingStartedAt};
}

async function analyzeAndPublish(chunk)
{
    const publicRun = resolve(publicRoot, chunk.chunkId);
    log(`Analyzing ${chunk.chunkId}`);
    await run(python, ['scripts/analyze.py', chunk.chunkId, '--both', '--settings', 'config/settings-swarm.json', '--no-evaluate']);
    await run(python, ['pipeline/pin_fuse.py',
        '--camera-0', resolve(publicRun, 'view-0/detection/predictions.json'),
        '--camera-1', resolve(publicRun, 'view-1/detection/predictions.json'),
        '--registration', 'config/pin-settings.json',
        '--output', resolve(publicRun, 'pins/predictions.json')]);

    for (const script of ['track_paths.py', 'people_detect.py'])
    {
        try
        {
            await run(python, [`scripts/${script}`, publicRun]);
        }
        catch (error)
        {
            if (stopping)
                throw error;
            log(`${script} failed for ${chunk.chunkId}, publishing without it: ${error.message}`);
        }
    }

    const manifest =
    {
        schema: 'nesttrace.live-chunk',
        version: 1,
        chunk_id: chunk.chunkId,
        sequence: chunk.sequence,
        recording_started_at: chunk.recordingStartedAt,
        published_at: new Date().toISOString(),
        clip_seconds: clipSeconds,
        fps,
        rendering: supportedScenarios[scenario],
        ground_bounds_m: groundBounds,
        cameras:
        [
            {index: 0, end: 'x_min', video: 'camera-0.mp4', calibration: 'calibration-0.json'},
            {index: 1, end: 'x_max', video: 'camera-1.mp4', calibration: 'calibration-1.json'},
        ],
        pins: 'pins/predictions.json',
        note: 'Synthetic simulation output. Pins mark digging activity; nesting unresolved.',
    };
    // Write then rename, so readers never see a half-written manifest.
    const temporary = resolve(publicRun, 'live-chunk.json.tmp');
    await writeFile(temporary, JSON.stringify(manifest, null, 2));
    await rename(temporary, resolve(publicRun, 'live-chunk.json'));
    const pins = JSON.parse(await readFile(resolve(publicRun, 'pins/predictions.json'), 'utf8')).methods.pins.length;
    log(`Published ${chunk.chunkId}: ${pins} pins`);
    await applyRetention();
}

async function main()
{
    if (!existsSync(python))
    {
        throw Error(`Python environment not found at ${python}. Follow the README setup first.`);
    }
    await mkdir(publicRoot, {recursive: true});

    // Half-written chunks from an interrupted run have no manifest; clear them before starting.
    const existing = await listLiveChunks();
    for (const chunk of existing.filter(entry => !entry.published))
    {
        await removeChunk(chunk.name);
        log(`Removed unfinished ${chunk.name}`);
    }
    let sequence = existing.length > 0 ? existing[existing.length - 1].sequence + 1 : 0;

    const registeredSeeds = await readRegisteredSeeds();
    let seed = seedBase + sequence;
    function nextSeed()
    {
        while (registeredSeeds.has(seed))
        {
            seed += 1;
        }
        return seed++;
    }

    log(`Starting at sequence ${sequence}: scenario ${scenario}, model ${model}, layout ${layout}, humans ${humans}, keeping ${keepChunks} chunks, skipping ${registeredSeeds.size} registered seeds`);

    let analysis = Promise.resolve();
    let produced = 0;
    let failures = 0;
    while (!stopping && (maxChunks === 0 || produced < maxChunks))
    {
        try
        {
            const recorded = await recordChunk(sequence, nextSeed());
            sequence += 1;
            produced += 1;
            failures = 0;
            // Wait for the previous analysis before queuing this one, so at most one chunk is
            // analyzing while the next records. Analysis failures are logged and skipped.
            await analysis;
            analysis = analyzeAndPublish(recorded).catch(error => log(`Analysis failed for ${recorded.chunkId}: ${error.message}`));
        }
        catch (error)
        {
            if (stopping)
            {
                break;
            }
            failures += 1;
            const waitSeconds = Math.min(60, 5 * failures);
            log(`Recording failed (${error.message}); retrying in ${waitSeconds} s`);
            await new Promise(done => setTimeout(done, waitSeconds * 1000));
        }
    }
    await analysis;
    log('Stopped.');
}

for (const signal of ['SIGINT', 'SIGTERM'])
{
    process.on(signal, () =>
    {
        stopping = true;
        log(`${signal}: stopping after cleanup`);
        for (const child of children)
        {
            child.kill();
        }
        setTimeout(() => process.exit(0), 2000).unref();
    });
}

main().catch(error =>
{
    console.error(error);
    process.exit(1);
});
