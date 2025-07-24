/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable experimental tracing to avoid Windows permission issues
  experimental: {
    instrumentationHook: false,
  },
  // Add headers for CORS and PostHog - Open for all origins
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
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
  // Improve chunk loading and reduce hydration issues
  experimental: {
    // Disable some experimental features that might cause issues
    optimizePackageImports: [],
  },
  // Better error handling for chunk loading
  onDemandEntries: {
    maxInactiveAge: 25 * 1000,
    pagesBufferLength: 2,
  },
  // Optimize chunks
  webpack: (config, { dev, isServer }) => {
    if (!dev && !isServer) {
      // Optimize chunk splitting for better loading
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