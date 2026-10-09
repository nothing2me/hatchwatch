// Where the zones and camera pairs sit on the map image. Shared by the
// sample data (browser) and the dashboard backend (Node), so both always
// draw the same beach.
//
// All x / y positions are pixels on the map image (see config/mapConfig.js).
//
// outlinePoints order matters to the live adapter: north-land corner,
// south-land corner, south-water corner, north-water corner.
//
// Camera layout: every zone is watched by a PAIR of cameras placed at
// opposite ends of the zone, facing each other along the shoreline. The
// first camera sits at the north end facing south, the second at the south
// end facing north.
//
// headingDegrees uses screen math: 0 = pointing right, 90 = pointing down,
// -90 = pointing up. (Down-left along the beach is about 113; up-right
// along the beach is about -34.)

export const beachZones =
[
    {
        zoneIdentifier: 'A',
        name: 'Sand Point access',
        outlinePoints: [[295, 640], [188, 770], [272, 770], [378, 640]],
        labelPosition: { x: 283, y: 705 },
    },
    {
        zoneIdentifier: 'B',
        name: 'Holiday Beach access',
        outlinePoints: [[493, 400], [394, 520], [476, 520], [573, 400]],
        labelPosition: { x: 484, y: 460 },
    },
    {
        zoneIdentifier: 'C',
        name: 'Pelican Condos stretch',
        outlinePoints: [[617, 250], [551, 330], [630, 330], [695, 250]],
        labelPosition: { x: 623, y: 290 },
    },
    {
        zoneIdentifier: 'D',
        name: 'Ocean View Drive',
        outlinePoints: [[745, 95], [667, 190], [744, 190], [822, 95]],
        labelPosition: { x: 745, y: 143 },
    },
];

export const beachCameraPairs =
[
    {
        pairIdentifier: 'A',
        zoneIdentifier: 'A',
        name: 'Sand Point',
        cameras:
        [
            { cameraIdentifier: 'A1', position: { x: 330, y: 622 }, headingDegrees: 113, viewDistance: 178, fieldOfViewDegrees: 44, facingDescription: 'facing south' },
            { cameraIdentifier: 'A2', position: { x: 193, y: 788 }, headingDegrees: -34, viewDistance: 178, fieldOfViewDegrees: 44, facingDescription: 'facing north' },
        ],
    },
    {
        pairIdentifier: 'B',
        zoneIdentifier: 'B',
        name: 'Holiday Beach',
        cameras:
        [
            { cameraIdentifier: 'B1', position: { x: 528, y: 382 }, headingDegrees: 113, viewDistance: 166, fieldOfViewDegrees: 44, facingDescription: 'facing south' },
            { cameraIdentifier: 'B2', position: { x: 399, y: 538 }, headingDegrees: -34, viewDistance: 166, fieldOfViewDegrees: 44, facingDescription: 'facing north' },
        ],
    },
    {
        pairIdentifier: 'C',
        zoneIdentifier: 'C',
        name: 'Pelican Condos',
        cameras:
        [
            { cameraIdentifier: 'C1', position: { x: 652, y: 232 }, headingDegrees: 113, viewDistance: 117, fieldOfViewDegrees: 44, facingDescription: 'facing south' },
            { cameraIdentifier: 'C2', position: { x: 556, y: 348 }, headingDegrees: -34, viewDistance: 117, fieldOfViewDegrees: 44, facingDescription: 'facing north' },
        ],
    },
    {
        pairIdentifier: 'D',
        zoneIdentifier: 'D',
        name: 'Ocean View Dr',
        cameras:
        [
            { cameraIdentifier: 'D1', position: { x: 780, y: 77 }, headingDegrees: 113, viewDistance: 135, fieldOfViewDegrees: 44, facingDescription: 'facing south' },
            { cameraIdentifier: 'D2', position: { x: 672, y: 208 }, headingDegrees: -34, viewDistance: 135, fieldOfViewDegrees: 44, facingDescription: 'facing north' },
        ],
    },
];
