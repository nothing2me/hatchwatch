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

// Optional public trail and people files; mirror schemas/tracks.v1.json and schemas/people.v1.json. Points are [t, x, y] in sim metres.
const pathPoint = z.tuple([z.number(), z.number(), z.number()]);

export const tracksFileSchema = z.object({
    schema: z.literal('nesttrace.tracks'),
    version: z.literal(1),
    note: z.string(),
    tracks: z.array(z.object({
        id: z.string().regex(/^track-[0-9]+$/),
        pin_id: z.string().nullable(),
        points: z.array(pathPoint).min(2),
    }).strict()),
}).strict();

export const peopleFileSchema = z.object({
    schema: z.literal('nesttrace.people'),
    version: z.literal(1),
    note: z.string(),
    people: z.array(z.object({
        id: z.string().regex(/^person-[0-9]+$/),
        max_height_m: z.number(),
        points: z.array(pathPoint).min(2),
    }).strict()),
}).strict();

export type SimTrack = z.infer<typeof tracksFileSchema>['tracks'][number];
export type SimPerson = z.infer<typeof peopleFileSchema>['people'][number];
