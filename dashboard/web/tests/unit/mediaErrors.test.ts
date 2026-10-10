import { describe, expect, it } from 'vitest';
import { describeMediaError } from '@/features/live/mediaErrors';

const domError = (name: string) => Object.assign(new Error(name), { name });

describe('describeMediaError', () =>
{
    it('explains insecure contexts first', () =>
    {
        expect(describeMediaError(domError('NotAllowedError'), false)).toMatch(/https/i);
        expect(describeMediaError(null, false)).toMatch(/https/i);
    });
    it('maps common getUserMedia errors to plain language', () =>
    {
        expect(describeMediaError(domError('NotAllowedError'), true)).toMatch(/permission/i);
        expect(describeMediaError(domError('SecurityError'), true)).toMatch(/permission/i);
        expect(describeMediaError(domError('NotFoundError'), true)).toMatch(/no camera/i);
        expect(describeMediaError(domError('NotReadableError'), true)).toMatch(/in use/i);
        expect(describeMediaError(domError('OverconstrainedError'), true)).toMatch(/resolution|camera/i);
        expect(describeMediaError('weird', true)).toMatch(/could not start/i);
        expect(describeMediaError(null, true)).toMatch(/could not start/i);
    });
});
