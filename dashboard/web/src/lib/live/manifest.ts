import { z } from 'zod';

// live-chunk.v1: mirrors schemas/live-chunk.v1.json. The only contract with the continuous simulator.
const camera = z.object({
    index: z.union([z.literal(0), z.literal(1)]),
    end: z.enum(['x_min', 'x_max']),
    video: z.enum(['camera-0.mp4', 'camera-1.mp4']),
    calibration: z.enum(['calibration-0.json', 'calibration-1.json']),
    motion_map: z.enum(['view-0/motion-map.png', 'view-1/motion-map.png']).optional(),
    motion_metadata: z.enum(['view-0/metadata.json', 'view-1/metadata.json']).optional(),
    motion_candidates: z.enum(['view-0/detection/predictions.json', 'view-1/detection/predictions.json']).optional(),
    pure_motion: z.enum(['view-0/pure-motion.mp4', 'view-1/pure-motion.mp4']).optional(),
    mask: z.enum(['mask.json']).optional(),
}).strict();

export const liveManifestSchema = z.object({
    schema: z.literal('nesttrace.live-chunk'),
    version: z.literal(1),
    chunk_id: z.string().regex(/^live-[0-9]{6}-[A-Za-z0-9]+$/),
    sequence: z.number().int().min(0),
    recording_started_at: z.iso.datetime(),
    published_at: z.iso.datetime(),
    clip_seconds: z.number().positive(),
    fps: z.number().positive(),
    rendering: z.enum(['synthetic-daylight', 'synthetic-very-dark', 'synthetic-active-nir']),
    ground_bounds_m: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    cameras: z.tuple([camera, camera]),
    pins: z.literal('pins/predictions.json'),
    note: z.string(),
}).strict().superRefine((manifest, context) =>
{
    const [first, second] = manifest.cameras;
    if (first.end === second.end || first.index === second.index)
    {
        context.addIssue({ code: 'custom', path: ['cameras'], message: 'cameras need distinct ends and indexes' });
    }
    manifest.cameras.forEach((camera, position) =>
    {
        if (camera.video !== `camera-${camera.index}.mp4` || camera.calibration !== `calibration-${camera.index}.json` || (camera.motion_map && camera.motion_map !== `view-${camera.index}/motion-map.png`) || (camera.motion_metadata && camera.motion_metadata !== `view-${camera.index}/metadata.json`) || (camera.motion_candidates && camera.motion_candidates !== `view-${camera.index}/detection/predictions.json`) || (camera.pure_motion && camera.pure_motion !== `view-${camera.index}/pure-motion.mp4`) || (camera.mask && camera.mask !== 'mask.json'))
        {
            context.addIssue({ code: 'custom', path: ['cameras', position], message: 'video and calibration names must match the camera index' });
        }
    });
});

export type LiveManifest = z.infer<typeof liveManifestSchema>;
