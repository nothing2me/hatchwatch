import { describe, expect, it } from 'vitest';
import { describeFrameStatus, describeMediaError, MESSAGES, QUALITY_PRESETS, SEND_FPS } from '@/features/phones/camMessages';

describe('phone page messages', () =>
{
    it('pins the presets and send rate', () =>
    {
        expect(QUALITY_PRESETS.standard).toMatchObject({ width: 960, height: 540, jpegQuality: 0.7 });
        expect(QUALITY_PRESETS.high).toMatchObject({ width: 1280, height: 720, jpegQuality: 0.8 });
        expect(SEND_FPS).toBe(5);
    });

    it('explains camera errors in plain words', () =>
    {
        expect(describeMediaError(new DOMException('x', 'NotAllowedError'))).toBe(MESSAGES.permission);
        expect(describeMediaError(new DOMException('x', 'SecurityError'))).toBe(MESSAGES.permission);
        expect(describeMediaError(new DOMException('x', 'NotFoundError'))).toBe(MESSAGES.noCamera);
        expect(describeMediaError(new DOMException('x', 'OverconstrainedError'))).toBe(MESSAGES.noCamera);
        expect(describeMediaError(new DOMException('x', 'NotReadableError'))).toBe(MESSAGES.busy);
        expect(describeMediaError(new Error('boom'))).toBe('Could not open the camera (Error).');
    });

    it('explains refused frames, and retries quietly when too fast', () =>
    {
        expect(describeFrameStatus(401)).toBe(MESSAGES.signedOut);
        expect(describeFrameStatus(403)).toBe(MESSAGES.refused);
        expect(describeFrameStatus(413)).toBe(MESSAGES.tooLarge);
        expect(describeFrameStatus(429)).toBeNull();
        expect(describeFrameStatus(500)).toBe('The server refused a frame (error 500).');
    });
});
