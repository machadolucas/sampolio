import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for single-file deployment
  output: 'standalone',
  
  // Disable image optimization for self-hosted deployment
  images: {
    unoptimized: true,
  },
  
  // Server external packages for file system operations
  serverExternalPackages: ['bcryptjs'],
};

export default nextConfig;
