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
        first.unmount();
        render(<Legend />);
        expect(screen.queryByText('High')).toBeNull();
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
});
