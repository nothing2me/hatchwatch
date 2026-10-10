import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const web = join(import.meta.dirname, '../..');
const roots = [join(web, 'src'), join(web, '../worker/hatchwatch_worker')];
// Spec §6: old names are read for compatibility from this one file only.
const allowed = new Set(['src/lib/legacyNames.ts']);

function* files(dir: string): Generator<string>
{
    for (const name of readdirSync(dir))
    {
        if (name === '__pycache__' || name === 'node_modules')
        {
            continue;
        }
        const path = join(dir, name);
        if (statSync(path).isDirectory())
        {
            yield* files(path);
        }
        else if (/\.(ts|tsx|js|mjs|css|py|json)$/.test(name))
        {
            yield path;
        }
    }
}

describe('HatchWatch naming', () =>
{
    it('has renamed the worker package', () =>
    {
        expect(existsSync(join(web, '../worker/hatchwatch_worker/main.py'))).toBe(true);
        expect(existsSync(join(web, '../worker/nesttrace_worker'))).toBe(false);
    });

    it('keeps the old name out of dashboard and worker source, except the legacy-names file', () =>
    {
        const stray: string[] = [];
        for (const root of roots.filter(existsSync))
        {
            for (const path of files(root))
            {
                const name = relative(web, path);
                if (!allowed.has(name) && /nesttrace/i.test(readFileSync(path, 'utf8')))
                {
                    stray.push(name);
                }
            }
        }
        expect(stray).toEqual([]);
    });
});
