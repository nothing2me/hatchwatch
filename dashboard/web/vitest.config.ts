import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const plugins = [react()];
const resolve = {
    tsconfigPaths: true,
    alias: { 'server-only': new URL('./tests/stubs/server-only.ts', import.meta.url).pathname },
};
const shared = { setupFiles: ['dotenv/config'], fileParallelism: false };

// Vitest 5 has no environmentMatchGlobs; split node (.ts) and jsdom (.tsx) into projects.
export default defineConfig({
    test: {
        fileParallelism: false,
        projects: [
            {
                plugins,
                resolve,
                test: { ...shared, name: 'node', environment: 'node', include: ['tests/**/*.test.ts'] },
            },
            {
                plugins,
                resolve,
                test: { ...shared, name: 'dom', environment: 'jsdom', include: ['tests/**/*.test.tsx'] },
            },
        ],
    },
});
