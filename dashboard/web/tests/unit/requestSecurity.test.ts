import { describe, expect, it } from 'vitest';
import { isHttpsRequest } from '@/lib/auth/requestSecurity';

describe('isHttpsRequest', () =>
{
    it('trusts X-Forwarded-Proto from the proxy', () =>
    {
        expect(isHttpsRequest(new Headers({ 'x-forwarded-proto': 'https' }))).toBe(true);
        expect(isHttpsRequest(new Headers({ 'x-forwarded-proto': 'https,http' }))).toBe(true);
        expect(isHttpsRequest(new Headers({ 'x-forwarded-proto': 'http' }))).toBe(false);
        expect(isHttpsRequest(new Headers())).toBe(false);
    });
});
