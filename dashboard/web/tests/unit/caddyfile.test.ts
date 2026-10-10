import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const caddyfile = readFileSync(join(import.meta.dirname, '..', '..', '..', 'Caddyfile'), 'utf8');

describe('Caddyfile', () =>
{
    it('answers /api/internal and everything under it with 404 before proxying', () =>
    {
        expect(caddyfile).toMatch(/^\s*@internal path \/api\/internal \/api\/internal\/\*\s*$/m);
        expect(caddyfile).toMatch(/^\s*respond @internal 404\s*$/m);
        expect(caddyfile.indexOf('respond @internal 404')).toBeLessThan(caddyfile.indexOf('reverse_proxy web:3000'));
    });
});
