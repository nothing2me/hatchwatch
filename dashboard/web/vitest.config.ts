import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const plugins = [react()];
const resolve = { tsconfigPaths: true };

// Vitest 5 has no environmentMatchGlobs; split node (.ts) and jsdom (.tsx) into projects.
export default defineConfig({
    test: {
        projects: [
            {
                plugins,
                resolve,
                test: { name: 'node', environment: 'node', include: ['tests/**/*.test.ts'] },
            },
            {
                plugins,
                resolve,
                test: { name: 'dom', environment: 'jsdom', include: ['tests/**/*.test.tsx'] },
            },
        ],
    },
});
