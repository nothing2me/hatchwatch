import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Legend } from '@/features/map/Legend';

afterEach(() =>
{
    cleanup();
    localStorage.clear();
});

describe('Legend', () =>
{
    it('starts open and collapses on click', () =>
    {
        render(<Legend />);
        expect(screen.getByText('High')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /legend/i }));
        expect(screen.queryByText('High')).toBeNull();
    });

    it('remembers the collapsed state', () =>
    {
        const first = render(<Legend />);
        fireEvent.click(screen.getByRole('button', { name: /legend/i }));
        expect(localStorage.getItem('hatchwatch.legend.open')).toBe('false');
        first.unmount();
        render(<Legend />);
        expect(screen.queryByText('High')).toBeNull();
    });

    it('keeps a collapsed state saved before the HatchWatch rename', () =>
    {
        localStorage.setItem('nesttrace.legend.open', 'false');
        render(<Legend />);
        expect(screen.queryByText('High')).toBeNull();
        expect(localStorage.getItem('hatchwatch.legend.open')).toBe('false');
        expect(localStorage.getItem('nesttrace.legend.open')).toBeNull();
    });

    it('still works when storage throws', () =>
    {
        const original = Storage.prototype.getItem;
        Storage.prototype.getItem = () => { throw new Error('blocked'); };
        try
        {
            render(<Legend />);
            expect(screen.getByText('High')).toBeTruthy();
        }
        finally
        {
            Storage.prototype.getItem = original;
        }
    });

    it('keeps only the essential map symbols and actions', () =>
    {
        render(<Legend />);
        expect(screen.getByText('Person near a site')).toBeTruthy();
        expect(screen.getByText('Click a pin for details. Right-click a zone for playback.')).toBeTruthy();
        expect(screen.queryByText(/24 × 16/)).toBeNull();
    });
});
