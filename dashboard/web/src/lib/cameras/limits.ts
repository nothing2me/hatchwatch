// Editable camera fields and their allowed ranges; shared by the server checks and the Setup form.
// A zone letter and 1–99 without leading zeros: B3, D12 (not D05 or D0).
export const CAMERA_CODE = /^[A-Z][1-9][0-9]?$/;
export const CAMERA_LIMITS = {
    lat: [-90, 90],
    lng: [-180, 180],
    headingDeg: [0, 360],
    fovDeg: [10, 120],
    rangeM: [10, 500],
} as const;
export const CAMERA_LABELS: Record<keyof typeof CAMERA_LIMITS, string> = {
    lat: 'Latitude',
    lng: 'Longitude',
    headingDeg: 'Heading',
    fovDeg: 'Field of view',
    rangeM: 'Range',
};

// The message for a value outside its range, or null when it is fine.
export function rangeError(name: keyof typeof CAMERA_LIMITS, value: number): string | null
{
    const [min, max] = CAMERA_LIMITS[name];
    return Number.isFinite(value) && value >= min && value <= max ? null : `${CAMERA_LABELS[name]} must be between ${min} and ${max}.`;
}
