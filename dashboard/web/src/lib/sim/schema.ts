import { z } from 'zod';

// sim-import-v1: the only simulator files the dashboard reads, all from a run's public folder.
export const pinSchema = z.object({
    id: z.string(),
    point: z.tuple([z.number(), z.number()]),
    interval: z.tuple([z.number(), z.number()]),
    score: z.number(),
    evidence_tier: z.enum(['two_camera', 'single_camera']),
    source_views: z.array(z.number().int().min(0).max(1)).min(1),
}).refine(pin => pin.interval[0] <= pin.interval[1], { message: 'pin interval must not run backwards', path: ['interval'] });

export const pinsFileSchema = z.object({
    schema_version: z.literal(1),
    methods: z.object({ pins: z.array(pinSchema) }),
});

export const calibrationSchema = z.object({
    camera: z.number(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    ground_bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});

export const timestampsSchema = z.array(z.number()).min(2);

export type SimPin = z.infer<typeof pinSchema>;
