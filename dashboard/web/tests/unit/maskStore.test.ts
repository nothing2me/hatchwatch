import { describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { masksRoot, readMasks, writeMask } from '@/lib/cameras/maskStore';

const square: [number, number][] = [[100, 300], [1100, 300], [1100, 700], [100, 700]];
// The first save starts from the repo default set, so other cameras' defaults carry forward; check camera 0 itself.
const cameraZero = (cameras: { camera: number; polygon: [number, number][] }[]) => cameras.find(entry => entry.camera === 0)?.polygon;

function folders()
{
    const base = mkdtempSync(join(tmpdir(), 'hatchwatch-masks-'));
    return { live: join(base, 'public'), operator: join(base, 'operator') };
}

describe('camera mask store', () =>
{
    it('saves to MASKS_ROOT, never into the read-only live folder', () =>
    {
        const { live, operator } = folders();
        writeMask(live, 0, square, undefined, operator);
        expect(existsSync(join(operator, 'camera-masks.json'))).toBe(true);
        expect(existsSync(join(live, 'camera-masks.json'))).toBe(false);
        expect(cameraZero(readMasks(live, operator).cameras)).toEqual(square);
    });

    it('keeps the other cameras when one camera is saved', () =>
    {
        const { live, operator } = folders();
        writeMask(live, 0, square, undefined, operator);
        writeMask(live, 1, [[0, 0], [1280, 0], [640, 720]], undefined, operator);
        writeMask(live, 0, [[10, 10], [20, 10], [20, 20]], undefined, operator);
        const cameras = readMasks(live, operator).cameras;
        expect(cameras.map(entry => entry.camera)).toEqual([0, 1]);
        expect(cameras[0].polygon).toEqual([[10, 10], [20, 10], [20, 20]]);
    });

    it('falls back to the older public copy until an admin saves', () =>
    {
        const { live, operator } = folders();
        writeMask(live, 0, square, undefined, live); // an older setup wrote into the live folder
        expect(readMasks(live, operator).source).toBe('public');
        expect(cameraZero(readMasks(live, operator).cameras)).toEqual(square);
        writeMask(live, 1, [[0, 0], [1280, 0], [640, 720]], undefined, operator);
        // The first operator save carries the older cameras forward.
        expect(JSON.parse(readFileSync(join(operator, 'camera-masks.json'), 'utf8')).cameras.map((entry: { camera: number }) => entry.camera)).toEqual([0, 1]);
    });

    it('uses MASKS_ROOT when it is set, else the live folder', () =>
    {
        expect(masksRoot('/sim-public', { MASKS_ROOT: '/operator' } as unknown as NodeJS.ProcessEnv)).toMatch(/operator$/);
        expect(masksRoot('/sim-public', {} as unknown as NodeJS.ProcessEnv)).toBe('/sim-public');
    });

    it('fails loudly when the masks folder is not writable', () =>
    {
        const { live, operator } = folders();
        writeMask(live, 0, square, undefined, operator);
        writeFileSync(join(operator, 'camera-masks.json.tmp-' + process.pid), '');
        chmodSync(join(operator, 'camera-masks.json.tmp-' + process.pid), 0o444);
        // Windows ignores POSIX read-only bits on files; only assert where they apply.
        if (process.platform !== 'win32')
        {
            expect(() => writeMask(live, 0, square, undefined, operator)).toThrow();
        }
    });
});
