// Prints the SHA-256 of one rendered simulator frame (the PNG bytes returned by nestRecord.frame).
// Needs root Vite serving web/ on 127.0.0.1:5173.
// Usage:
//   node scripts/sim-frame-hash.mjs --seed 11 --scenario swarm --model A [--layout along|seaward] [--humans N] --t 20 --view 0
//   node scripts/sim-frame-hash.mjs --check tests/fixtures/sim-default-frame-hashes.json
// --check recomputes every frame and init hash in the fixture and exits 1 on any mismatch.
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export function parseArgs(argv)
{
    return Object.fromEntries(argv.reduce((pairs, value, index, all) =>
    {
        if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]]);
        return pairs;
    }, []));
}

export function simConfig(args)
{
    const config = {seed: Number(args.seed || 11), scenario: args.scenario || 'swarm', model: args.model || 'A'};
    if (args.layout !== undefined) config.layout = args.layout;
    if (args.humans !== undefined) config.humans = Number(args.humans);
    return config;
}

export async function launchRecordPage()
{
    const executablePath = process.env.HATCHWATCH_BROWSER || process.env.NESTTRACE_BROWSER || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
    const browser = await chromium.launch({headless: true, ...(executablePath ? {executablePath} : {}), args: ['--enable-webgl', '--no-sandbox', ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])]});
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:5173/record.html');
    await page.waitForFunction(() => !!window.nestRecord);
    return {browser, page};
}

const sha256 = data => createHash('sha256').update(data).digest('hex');

// Hash of the public calibrations plus truth returned by nestRecord.init (key order as produced).
export async function initHash(page, config)
{
    return sha256(await page.evaluate(c =>
    {
        const result = window.nestRecord.init(c);
        return JSON.stringify({calibrations: result.calibrations, truth: result.truth});
    }, config));
}

export async function framesOnPage(page, config, requests)
{
    await page.evaluate(c => window.nestRecord.init(c), config);
    const out = [];
    for (const {t, view} of requests)
    {
        const png = await page.evaluate(({t, view}) => window.nestRecord.frame(t, view), {t, view});
        out.push(sha256(Buffer.from(png, 'base64')));
    }
    return out;
}

export async function frameHashes(config, requests)
{
    const {browser, page} = await launchRecordPage();
    try
    {
        return await framesOnPage(page, config, requests);
    }
    finally
    {
        await browser.close();
    }
}

async function check(fixturePath)
{
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const {browser, page} = await launchRecordPage();
    let failures = 0;
    try
    {
        for (const item of fixture.init || [])
        {
            const actual = await initHash(page, item.config);
            const ok = actual === item.sha256;
            failures += ok ? 0 : 1;
            console.log(`${ok ? 'OK  ' : 'FAIL'} init ${JSON.stringify(item.config)} ${actual}`);
        }
        for (const item of fixture.frames || [])
        {
            const [actual] = await framesOnPage(page, item.config, [{t: item.t, view: item.view}]);
            const ok = actual === item.sha256;
            failures += ok ? 0 : 1;
            console.log(`${ok ? 'OK  ' : 'FAIL'} frame ${JSON.stringify(item.config)} t=${item.t} view=${item.view} ${actual}`);
        }
    }
    finally
    {
        await browser.close();
    }
    if (failures) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
{
    const args = parseArgs(process.argv.slice(2));
    if (args.check)
    {
        await check(args.check);
    }
    else
    {
        const [hash] = await frameHashes(simConfig(args), [{t: Number(args.t ?? 20), view: Number(args.view ?? 0)}]);
        console.log(hash);
    }
}
