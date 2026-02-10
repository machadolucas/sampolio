import type { NextConfig } from "next";

const securityHeaders = [
  // Prevent XSS attacks
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block',
  },
  // Prevent clickjacking
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  // Prevent MIME type sniffing
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  // Control referrer information
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  // Prevent DNS prefetch to avoid leaking hostnames
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on',
  },
  // Restrict browser features
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  },
  // Force HTTPS (should be set by proxy, but also set here as fallback)
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  },
  // Content Security Policy
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Required for Next.js
      "style-src 'self' 'unsafe-inline'", // Required for PrimeReact
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  // Enable standalone output for single-file deployment
  output: 'standalone',

  // Enable Next.js 16 Cache Components ("use cache" directive)
  cacheComponents: true,

  // Custom cache lifetime profiles
  cacheLife: {
    // Data never expires by time — only invalidated via updateTag or admin button
    indefinite: {
      stale: 31536000,    // 1 year
      revalidate: 31536000,
      expire: 31536000,   // 1 year (effectively indefinite)
    },
  },

  // Disable image optimization for self-hosted deployment
  images: {
    unoptimized: true,
  },

  // Server external packages for file system operations
  serverExternalPackages: ['bcryptjs'],

  // Security headers for all routes
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },

  // Disable x-powered-by header
  poweredByHeader: false,
};

export default nextConfig;
