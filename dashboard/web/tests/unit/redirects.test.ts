import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import nextConfig from '../../next.config';

const app = 'src/app/(app)';

// Static page file for a redirect path (wildcards map to the folder itself).
function pageFor(path: string): string
{
    const folder = path.replace(/\/:path\*$/, '');
    return `${app}${folder === '/' ? '' : folder}/page.tsx`;
}

describe('legacy redirects', () =>
{
    it('permanently redirects /setup and /live to their new pages, keeping sub-paths', async () =>
    {
        const rules = await nextConfig.redirects!();
        expect(rules).toEqual([
            { source: '/setup', destination: '/settings', permanent: true },
            { source: '/setup/:path*', destination: '/settings/:path*', permanent: true },
            { source: '/live', destination: '/cameras', permanent: true },
            { source: '/live/motion', destination: '/cameras/motion', permanent: true },
        ]);
    });

    it('never loops: no destination is also a source', async () =>
    {
        const rules = await nextConfig.redirects!();
        const sources = new Set(rules.map(rule => rule.source.replace(/\/:path\*$/, '')));
        for (const rule of rules)
        {
            expect(sources.has(rule.destination.replace(/\/:path\*$/, ''))).toBe(false);
        }
    });

    it('has a page at each destination and none left at each source', async () =>
    {
        const rules = await nextConfig.redirects!();
        for (const rule of rules)
        {
            expect(existsSync(pageFor(rule.destination)), rule.destination).toBe(true);
            expect(existsSync(pageFor(rule.source)), rule.source).toBe(false);
        }
    });
});
