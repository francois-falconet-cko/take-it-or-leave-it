import type { NextConfig } from 'next';

/**
 * Kiosk build. Everything ships in-bundle: no runtime calls leave the machine,
 * no remote images, no font CDN at request time. See docs/OFFLINE.md.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    // All scheme / APM marks are inline SVG components, so the optimizer is unused.
    unoptimized: true,
  },
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
};

export default nextConfig;
