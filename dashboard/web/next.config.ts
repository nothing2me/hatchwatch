import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    reactStrictMode: true,
    poweredByHeader: false,
    experimental: { authInterrupts: true },
    // Next 16 treats 127.0.0.1 as a different dev origin from localhost and
    // blocks the MapLibre chunk, which leaves the map blank.
    allowedDevOrigins: ['127.0.0.1'],
    // Settings used to live at /setup; keep old links and bookmarks working.
    async redirects()
    {
        return [
            { source: '/setup', destination: '/settings', permanent: true },
            { source: '/setup/:path*', destination: '/settings/:path*', permanent: true },
        ];
    },
};

export default nextConfig;
