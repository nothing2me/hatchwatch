import { z } from 'zod';

// live-chunk.v1: mirrors schemas/live-chunk.v1.json. The only contract with the continuous simulator.
const camera = z.object({
    index: z.union([z.literal(0), z.literal(1)]),
    end: z.enum(['x_min', 'x_max']),
    video: z.enum(['camera-0.mp4', 'camera-1.mp4']),
    calibration: z.enum(['calibration-0.json', 'calibration-1.json']),
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
    rendering: z.enum(['synthetic-daylight', 'synthetic-very-dark']),
    ground_bounds_m: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    cameras: z.tuple([camera, camera]),
    pins: z.literal('pins/predictions.json'),
    note: z.string(),
}).strict();

export type LiveManifest = z.infer<typeof liveManifestSchema>;
