import { afterEach, describe, expect, it, vi } from 'vitest';

const startRecorder = vi.fn();
vi.mock('@/lib/phones/recorder', () => ({ recorderSettings: () => ({ root: '/nowhere' }), startRecorder }));

describe('register', () =>
{
    afterEach(() =>
    {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it('keeps booting with recording disabled when the recorder cannot start', async () =>
    {
        vi.stubEnv('NEXT_RUNTIME', 'nodejs');
        vi.stubEnv('LIVE_FEED', '0');
        const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        startRecorder.mockRejectedValueOnce(new Error('EACCES: permission denied, mkdir \'/nowhere\''));
        const { register } = await import('@/instrumentation');
        await expect(register()).resolves.toBeUndefined();
        expect(startRecorder).toHaveBeenCalledOnce();
        expect(logged.mock.calls[0].join(' ')).toContain('EACCES');
    });
});
