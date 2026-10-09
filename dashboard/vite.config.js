// Vite build configuration for the NestTrace dashboard.
// The React plugin enables JSX and fast refresh during development.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(
{
    plugins: [react()],

    // Own ports so the dashboard never collides with the research
    // simulator (Vite on 5173, local API on 5174).
    server:
    {
        port: 5180,
        strictPort: true,

        // The dashboard backend (server/server.js) runs on its own port; the
        // browser reaches it through this proxy so everything is same-origin.
        proxy:
        {
            '/api': 'http://127.0.0.1:5182',
            '/media': 'http://127.0.0.1:5182',
        },
    },
    preview:
    {
        port: 5181,
        strictPort: true,
    },
});
