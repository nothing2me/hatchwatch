// Checks the opt-in seaward layout (needs root Vite serving web/ on 127.0.0.1:5173):
// - all six reference markers of both calibrations project inside the 1280x720 frame;
// - the water plane point (0, 0.1, -20) projects inside the frame for both cameras;
// - adding walkers leaves turtle truth (sites, eggs) and calibrations unchanged, and walker 0 passes
//   within 1.5 m of turtle 0's site during its dig window; walkers leave the sand untouched.
// Usage: node scripts/sim-markers-check.mjs [--seed 11] [--scenario swarm] [--model A]
import {framesOnPage, launchRecordPage, parseArgs} from './sim-frame-hash.mjs';

const args = parseArgs(process.argv.slice(2));
const base = {seed: Number(args.seed || 11), scenario: args.scenario || 'swarm', model: args.model || 'A', layout: 'seaward'};
const {browser, page} = await launchRecordPage();
const failures = [];
const expect = (ok, message) =>
{
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${message}`);
    if (!ok) failures.push(message);
};
// Ground surface height used by the simulator's markers (sandFloor + 0.44, beach width 32 m).
const surfaceY = z => 0.018 * (z + 16) + 0.44;
// Pinhole projection from a published calibration (three.js camera looks along -Z, quaternion xyzw).
function project({mount_position_m: position, orientation_quaternion_xyzw: [qx, qy, qz, qw], vertical_fov_degrees: fov, width, height}, world)
{
    const v = world.map((value, i) => value - position[i]);
    // Rotate by the conjugate quaternion (world -> camera): t = 2 cross(u, v); v' = v + w t + cross(u, t), u = -q.xyz.
    const u = [-qx, -qy, -qz];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const t = cross(u, v).map(x => 2 * x);
    const c = cross(u, t);
    const [cx, cy, cz] = v.map((x, i) => x + qw * t[i] + c[i]);
    const f = height / 2 / Math.tan(fov * Math.PI / 360);
    return {depth: -cz, pixel: [width / 2 + f * cx / -cz, height / 2 - f * cy / -cz]};
}
const inFrame = ([u, v], width, height) => u >= 0 && u < width && v >= 0 && v < height;

try
{
    const plain = await page.evaluate(c => window.nestRecord.init(c), base);
    for (const calibration of plain.calibrations)
    {
        const {camera, width, height} = calibration;
        for (const point of calibration.reference_points)
        {
            expect(inFrame(point.pixel, width, height), `camera ${camera} marker ${JSON.stringify(point.world)} at pixel [${point.pixel.map(v => v.toFixed(1)).join(', ')}]`);
        }
        const water = project(calibration, [0, 0.1, -20]);
        const check = project(calibration, [calibration.reference_points[1].world[0], surfaceY(calibration.reference_points[1].world[1]), calibration.reference_points[1].world[1]]);
        expect(Math.hypot(check.pixel[0] - calibration.reference_points[1].pixel[0], check.pixel[1] - calibration.reference_points[1].pixel[1]) < 0.5, `camera ${camera} projection helper reproduces marker pixel`);
        expect(water.depth > 0 && inFrame(water.pixel, width, height), `camera ${camera} water point (0, 0.1, -20) at pixel [${water.pixel.map(v => v.toFixed(1)).join(', ')}]`);
    }

    const walking = await page.evaluate(c => window.nestRecord.init(c), {...base, humans: 2});
    expect(JSON.stringify(walking.calibrations) === JSON.stringify(plain.calibrations), 'calibrations unchanged by humans');
    expect(JSON.stringify(walking.truth.sites) === JSON.stringify(plain.truth.sites) && JSON.stringify(walking.truth.eggs) === JSON.stringify(plain.truth.eggs), 'turtle truth unchanged by humans');
    expect(plain.truth.people === undefined && walking.truth.people?.length === 2, 'truth.people only present when humans > 0');
    const site = walking.truth.sites[0];
    const target = [site.point[0], site.point[1] + 0.3];
    const near = walking.truth.people[0].path.filter(([t]) => t >= site.interval[0] && t <= site.interval[1]).map(([, x, z]) => Math.hypot(x - target[0], z - target[1]));
    expect(near.length > 0 && Math.min(...near) <= 1.5, `walker 0 closest approach to turtle 0 target during its window: ${near.length ? Math.min(...near).toFixed(2) : 'n/a'} m`);
    for (const person of walking.truth.people)
    {
        expect(person.height_m >= 1.65 && person.height_m <= 1.85 && person.path[0][0] >= 2 && person.path.at(-1)[0] <= 38, `walker ${person.id}: height ${person.height_m} m, visible ${person.path[0][0]}-${person.path.at(-1)[0]} s`);
    }
    // Walkers never force the sand: once they have left (t > 38 s) the frame matches the no-walker frame exactly.
    const [noWalkers] = await framesOnPage(page, base, [{t: 39.5, view: 0}]);
    const [withWalkers] = await framesOnPage(page, {...base, humans: 2}, [{t: 39.5, view: 0}]);
    expect(noWalkers === withWalkers, 'sand at t=39.5 s identical with and without walkers');
}
finally
{
    await browser.close();
}
if (failures.length) process.exit(1);
