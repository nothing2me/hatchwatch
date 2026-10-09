import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    reactStrictMode: true,
    poweredByHeader: false,
    experimental: { authInterrupts: true },
};

export default nextConfig;
