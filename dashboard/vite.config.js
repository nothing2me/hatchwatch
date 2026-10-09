// Vite build configuration for the NestTrace dashboard.
// The React plugin enables JSX and fast refresh during development.
//
// Two pages: index.html (the dashboard) and camera.html (the phone camera,
// served at /camera). /api calls go to the camera relay in server/server.mjs.
//
// `npm run dev:phone` uses mode "phone": a self-signed HTTPS certificate on
// the local network so a phone browser is allowed to open its camera.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig(function buildConfig({ mode })
{
    const isPhoneMode = mode === 'phone';

    return {
        plugins: isPhoneMode ? [react(), basicSsl()] : [react()],

        build:
        {
            rollupOptions:
            {
                input: { main: 'index.html', camera: 'camera.html' },
            },
        },

        // Own ports so the dashboard never collides with the research
        // simulator (Vite on 5173, local API on 5174).
        server:
        {
            port: 5180,
            strictPort: true,
            host: isPhoneMode ? true : undefined,
            proxy: { '/api': 'http://localhost:5182' },
        },
        preview:
        {
            port: 5181,
            strictPort: true,
            proxy: { '/api': 'http://localhost:5182' },
        },
    };
});
