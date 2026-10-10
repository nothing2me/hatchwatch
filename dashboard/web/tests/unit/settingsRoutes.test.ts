import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import nextConfig from '../../next.config';

describe('settings routes', () =>
{
    it('permanently redirects /setup and its sub-paths to /settings', async () =>
    {
        const rules = await nextConfig.redirects!();
        expect(rules).toContainEqual({ source: '/setup', destination: '/settings', permanent: true });
        expect(rules).toContainEqual({ source: '/setup/:path*', destination: '/settings/:path*', permanent: true });
    });

    it('top bar Settings link points at /settings', () =>
    {
        const src = readFileSync('src/features/shell/TopBar.tsx', 'utf8');
        expect(src).toContain("href: '/settings', label: 'Settings', adminOnly: true");
        expect(src).not.toContain('/setup');
    });
});
