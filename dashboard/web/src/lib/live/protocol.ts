import { z } from 'zod';

export const MAX_SIGNAL_BYTES = 65_536;
export const MAX_VIEWERS = 4;

// Browser -> server: one WebRTC signalling message. Viewers address the device implicitly; devices name `to`.
export const signalSchema = z.object({
    from: z.string().min(1).max(64),
    to: z.string().min(1).max(64).optional(),
    deviceId: z.string().min(1).max(64),
    type: z.enum(['offer', 'answer', 'ice', 'leave']),
    payload: z.unknown().optional(),
});

export type SignalMessage = z.infer<typeof signalSchema>;

// Server -> browser, over the SSE stream. The first event is always `hello` (or `full` / `device-offline`).
export type HubEvent =
    | { type: 'hello'; peerId: string }
    | { type: 'join'; from: string }
    | { type: 'offer' | 'answer' | 'ice'; from: string; payload: unknown }
    | { type: 'leave'; from: string }
    | { type: 'full' }
    | { type: 'device-offline' };
