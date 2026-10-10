// Camera geometry audit for the HatchWatch dashboard and simulator.
//
// Answers, from the seeded and admin-placed camera configurations:
//   1. Which parts of each zone are blind to both cameras (coverage %)?
//   2. Is a zone sized to the cameras' reach (range vs zone length)?
//   3. How far apart can two cameras be before correlated motion becomes
//      inaccurate (elevation-parallax bound vs the pipeline fusion tolerances)?
//
// Reproduction-free, self-contained: reads only the dashboard's public seed
// configuration, so it works offline with the same geometry the map draws.
import { readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seedSource = readFileSync(join(root, 'dashboard/web/prisma/seed-data.ts'), 'utf8');

// --- extract the seed constants without a TypeScript build -------------------
function extractZonesCameras(source)
{
    const zones = [];
    const cameras = [];
    const zoneRe = /code:\s*'(\w)'[^}]*?outline:\s*polygon\((\[[\s\S]*?\])\),/g;
    const camRe = /code:\s*'(\w\d)'[^}]*?lng:\s*([-\d.]+)[^}]*?lat:\s*([-\d.]+)[^}]*?headingDeg:\s*([-\d.\w()]+)[^}]*?fovDeg:\s*(\d+)[^}]*?rangeM:\s*(\d+)[^}]*?status:\s*'(\w+)'/g;
    let m;
    while ((m = zoneRe.exec(source)) !== null)
    {
        const coords = JSON.parse(m[2].replace(/\[/, '[').replace(/\s+/g, ''));
        zones.push({ code: m[1], outline: coords });
    }
    while ((m = camRe.exec(source)) !== null)
    {
        const heading = m[4].includes('screenHeadingToBearing')
            ? (((Number(m[4].match(/-?\d+/)[0]) + 90) % 360 + 360) % 360)
            : Number(m[4]);
        cameras.push({ code: m[1], zone: m[1].slice(0, 1), lng: Number(m[2]), lat: Number(m[3]), headingDeg: heading, fovDeg: Number(m[5]), rangeM: Number(m[6]), status: m[7] });
    }
    return { zones, cameras };
}

const { zones, cameras } = extractZonesCameras(seedSource);

// Equirectangular local tangent plane, accurate to <0.1% at this scale.
function project(points, origin = points[0])
{
    const scaleLng = 111320 * Math.cos(origin[1] * Math.PI / 180);
    const R = (p) => [(p[0] - origin[0]) * scaleLng, (p[1] - origin[1]) * 110574];
    return points.map(R);
}

function pointInPolygon(x, y, ring)
{
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

function polygonArea(ring)
{
    let area = 0;
    for (let i = 0; i < ring.length; i++)
    {
        const [xi, yi] = ring[i], [xj, yj] = ring[(i + 1) % ring.length];
        area += xi * yj - xj * yi;
    }
    return Math.abs(area) / 2;
}

// Compass-relative cone test in the local plane. bearingDeg is from north.
function inCone(cam, x, y)
{
    if (cam.status !== 'ONLINE') return false;
    const dx = x - cam.x, dy = y - cam.y;
    const dist = Math.hypot(dx, dy);
    if (dist > cam.rangeM || dist < 1e-3) return false;
    const bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    const diff = Math.abs(((bearing - cam.headingDeg + 540) % 360) - 180);
    return diff <= cam.fovDeg / 2 + 1e-6;
}

// --- coverage audit for the four seeded zones --------------------------------
const zoneReport = [];
for (const zone of zones)
{
    const originLngLat = zone.outline[0];
    const projectAll = (points) => project(points, originLngLat);
    const ring = projectAll(zone.outline);
    const minX = Math.min(...ring.map(p => p[0])), maxX = Math.max(...ring.map(p => p[0]));
    const minY = Math.min(...ring.map(p => p[1])), maxY = Math.max(...ring.map(p => p[1]));
    const area = polygonArea(ring);
    const cams = cameras.filter(c => c.zone === zone.code).map(c =>
    {
        const [x, y] = projectAll([[c.lng, c.lat]])[0];
        return { ...c, x, y };
    });
    const baseline = cams.length >= 2 ? Math.hypot(cams[0].x - cams[1].x, cams[0].y - cams[1].y) : null;
    const step = 5;
    let covered = 0, inside = 0, dual = 0;
    const blindCells = [];
    for (let x = minX - step; x <= maxX + step; x += step)
        for (let y = minY - step; y <= maxY + step; y += step)
        {
            if (!pointInPolygon(x, y, ring)) continue;
            inside++;
            const hits = cams.filter(cam => inCone(cam, x, y)).length;
            if (hits > 0) covered++;
            if (hits > 1) dual++;
            else if (hits === 0) blindCells.push([x, y]);
        }
    const worstGap = blindCells.length ? Math.max(...blindCells.map(([x, y]) => Math.min(...cams.map(cam => Math.hypot(x - cam.x, y - cam.y))))) : 0;
    const lengths = [];
    for (let i = 0; i < ring.length; i++) lengths.push(Math.hypot(ring[(i + 1) % ring.length][0] - ring[i][0], ring[(i + 1) % ring.length][1] - ring[i][1]));
    lengths.sort((a, b) => b - a);
    zoneReport.push({
        zone: zone.code,
        areaM2: Math.round(area),
        longEdgeM: Math.round(lengths[0]), shortEdgeM: Math.round(lengths[1]),
        cameras: cams.map(({ code, headingDeg, fovDeg, rangeM, status }) => ({ code, headingDeg, fovDeg, rangeM, status })),
        baselineM: baseline ? Math.round(baseline) : null,
        coveragePct: inside ? +(100 * covered / inside).toFixed(1) : null,
        dualPct: inside ? +(100 * dual / inside).toFixed(1) : null,
        blindPct: inside ? +(100 * (inside - covered) / inside).toFixed(1) : null,
        worstBlindDistanceM: Math.round(worstGap),
    });
}

// --- default admin-placed pair: 120 m along beach, 60 m seaward --------------
// Local frame: land edge along x from (0,0)=(landNorth) to (120,0)=(landSouth),
// seaward = -y (south). Cameras at the land corners, each heading = seaward ± 20°
// choosing the side nearer the zone centre (placePair.seawardToward).
function adminPairReport()
{
    const zoneL = 120, zoneD = 60, fov = 60, range = 90;
    const landNorth = { x: 0, y: 0 }, landSouth = { x: zoneL, y: 0 };
    const seaSouth = { x: zoneL, y: -zoneD }, seaNorth = { x: 0, y: -zoneD };
    const centre = { x: zoneL / 2, y: -zoneD / 2 };
    const bearing = (from, to) => (Math.atan2(to.x - from.x, to.y - from.y) * 180 / Math.PI + 360) % 360;
    const seaward = 180;
    const toed = (from) =>
    {
        const toCentre = bearing(from, centre);
        const plus = (seaward + 20 + 360) % 360, minus = (seaward - 20 + 360) % 360;
        const gap = a => Math.abs((((a - toCentre) % 360) + 540) % 360 - 180);
        return gap(plus) <= gap(minus) ? plus : minus;
    };
    const camA = { x: landNorth.x, y: landNorth.y, headingDeg: toed(landNorth) };
    const camB = { x: landSouth.x, y: landSouth.y, headingDeg: toed(landSouth) };
    const ring = [landNorth, landSouth, seaSouth, seaNorth];
    const corners = [landNorth, landSouth, seaSouth, seaNorth];
    const cornerDist = corners.map((pos, i) => ({
        corner: i, position: [pos.x, pos.y],
        toA: Math.round(Math.hypot(pos.x - camA.x, pos.y - camA.y)), toB: Math.round(Math.hypot(pos.x - camB.x, pos.y - camB.y)),
    }));
    let covered = 0, inside = 0, dual = 0;
    for (let x = 0; x <= zoneL; x += 3)
        for (let y = -zoneD; y <= 0; y += 3)
        {
            inside++;
            const a = inCone({ ...camA, rangeM: range, fovDeg: fov, status: 'ONLINE' }, x, y);
            const b = inCone({ ...camB, rangeM: range, fovDeg: fov, status: 'ONLINE' }, x, y);
            if (a || b) covered++;
            if (a && b) dual++;
        }
    return {
        zoneM: [zoneL, zoneD], fov, range, toedSeawardDeg: 20,
        cameraHeadingsDeg: [camA.headingDeg, camB.headingDeg],
        coveragePct: +(100 * covered / inside).toFixed(1),
        dualPct: +(100 * dual / inside).toFixed(1),
        blindPct: +(100 * (inside - covered) / inside).toFixed(1),
        corners: cornerDist.map(({ corner, position, toA, toB }) => ({ corner, position, toA, toB, withinRange: toA <= range || toB <= range })),
    };
}

// --- elevation-parallax bound on two-camera correlation -----------------------
// A point q metres above the reference plane projects to the ground shifted
// g*q/(h-q) away from the camera (planar projection). Two cameras with ground
// separation B see it disagree by at most ~B*q/h on the midline.
function parallaxTable()
{
    const h = 5.6, q = 0.35; // mounting height and turtle shell top, metres
    const tolerances = [
        { name: 'per-view track fusion (track_paths.py draft)', radius: 1.0 },
        { name: 'same-site pin grouping (pin-settings.json)', radius: 2.4 },
        { name: 'registered pin inspection radius', radius: 0.9 },
    ];
    const rows = [16, 24, 32, 40, 48, 56].map(B => ({
        baselineM: B,
        midlineDisagreementM: +(B * q / h).toFixed(2),
        meets1m: B * q / h <= 1.0,
        meets2_4m: B * q / h <= 2.4,
    }));
    return { mountingHeightM: h, bodyHeightM: q, rows, tolerances: tolerances.map(t => ({ ...t, maxBaselineM: +(t.radius * h / q).toFixed(0) })) };
}

const resolution = cameras.map(cam => ({
    code: cam.code, rangeM: cam.rangeM,
    // Horizontal fov derived from a 16:9 sensor; the map cone treats fovDeg as horizontal.
    groundCmPerPixel: +(100 * 2 * cam.rangeM * Math.tan(cam.fovDeg * Math.PI / 360) / 1280).toFixed(1),
}));

console.log(JSON.stringify({ zones: zoneReport, adminPair: adminPairReport(), parallax: parallaxTable(), resolution }, null, 2));