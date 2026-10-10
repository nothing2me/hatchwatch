// Names from before the HatchWatch rename (spec §6). Read for compatibility; never written.
// The only dashboard source file allowed to contain the old name.
export const LEGACY_MOTION_HEADER = 'x-nesttrace-motion';
export const LEGACY_LIVE_CHUNK_SCHEMA = 'nesttrace.live-chunk';
export const LEGACY_TRACKS_SCHEMA = 'nesttrace.tracks';
export const LEGACY_PEOPLE_SCHEMA = 'nesttrace.people';
export const LEGACY_RECORDING_SCHEMA = 'nesttrace.recording';
export const LEGACY_CAMERA_MASKS_SCHEMA = 'nesttrace.camera_masks';
export const LEGACY_STORAGE_KEYS = {
    alertsOpen: 'nesttrace.alerts.open', legendOpen: 'nesttrace.legend.open', panelWidth: 'nesttrace.panel.width',
    phoneName: 'nesttrace.phoneName', detections: 'nesttrace.detections',
} as const;
