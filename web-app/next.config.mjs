/** @type {import('next').NextConfig} */
const nextConfig = {
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
};

export default nextConfig;