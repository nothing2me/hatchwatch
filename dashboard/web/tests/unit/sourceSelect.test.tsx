import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const setCameraSource = vi.fn();
vi.mock('@/app/(app)/camera-actions', () => ({ setCameraSource: (...args: unknown[]) => setCameraSource(...args) }));
const { SourceSelect } = await import('@/features/phones/SourceSelect');

const dune = { id: 'ck1', name: 'Dune phone', ownerName: 'Vo', cameraCode: null, online: true, recording: false, lastSeenAt: '2026-10-10T20:00:00.000Z' };
const taken = { ...dune, id: 'ck2', name: 'Pier phone', cameraCode: 'C1', online: false };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('SourceSelect', () =>
{
    it('lists the loop and each phone, disables one that feeds another camera, and links on change', async () =>
    {
        setCameraSource.mockResolvedValue({ ok: false, error: 'Dune phone already feeds camera C1; set C1 back to Simulation loop first.' });
        render(<SourceSelect cameraCode="B1" value={null} devices={[dune, taken]} />);
        const select = screen.getByLabelText('Source') as HTMLSelectElement;
        expect([...select.options].map(o => [o.textContent, o.disabled])).toEqual([
            ['Simulation loop', false],
            ['Dune phone · Vo · online', false],
            ['Pier phone · Vo · offline (feeds C1)', true],
        ]);
        fireEvent.change(select, { target: { value: 'ck1' } });
        expect(await screen.findByRole('alert')).toBeTruthy();
        expect(setCameraSource).toHaveBeenCalledWith('B1', 'ck1');
        fireEvent.change(select, { target: { value: '' } });
        await waitFor(() => expect(setCameraSource).toHaveBeenLastCalledWith('B1', null));
    });

    it('loads phones itself, survives a body without devices, and keeps the current link selectable', async () =>
    {
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ nope: true })));
        render(<SourceSelect cameraCode="B1" value="ck9" />);
        expect(await screen.findByText('Could not load phones.')).toBeTruthy();
        const select = screen.getByLabelText('Source') as HTMLSelectElement;
        expect(select.value).toBe('ck9');
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ devices: [dune] })));
        fireEvent.focus(select);
        await waitFor(() => expect(screen.queryByText('Could not load phones.')).toBeNull());
        expect(screen.getByRole('option', { name: 'Dune phone · Vo · online' })).toBeTruthy();
    });
});
