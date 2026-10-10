// Vite build configuration for the NestTrace dashboard.
// The React plugin enables JSX and fast refresh during development.
//
// Three pages: index.html (the dashboard), camera.html (the phone camera,
// served at /camera) and motion.html (live feed beside its motion
// difference, at /motion).
//
// `npm run dev:phone` uses mode "phone": a self-signed HTTPS certificate on
// the local network so a phone browser is allowed to open its camera.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// The dashboard backend (server/server.js: live feed, nest log and the phone
// camera relay) runs on its own port; the browser reaches it through this
// proxy so everything is same-origin.
const backendProxy =
{
    '/api': 'http://127.0.0.1:5182',
    '/media': 'http://127.0.0.1:5182',
};

export default defineConfig(function buildConfig({ mode })
{
    const isPhoneMode = mode === 'phone';

    return {
        plugins: isPhoneMode ? [react(), basicSsl()] : [react()],

        build:
        {
            rollupOptions:
            {
                input: { main: 'index.html', camera: 'camera.html', motion: 'motion.html' },
            },
        },

        // Own ports so the dashboard never collides with the research
        // simulator (Vite on 5173, local API on 5174).
        server:
        {
            port: 5180,
            strictPort: true,
            host: isPhoneMode ? true : undefined,
            proxy: backendProxy,
        },
        preview:
        {
            port: 5181,
            strictPort: true,
            proxy: backendProxy,
        },
    };
});
