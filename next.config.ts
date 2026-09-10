/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: ['10.13.18.76:3000', 'localhost:3000'],
    },
  },
};

module.exports = nextConfig;