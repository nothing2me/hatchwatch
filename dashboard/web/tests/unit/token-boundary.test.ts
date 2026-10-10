import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const ALLOWED = ['src/lib/phones/deviceToken.ts', 'src/lib/phones/devices.ts', 'src/lib/phones/boards.ts'];
const NO_LOGS = [...ALLOWED, 'src/app/(app)/live/actions.ts', 'src/lib/phones/boardSecrets.ts', 'src/features/phones/BoardToken.tsx'];

function files(dir: string): string[]
{
    return readdirSync(dir).flatMap(name =>
    {
        const path = join(dir, name);
        if (name === 'generated' || name === 'node_modules') return [];
        return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
}

describe('device token boundary', () =>
{
    it('lets only the token, device and board modules touch tokenHash', () =>
    {
        const touching = files(join(root, 'src')).filter(path => readFileSync(path, 'utf8').includes('tokenHash')).map(path => relative(root, path));
        expect(touching.filter(path => !ALLOWED.includes(path))).toEqual([]);
    });

    it('never logs from code that holds a token or its hash', () =>
    {
        for (const path of NO_LOGS.map(file => join(root, file)).filter(existsSync))
        {
            expect(readFileSync(path, 'utf8'), path).not.toMatch(/console\.|logger\./);
        }
    });
});
