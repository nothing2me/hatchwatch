import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { clampWidth, usePanelWidth } from '@/features/cameras/usePanelWidth';

afterEach(() =>
{
    vi.restoreAllMocks();
    localStorage.clear();
});

describe('usePanelWidth', () =>
{
    it('clamps to 304-720', () =>
    {
        expect(clampWidth(100)).toBe(304);
        expect(clampWidth(900)).toBe(720);
        expect(clampWidth(500.4)).toBe(500);
        expect(clampWidth(Number.NaN)).toBe(304);
    });

    it('defaults to 304 and persists a new width', () =>
    {
        const { result, unmount } = renderHook(() => usePanelWidth());
        expect(result.current.width).toBe(304);
        act(() => result.current.setWidth(600));
        expect(result.current.width).toBe(600);
        unmount();
        const again = renderHook(() => usePanelWidth());
        expect(again.result.current.width).toBe(600);
    });

    it('ignores a garbage stored value', () =>
    {
        localStorage.setItem('nesttrace.panel.width', 'wide');
        const { result } = renderHook(() => usePanelWidth());
        expect(result.current.width).toBe(304);
    });

    it('still works when storage throws', () =>
    {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
        const { result } = renderHook(() => usePanelWidth());
        act(() => result.current.setWidth(500));
        expect(result.current.width).toBe(500);
    });

    it('steps by 24 px and stays within bounds', () =>
    {
        const { result } = renderHook(() => usePanelWidth());
        act(() => result.current.nudge(24));
        expect(result.current.width).toBe(328);
        act(() => result.current.nudge(-240));
        expect(result.current.width).toBe(304);
        act(() => result.current.setWidth(710));
        act(() => result.current.nudge(24));
        expect(result.current.width).toBe(720);
    });
});
