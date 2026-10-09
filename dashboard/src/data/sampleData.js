// A fixed, made-up snapshot of the beach used until the pipeline adapter
// exists. The adapter must produce objects with this SAME shape.
//
// All x / y positions are pixels on the map image (see config/mapConfig.js).
//
// Camera layout: every zone is watched by a PAIR of cameras placed at
// opposite ends of the zone, facing each other along the shoreline. That
// way anything in the zone is seen from two different angles.
//
// headingDegrees uses screen math: 0 = pointing right, 90 = pointing down,
// -90 = pointing up. (Down-left along the beach is about 113; up-right
// along the beach is about -34.)

export const sampleSnapshot =
{
    generatedAt: '2026-10-09T18:00:00Z',

    zones:
    [
        {
            zoneIdentifier: 'A',
            name: 'Sand Point access',
            activityLevel: 'medium',
            outlinePoints: [[295, 640], [188, 770], [272, 770], [378, 640]],
            labelPosition: { x: 283, y: 705 },
        },
        {
            zoneIdentifier: 'B',
            name: 'Holiday Beach access',
            activityLevel: 'high',
            outlinePoints: [[493, 400], [394, 520], [476, 520], [573, 400]],
            labelPosition: { x: 484, y: 460 },
        },
        {
            zoneIdentifier: 'C',
            name: 'Pelican Condos stretch',
            activityLevel: 'medium',
            outlinePoints: [[617, 250], [551, 330], [630, 330], [695, 250]],
            labelPosition: { x: 623, y: 290 },
        },
        {
            zoneIdentifier: 'D',
            name: 'Ocean View Drive',
            activityLevel: 'low',
            outlinePoints: [[745, 95], [667, 190], [744, 190], [822, 95]],
            labelPosition: { x: 745, y: 143 },
        },
    ],

    cameraPairs:
    [
        {
            pairIdentifier: 'A',
            zoneIdentifier: 'A',
            name: 'Sand Point',
            cameras:
            [
                { cameraIdentifier: 'A1', position: { x: 330, y: 622 }, headingDegrees: 113, viewDistance: 178, fieldOfViewDegrees: 44, facingDescription: 'facing south', status: 'online', lastFrameTime: null },
                { cameraIdentifier: 'A2', position: { x: 193, y: 788 }, headingDegrees: -34, viewDistance: 178, fieldOfViewDegrees: 44, facingDescription: 'facing north', status: 'offline', lastFrameTime: null },
            ],
        },
        {
            pairIdentifier: 'B',
            zoneIdentifier: 'B',
            name: 'Holiday Beach',
            cameras:
            [
                { cameraIdentifier: 'B1', position: { x: 528, y: 382 }, headingDegrees: 113, viewDistance: 166, fieldOfViewDegrees: 44, facingDescription: 'facing south', status: 'online', lastFrameTime: null },
                { cameraIdentifier: 'B2', position: { x: 399, y: 538 }, headingDegrees: -34, viewDistance: 166, fieldOfViewDegrees: 44, facingDescription: 'facing north', status: 'online', lastFrameTime: null },
            ],
        },
        {
            pairIdentifier: 'C',
            zoneIdentifier: 'C',
            name: 'Pelican Condos',
            cameras:
            [
                { cameraIdentifier: 'C1', position: { x: 652, y: 232 }, headingDegrees: 113, viewDistance: 117, fieldOfViewDegrees: 44, facingDescription: 'facing south', status: 'online', lastFrameTime: null },
                { cameraIdentifier: 'C2', position: { x: 556, y: 348 }, headingDegrees: -34, viewDistance: 117, fieldOfViewDegrees: 44, facingDescription: 'facing north', status: 'online', lastFrameTime: null },
            ],
        },
        {
            pairIdentifier: 'D',
            zoneIdentifier: 'D',
            name: 'Ocean View Dr',
            cameras:
            [
                { cameraIdentifier: 'D1', position: { x: 780, y: 77 }, headingDegrees: 113, viewDistance: 135, fieldOfViewDegrees: 44, facingDescription: 'facing south', status: 'online', lastFrameTime: null },
                { cameraIdentifier: 'D2', position: { x: 672, y: 208 }, headingDegrees: -34, viewDistance: 135, fieldOfViewDegrees: 44, facingDescription: 'facing north', status: 'online', lastFrameTime: null },
            ],
        },
    ],
};
