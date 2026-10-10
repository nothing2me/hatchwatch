import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@/generated/prisma/client';
import type { MaskPoint } from '@/lib/cameras/masks';
import { masksRoot, readDefaultMasks, readMasks } from '@/lib/cameras/maskStore';
import { buildResearchMasks, RESEARCH_MASKS_SCHEMA, researchSlot, syncResearchMasks, type MaskedCamera } from '@/lib/cameras/researchMasks';

const A1: MaskPoint[] = [[0.1, 0.5], [0.9, 0.5], [0.9, 0.95], [0.1, 0.95]];
const B1: MaskPoint[] = [[0.2, 0.4], [0.8, 0.4], [0.5, 0.9]];
const B2: MaskPoint[] = [[0, 0.6], [1, 0.6], [1, 1], [0, 1]];
const example: MaskedCamera[] = [
    { code: 'B2', mask: B2, updatedAt: new Date('2026-10-10T12:01:00Z') },
    { code: 'A1', mask: A1, updatedAt: new Date('2026-10-10T12:00:00Z') },
    { code: 'B1', mask: B1, updatedAt: new Date('2026-10-10T12:05:00Z') },
];

function folders()
{
    const base = mkdtempSync(join(tmpdir(), 'hatchwatch-masks-'));
    return { live: join(base, 'public'), operator: join(base, 'operator') };
}

// Only camera.findMany is used by the sync.
const fakePrisma = (rows: { code: string; maskPolygon: unknown; maskUpdatedAt: Date | null }[]) =>
    ({ camera: { findMany: vi.fn(async () => rows) } }) as unknown as PrismaClient;

const rowsOf = (cameras: MaskedCamera[]) => cameras.map(camera => ({ code: camera.code, maskPolygon: camera.mask, maskUpdatedAt: camera.updatedAt }));

afterEach(() => { vi.restoreAllMocks(); });

describe('research slot of a camera code', () =>
{
    it('puts odd-numbered cameras on slot 0 and even ones on slot 1', () =>
    {
        expect(researchSlot('A1')).toBe(0);
        expect(researchSlot('A2')).toBe(1);
        expect(researchSlot('C7')).toBe(0);
        expect(researchSlot('E10')).toBe(1);
        expect(researchSlot('X')).toBeNull();
    });
});

describe('buildResearchMasks', () =>
{
    it('matches the versioned example: slot 0 from the newest odd mask (B1), slot 1 from B2', () =>
    {
        const expected = JSON.parse(readFileSync('../../schemas/examples/camera-masks.v1.example.json', 'utf8'));
        const built = buildResearchMasks(example, readDefaultMasks());
        expect(built).toEqual(expected);
        expect(built.schema).toBe(RESEARCH_MASKS_SCHEMA);
    });

    it('falls back to the repository default for a slot with no mask', () =>
    {
        const defaults = readDefaultMasks();
        const built = buildResearchMasks([example[1]], defaults);
        expect(built.cameras[0].label).toMatch(/^From camera A1/);
        expect(built.cameras[1]).toEqual({ camera: 1, label: defaults.find(entry => entry.camera === 1)!.label, polygon: defaults.find(entry => entry.camera === 1)!.polygon });
        expect(Object.keys(built.by_code)).toEqual(['A1']);
    });
});

describe('camera mask store', () =>
{
    it('uses MASKS_ROOT when it is set, else the live folder', () =>
    {
        expect(masksRoot('/sim-public', { MASKS_ROOT: '/operator' } as unknown as NodeJS.ProcessEnv)).toMatch(/operator$/);
        expect(masksRoot('/sim-public', {} as unknown as NodeJS.ProcessEnv)).toBe('/sim-public');
    });

    it('reads the repository default per-slot masks', () =>
    {
        expect(readDefaultMasks().map(entry => entry.camera)).toEqual([0, 1]);
    });
});

describe('syncResearchMasks', () =>
{
    it('writes to the masks root, never into the live folder, and reads back by code', async () =>
    {
        const { live, operator } = folders();
        expect(await syncResearchMasks(fakePrisma(rowsOf(example)), live, operator)).toBe('written');
        expect(existsSync(join(operator, 'camera-masks.json'))).toBe(true);
        expect(existsSync(join(live, 'camera-masks.json'))).toBe(false);
        const read = readMasks(live, operator);
        expect(read.source).toBe('public');
        expect(Object.keys(read.byCode)).toEqual(['A1', 'B1', 'B2']);
        expect(read.cameras.map(entry => entry.camera)).toEqual([0, 1]);
    });

    it('skips stored values that are not valid masks', async () =>
    {
        const { live, operator } = folders();
        await syncResearchMasks(fakePrisma([...rowsOf([example[1]]), { code: 'C1', maskPolygon: 'x', maskUpdatedAt: new Date() }]), live, operator);
        expect(Object.keys(JSON.parse(readFileSync(join(operator, 'camera-masks.json'), 'utf8')).by_code)).toEqual(['A1']);
    });

    it('copies an older per-slot file to camera-masks.legacy.json once', async () =>
    {
        const { live, operator } = folders();
        mkdirSync(operator, { recursive: true });
        const legacy = JSON.stringify({ schema: 'nesttrace.camera_masks', version: 1, cameras: [{ camera: 0, polygon: [[1, 1], [2, 1], [2, 2]] }] });
        writeFileSync(join(operator, 'camera-masks.json'), legacy);
        await syncResearchMasks(fakePrisma(rowsOf(example)), live, operator);
        expect(readFileSync(join(operator, 'camera-masks.legacy.json'), 'utf8')).toBe(legacy);
        // A later sync of a new-format file leaves the legacy copy alone.
        writeFileSync(join(operator, 'camera-masks.json'), JSON.stringify({ cameras: [] }));
        await syncResearchMasks(fakePrisma([]), live, operator);
        expect(readFileSync(join(operator, 'camera-masks.legacy.json'), 'utf8')).toBe(legacy);
    });

    it('returns failed when the masks folder is not writable', async () =>
    {
        // Windows ignores POSIX read-only bits; only assert where they apply.
        if (process.platform === 'win32' || process.getuid?.() === 0)
        {
            return;
        }
        const { live, operator } = folders();
        mkdirSync(operator, { recursive: true });
        chmodSync(operator, 0o500);
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try
        {
            expect(await syncResearchMasks(fakePrisma(rowsOf(example)), live, operator)).toBe('failed');
            expect(error).toHaveBeenCalledWith('[masks] could not write the research mask file:', 'EACCES');
        }
        finally
        {
            chmodSync(operator, 0o700);
        }
    });
});
