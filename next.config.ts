import type { NextConfig } from 'next';

/**
 * Two build targets, because the app is deployable two ways and they need
 * different output.
 *
 *   BUILD_TARGET=static      -> `out/` (and `npm run build:static` also copies
 *                               to `dist/`). No server, so no /api route: the
 *                               plain-English parse degrades to a disabled
 *                               button and nothing else changes. This is the
 *                               recommended target — see deploy/README.md.
 *
 *   BUILD_TARGET=standalone  -> `.next/standalone`, a self-contained Node server
 *                               for a container on ECS. Keeps the /api route, so
 *                               it can use ANTHROPIC_API_KEY.
 *
 *   unset                    -> ordinary local dev and `npm run kiosk`.
 *
 * Everything ships in-bundle regardless: no runtime call leaves the machine, no
 * remote images, no font CDN at request time. That is a requirement rather than
 * an optimisation — see the confidentiality section of README.md.
 */
const target = process.env.BUILD_TARGET;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  ...(target === 'static' ? { output: 'export' as const } : {}),
  ...(target === 'standalone' ? { output: 'standalone' as const } : {}),

  /**
   * Emit `out/book/index.html` rather than `out/book.html`. S3 resolves a
   * directory to its index document but will not silently append `.html`, so
   * without this `/book` 404s on S3 while working perfectly in dev — the worst
   * kind of deploy surprise.
   */
  trailingSlash: target === 'static',

  images: {
    // Every mark is an inline SVG component, so the optimizer is unused — and it
    // would need a server, which the static target does not have.
    unoptimized: true,
  },

  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
};

export default nextConfig;
