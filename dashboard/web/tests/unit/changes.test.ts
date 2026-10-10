import { describe, expect, it, vi } from 'vitest';
import { onChange, publishChange } from '@/lib/changes';

describe('change bus', () =>
{
    it('delivers the reason to every listener', () =>
    {
        const a = vi.fn();
        const b = vi.fn();
        const offA = onChange(a);
        const offB = onChange(b);
        publishChange('x');
        expect(a).toHaveBeenCalledWith('x');
        expect(b).toHaveBeenCalledWith('x');
        offA();
        offB();
    });
    it('stops delivery after unsubscribe', () =>
    {
        const a = vi.fn();
        const off = onChange(a);
        off();
        publishChange('y');
        expect(a).not.toHaveBeenCalled();
    });
});
