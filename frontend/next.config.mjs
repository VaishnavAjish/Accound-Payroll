/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  compress: true,
  poweredByHeader: false,
  outputFileTracingRoot: process.cwd(),
  allowedDevOrigins: ['192.168.1.95', '192.168.1.205', 'localhost'],
  reactStrictMode: false,
  devIndicators: {
    buildActivity: false,
    appIsrStatus: false,
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'react-icons'],
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        poll: false,
        aggregateTimeout: 200,
      };
    }
    return config;
  },
};

export default nextConfig;
