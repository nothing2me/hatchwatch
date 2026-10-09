import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    reactStrictMode: true,
    poweredByHeader: false,
    experimental: { authInterrupts: true },
    // Next 16 treats 127.0.0.1 as a different dev origin from localhost and
    // blocks the MapLibre chunk, which leaves the map blank.
    allowedDevOrigins: ['127.0.0.1'],
};

export default nextConfig;
