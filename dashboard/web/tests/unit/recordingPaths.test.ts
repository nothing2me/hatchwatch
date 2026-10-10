import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recordingsRoot, resolveRecordingPath, segmentBase } from '@/lib/phones/recordingPaths';

const root = '/srv/recordings';
const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

describe('recording paths', () =>
{
    it('lays segments out by device and UTC date and time', () =>
    {
        expect(segmentBase('ckd1', Date.UTC(2026, 9, 10, 7, 5, 9))).toBe('ckd1/2026-10-10/070509');
    });

    it('accepts only our own layout inside the root', () =>
    {
        expect(resolveRecordingPath(root, 'ckd1/2026-10-10/070509.mp4')).toBe(join(root, 'ckd1/2026-10-10/070509.mp4'));
        expect(resolveRecordingPath(root, 'ckd1/2026-10-10/070509-2.avi')).toBe(join(root, 'ckd1/2026-10-10/070509-2.avi'));
        for (const bad of ['../etc/passwd', '/etc/passwd', 'ckd1/../../x.mp4', 'ckd1/2026-10-10/070509.json', 'ckd1/2026-10-10/070509.avi.part',
            'ckd1/2026-10-10/%2e%2e.mp4', 'CKD1/2026-10-10/070509.mp4', 'ckd1\\2026-10-10\\070509.mp4', 'ckd1/2026-10-10/070509.mp4/..', ''])
        {
            expect(resolveRecordingPath(root, bad)).toBeNull();
        }
    });

    it('defaults to dashboard/recordings beside the web folder', () =>
    {
        expect(recordingsRoot(env({ RECORDINGS_ROOT: '/recordings' }))).toBe('/recordings');
        expect(recordingsRoot(env({}))).toBe(join(process.cwd(), '..', 'recordings'));
    });
});
