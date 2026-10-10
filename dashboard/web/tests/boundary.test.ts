import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const dashboardRoot = join(import.meta.dirname, '..', '..');
const skipDirectories = new Set(['node_modules', '.next', 'generated', 'migrations', 'media']);
const scannedExtensions = /\.(ts|tsx|js|mjs|cjs|py|json|ya?ml|Dockerfile)$|Dockerfile$/;

// agent.md: the dashboard must not depend on the simulator, the research API, or evaluator truth.
const forbidden: { pattern: RegExp; reason: string }[] = [
    { pattern: /(from\s*|import\s*\(?\s*|require\s*\(\s*)['"](\.\.\/)+web\//, reason: 'imports the research simulator' },
    { pattern: /scripts\/server\.mjs/, reason: 'references the research API' },
    { pattern: /(localhost|127\.0\.0\.1|\[::1\]):5174/, reason: 'calls the research API port' },
    { pattern: /artifacts\/private|examples\/[^/]+\/private/, reason: 'reads private evaluator truth' },
];

function walk(directory: string): string[]
{
    return readdirSync(directory).flatMap(name =>
    {
        const path = join(directory, name);
        if (statSync(path).isDirectory())
        {
            return skipDirectories.has(name) ? [] : walk(path);
        }
        return scannedExtensions.test(name) ? [path] : [];
    });
}

describe('dashboard boundary', () =>
{
    it('never references the simulator, research API or private truth', () =>
    {
        const self = relative(dashboardRoot, import.meta.filename);
        const violations = walk(dashboardRoot)
            .filter(path => relative(dashboardRoot, path) !== self)
            .flatMap(path =>
            {
                const text = readFileSync(path, 'utf8');
                return forbidden.filter(rule => rule.pattern.test(text)).map(rule => `${relative(dashboardRoot, path)}: ${rule.reason}`);
            });
        expect(violations).toEqual([]);
    });
});
