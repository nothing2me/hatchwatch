import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { liveManifestSchema } from '@/lib/live/manifest';
import { pinsFileSchema } from '@/lib/sim/schema';

export const validManifest = () => ({
    schema: 'nesttrace.live-chunk', version: 1, chunk_id: 'live-000007-abc12', sequence: 7,
    recording_started_at: '2026-10-10T00:25:23.805Z', published_at: '2026-10-10T00:26:38.244Z',
    clip_seconds: 40, fps: 8, rendering: 'synthetic-daylight', ground_bounds_m: [-12, 12, -8, 8],
    cameras: [
        { index: 0, end: 'x_min', video: 'camera-0.mp4', calibration: 'calibration-0.json' },
        { index: 1, end: 'x_max', video: 'camera-1.mp4', calibration: 'calibration-1.json' },
    ],
    pins: 'pins/predictions.json', note: 'Synthetic.',
});

describe('liveManifestSchema', () =>
{
    it('accepts a valid manifest', () => { expect(liveManifestSchema.safeParse(validManifest()).success).toBe(true); });
    it('accepts paired public motion maps and rejects a mismatched view', () =>
    {
        const manifest = validManifest();
        Object.assign(manifest.cameras[0], { motion_map: 'view-0/motion-map.png', motion_metadata: 'view-0/metadata.json', pure_motion: 'view-0/pure-motion.mp4' });
        Object.assign(manifest.cameras[1], { motion_map: 'view-1/motion-map.png', motion_metadata: 'view-1/metadata.json', pure_motion: 'view-1/pure-motion.mp4' });
        expect(liveManifestSchema.safeParse(manifest).success).toBe(true);
        Object.assign(manifest.cameras[0], { motion_map: 'view-1/motion-map.png' });
        expect(liveManifestSchema.safeParse(manifest).success).toBe(false);
    });
    it('accepts an optional shared per-camera watch mask and rejects a wrong file', () =>
    {
        const manifest = validManifest();
        Object.assign(manifest.cameras[0], { mask: 'mask.json' });
        Object.assign(manifest.cameras[1], { mask: 'mask.json' });
        expect(liveManifestSchema.safeParse(manifest).success).toBe(true);
        Object.assign(manifest.cameras[0], { mask: 'view-0/mask.json' });
        expect(liveManifestSchema.safeParse(manifest).success).toBe(false);
    });
    it('accepts the real runner output', () =>
    {
        const path = join(import.meta.dirname, '../fixtures/live-chunk/live-chunk.json');
        expect(liveManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).sequence).toBe(0);
    });
    it.each([
        ['wrong schema', (m: any) => { m.schema = 'other'; }],
        ['bad chunk id', (m: any) => { m.chunk_id = '../live-1'; }],
        ['three cameras', (m: any) => { m.cameras.push(m.cameras[0]); }],
        ['other pins path', (m: any) => { m.pins = 'private/truth.json'; }],
        ['extra key', (m: any) => { m.seed = 5; }],
        ['extra camera key', (m: any) => { m.cameras[0].path = '/x'; }],
        ['same end', (m: any) => { m.cameras[1].end = 'x_min'; }],
        ['same index', (m: any) => { m.cameras[1].index = 0; m.cameras[1].video = 'camera-0.mp4'; m.cameras[1].calibration = 'calibration-0.json'; }],
        ['video not matching index', (m: any) => { m.cameras[1].video = 'camera-0.mp4'; }],
        ['calibration not matching index', (m: any) => { m.cameras[0].calibration = 'calibration-1.json'; }],
        ['bad rendering', (m: any) => { m.rendering = 'infrared'; }],
    ])('rejects %s', (_name, mutate) =>
    {
        const manifest = validManifest();
        mutate(manifest);
        expect(liveManifestSchema.safeParse(manifest).success).toBe(false);
    });
});

describe('pins fixture', () =>
{
    it('is accepted by the shared pins schema', () =>
    {
        const path = join(import.meta.dirname, '../fixtures/live-chunk/pins/predictions.json');
        expect(pinsFileSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).methods.pins.length).toBeGreaterThan(0);
    });
});
