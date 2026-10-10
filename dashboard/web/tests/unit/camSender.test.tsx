import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CamSender } from '@/features/phones/CamSender';
import { MESSAGES } from '@/features/phones/camMessages';

afterEach(() =>
{
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
});

const volunteer = { name: 'Vo', role: 'VOLUNTEER' as const };

describe('CamSender', () =>
{
    it('tells a viewer they can watch but not send', () =>
    {
        render(<CamSender user={{ name: 'Vi', role: 'VIEWER' }} />);
        expect(screen.getByText(MESSAGES.viewer)).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
    });

    it('remembers the phone name and defaults to the rear camera and Standard quality', () =>
    {
        // Saved before the HatchWatch rename: read once and moved to the new key.
        localStorage.setItem('nesttrace.phoneName', 'Dune phone');
        render(<CamSender user={volunteer} />);
        expect((screen.getByLabelText('Phone name') as HTMLInputElement).value).toBe('Dune phone');
        expect(localStorage.getItem('hatchwatch.phoneName')).toBe('Dune phone');
        expect(localStorage.getItem('nesttrace.phoneName')).toBeNull();
        expect((screen.getByLabelText('Camera') as HTMLSelectElement).value).toBe('environment');
        expect((screen.getByLabelText('Quality') as HTMLSelectElement).value).toBe('standard');
    });

    it('explains that the page must be on HTTPS', async () =>
    {
        vi.stubGlobal('isSecureContext', false);
        render(<CamSender user={volunteer} />);
        fireEvent.change(screen.getByLabelText('Phone name'), { target: { value: 'Dune phone' } });
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        expect((await screen.findByRole('alert')).textContent).toBe(MESSAGES.https);
    });

    it('explains a refused camera permission and does not register the phone', async () =>
    {
        vi.stubGlobal('isSecureContext', true);
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError')) } });
        render(<CamSender user={volunteer} />);
        fireEvent.change(screen.getByLabelText('Phone name'), { target: { value: 'Dune phone' } });
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        expect((await screen.findByRole('alert')).textContent).toBe(MESSAGES.permission);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
