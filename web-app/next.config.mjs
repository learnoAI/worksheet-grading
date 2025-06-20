/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable experimental tracing to avoid Windows permission issues
  experimental: {
    instrumentationHook: false,
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