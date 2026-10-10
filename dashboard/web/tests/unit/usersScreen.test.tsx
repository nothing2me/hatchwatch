import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const addUserAction = vi.fn();
const setRoleAction = vi.fn();
const setDisabledAction = vi.fn();
const resetPasswordAction = vi.fn();
vi.mock('@/app/(app)/actions', () => ({ logoutAction: vi.fn() }));
vi.mock('@/app/(app)/setup/users/actions', () => ({ addUserAction, setRoleAction, setDisabledAction, resetPasswordAction }));

const { UsersScreen } = await import('@/features/users/UsersScreen');

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const admin = { id: 'a', email: 'admin@x.y', name: 'Admin', role: 'ADMIN' as const };
const bar = { camerasOnline: 1, camerasTotal: 2, activeSites: 0 };
const users = [
    { id: 'a', name: 'Admin', email: 'admin@x.y', role: 'ADMIN' as const, disabledAt: null, createdAt: '2026-10-01T00:00:00.000Z' },
    { id: 'v', name: 'Vol', email: 'vol@x.y', role: 'VOLUNTEER' as const, disabledAt: null, createdAt: '2026-10-02T00:00:00.000Z' },
    { id: 'd', name: 'Gone', email: 'gone@x.y', role: 'VIEWER' as const, disabledAt: '2026-10-03T00:00:00.000Z', createdAt: '2026-10-03T00:00:00.000Z' },
];

describe('UsersScreen', () =>
{
    it('lists people, locks your own row and offers Enable for disabled people', () =>
    {
        render(<UsersScreen user={admin} users={users} bar={bar} />);
        expect((screen.getByLabelText('Role for Admin') as HTMLSelectElement).disabled).toBe(true);
        expect((screen.getByLabelText('Role for Vol') as HTMLSelectElement).value).toBe('VOLUNTEER');
        const gone = screen.getByText('Gone').closest('tr') as HTMLElement;
        expect(gone.getAttribute('data-disabled')).toBe('true');
        expect(within(gone).getByRole('button', { name: 'Enable' })).toBeTruthy();
        expect(screen.getAllByRole('button', { name: 'Disable' })).toHaveLength(1);
    });

    it('adds a volunteer by default and shows the one-time password', async () =>
    {
        addUserAction.mockResolvedValue({ ok: true, temporaryPassword: 'abcDEF123_-x' });
        render(<UsersScreen user={admin} users={users} bar={bar} />);
        expect((screen.getByLabelText('Role', { selector: 'select' }) as HTMLSelectElement).value).toBe('VOLUNTEER');
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Test Volunteer' } });
        fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'Volunteer@Nesttrace.Local' } });
        fireEvent.click(screen.getAllByRole('button', { name: 'Add person' })[0]);
        await waitFor(() => expect(screen.getByTestId('temp-password').textContent).toBe('abcDEF123_-x'));
        expect(addUserAction).toHaveBeenCalledWith({ name: 'Test Volunteer', email: 'Volunteer@Nesttrace.Local', role: 'VOLUNTEER' });
        expect(screen.getByText('Shown once — share it privately.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    });

    it('shows an action error and calls role and disable actions', async () =>
    {
        setRoleAction.mockResolvedValue({ ok: false, error: 'You cannot change your own role.' });
        setDisabledAction.mockResolvedValue({ ok: true });
        render(<UsersScreen user={admin} users={users} bar={bar} />);
        fireEvent.change(screen.getByLabelText('Role for Vol'), { target: { value: 'VIEWER' } });
        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('cannot change'));
        expect(setRoleAction).toHaveBeenCalledWith('v', 'VIEWER');
        await waitFor(() => expect((screen.getByRole('button', { name: 'Disable' }) as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
        await waitFor(() => expect(setDisabledAction).toHaveBeenCalledWith('v', true));
    });

    it('keeps Settings selected for the users page', () =>
    {
        render(<UsersScreen user={admin} users={users} bar={bar} />);
        expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('aria-current')).toBe('page');
        expect(screen.queryByRole('link', { name: 'Users' })).toBeNull();
    });
});
