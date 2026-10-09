// Zones and cameras for the Holiday Beach stretch of Port Aransas.
//
// Converted from the original dashboard's map-image pixel positions with an
// affine fit to three OpenStreetMap points (Sand Point Circle, Ocean View
// Drive, Holiday Beach) and checked against Esri World Imagery: zones sit on
// the beach strip, cameras on the dune line. Accuracy is roughly ±20 m.

type LngLat = [number, number];

export interface SeedZone
{
    code: string;
    name: string;
    activityLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    outline: { type: 'Polygon'; coordinates: LngLat[][] };
}

export interface SeedCamera
{
    code: string;
    zoneCode: string;
    lng: number;
    lat: number;
    headingDeg: number;
    fovDeg: number;
    rangeM: number;
    status: 'ONLINE' | 'OFFLINE';
}

// Original data used screen angles: 0 = right, 90 = down. Compass: 0 = north, clockwise.
export function screenHeadingToBearing(screenDegrees: number): number
{
    return (((screenDegrees + 90) % 360) + 360) % 360;
}

function polygon(corners: LngLat[]): SeedZone['outline']
{
    return { type: 'Polygon', coordinates: [[...corners, corners[0]]] };
}

export const SEED_ZONES: SeedZone[] = [
    {
        code: 'A', name: 'Sand Point access', activityLevel: 'MEDIUM',
        outline: polygon([[-97.067725, 27.813203], [-97.069989, 27.81072], [-97.068216, 27.810834], [-97.065972, 27.813316]]),
    },
    {
        code: 'B', name: 'Holiday Beach access', activityLevel: 'HIGH',
        outline: polygon([[-97.063535, 27.817788], [-97.06563, 27.815496], [-97.063899, 27.815607], [-97.061846, 27.817897]]),
    },
    {
        code: 'C', name: 'Pelican Condos stretch', activityLevel: 'MEDIUM',
        outline: polygon([[-97.060912, 27.820655], [-97.062308, 27.819126], [-97.06064, 27.819234], [-97.059264, 27.820761]]),
    },
    {
        code: 'D', name: 'Ocean View Drive', activityLevel: 'LOW',
        outline: polygon([[-97.058203, 27.823616], [-97.059854, 27.821802], [-97.058228, 27.821907], [-97.056577, 27.823721]]),
    },
];

// Pairs face each other along the shoreline: *1 at the north end facing SSW, *2 at the south end facing NE.
export const SEED_CAMERAS: SeedCamera[] = [
    { code: 'A1', zoneCode: 'A', lng: -97.066985, lat: 27.813574, headingDeg: screenHeadingToBearing(113), fovDeg: 44, rangeM: 370, status: 'ONLINE' },
    { code: 'A2', zoneCode: 'A', lng: -97.069884, lat: 27.810403, headingDeg: screenHeadingToBearing(-34), fovDeg: 44, rangeM: 370, status: 'OFFLINE' },
    { code: 'B1', zoneCode: 'B', lng: -97.062796, lat: 27.81816, headingDeg: screenHeadingToBearing(113), fovDeg: 44, rangeM: 350, status: 'ONLINE' },
    { code: 'B2', zoneCode: 'B', lng: -97.065525, lat: 27.815179, headingDeg: screenHeadingToBearing(-34), fovDeg: 44, rangeM: 350, status: 'ONLINE' },
    { code: 'C1', zoneCode: 'C', lng: -97.060172, lat: 27.821026, headingDeg: screenHeadingToBearing(113), fovDeg: 44, rangeM: 245, status: 'ONLINE' },
    { code: 'C2', zoneCode: 'C', lng: -97.062203, lat: 27.818809, headingDeg: screenHeadingToBearing(-34), fovDeg: 44, rangeM: 245, status: 'ONLINE' },
    { code: 'D1', zoneCode: 'D', lng: -97.057463, lat: 27.823988, headingDeg: screenHeadingToBearing(113), fovDeg: 44, rangeM: 285, status: 'ONLINE' },
    { code: 'D2', zoneCode: 'D', lng: -97.059749, lat: 27.821485, headingDeg: screenHeadingToBearing(-34), fovDeg: 44, rangeM: 285, status: 'ONLINE' },
];

export const DEMO_VIEWER = { email: 'viewer@nesttrace.local', name: 'Demo Viewer' };
