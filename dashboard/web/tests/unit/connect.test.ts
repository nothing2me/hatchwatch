import { describe, expect, it } from 'vitest';
import { connectUrl } from '@/lib/phones/connect';

describe('connectUrl', () =>
{
    it('builds the phone address from LAN_HOST', () =>
    {
        expect(connectUrl('192.168.1.20')).toBe('https://192.168.1.20:3443/cam');
        expect(connectUrl(' laptop.local ')).toBe('https://laptop.local:3443/cam');
        for (const bad of [undefined, '', 'evil.example/x', 'a b', 'host:99', 'javascript:alert(1)'])
        {
            expect(connectUrl(bad)).toBeNull();
        }
    });
});
