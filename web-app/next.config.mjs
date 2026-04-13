/** @type {import('next').NextConfig} */
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5100/api';
const apiOrigin = (() => {
  try { return new URL(apiUrl).origin; } catch { return apiUrl; }
})();

const nextConfig = {
  experimental: {
    instrumentationHook: false,
    optimizePackageImports: ['lucide-react'],
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
          key: 'Cache-Control',
          value: 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          },
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization, X-Requested-With, X-PostHog-Token, Accept, Accept-Language, Content-Language',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'unsafe-none',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin-allow-popups',
          },
          {
            key: 'Content-Security-Policy',
            value: `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://us-assets.i.posthog.com https://us.i.posthog.com; connect-src 'self' ${apiOrigin} https://us.i.posthog.com https://us.posthog.com https://*.r2.cloudflarestorage.com; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-src 'self'`,
          },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: 'learno-pdf-document.s3.ap-south-1.amazonaws.com'
      },
      {
        protocol: "https",
        hostname: "www.google.com",
      },
      {
        protocol: "https",
        hostname: "learno-pdf-document.s3.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "us.i.posthog.com",
      },
      {
        protocol: "https",
        hostname: "app.posthog.com",
      },
    ],
  },
  onDemandEntries: {
    maxInactiveAge: 25 * 1000,
    pagesBufferLength: 2,
  },
  webpack: (config, { dev, isServer }) => {
    if (!dev && !isServer) {
      config.optimization.splitChunks = {
        chunks: 'all',
        cacheGroups: {
          default: {
            minChunks: 2,
            priority: -20,
            reuseExistingChunk: true
          },
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            priority: -10,
            chunks: 'all'
          }
        }
      };
    }
    return config;
  },
};

export default nextConfig;
