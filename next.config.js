const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  
  // Use standalone output to avoid static generation issues
  output: 'standalone',
  
  // Optimize for production
  compress: true,
  
  // Image optimization
  images: {
    domains: [],
    formats: ['image/avif', 'image/webp'],
    unoptimized: true,
  },
  
  // Experimental features (Next.js 14 syntax)
  experimental: {
    optimizePackageImports: ['lucide-react', 'chart.js', 'react-chartjs-2'],
    // External packages — prevents webpack from bundling native node modules
    serverComponentsExternalPackages: ['pino', 'pino-pretty', 'thread-stream', 'sonic-boom'],
  },
  
  // Environment variables that should be available on the client
  env: {
    NEXT_PUBLIC_APP_NAME: 'ERP System',
  },
  
  // Webpack configuration - Critical for Vercel path resolution
  webpack: (config, { isServer }) => {
    // Fixes npm packages that depend on `fs` module
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    
    // Critical: Use absolute paths for aliases
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(__dirname),
      '@/lib': path.resolve(__dirname, 'lib'),
      '@/components': path.resolve(__dirname, 'components'),
      '@/app': path.resolve(__dirname, 'app'),
    };
    
    return config;
  },
  
  // Ignore ESLint during builds (warnings only, no logic errors)
  eslint: {
    ignoreDuringBuilds: true,
  },
  // TypeScript errors fail the build (ensures type safety)
  typescript: {
    ignoreBuildErrors: false,
  },
  headers: async () => {
    const securityHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-XSS-Protection', value: '1; mode=block' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=(), interest-cohort=()' },
      { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
      { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https: ws:; frame-ancestors 'none'; base-uri 'self'; form-action 'self';" },
    ];

    return [
      {
        source: '/_next/static/:path*',
        headers: securityHeaders,
      },
      {
        source: '/_next/image/:path*',
        headers: securityHeaders,
      },
      {
        source: '/favicon.ico',
        headers: securityHeaders,
      },
    ];
  },
};

nextConfig.redirects = async () => [
  // Redirect legacy /erp/* routes to new canonical routes
  { source: '/erp/dashboard', destination: '/dashboard', permanent: false },
  { source: '/erp/sales/invoices', destination: '/sales/invoices', permanent: false },
  { source: '/erp/sales/invoices/create', destination: '/sales/invoices/new', permanent: false },
  { source: '/erp/sales/orders', destination: '/sales/invoices', permanent: false },
  { source: '/erp/sales/orders/create', destination: '/sales/invoices/new', permanent: false },
  { source: '/erp/sales/quotations', destination: '/sales/invoices', permanent: false },
  { source: '/erp/purchases/invoices', destination: '/purchases/invoices', permanent: false },
  { source: '/erp/purchases/invoices/create', destination: '/purchases/invoices', permanent: false },
  { source: '/erp/purchases/orders', destination: '/purchases/invoices', permanent: false },
  { source: '/erp/purchases/orders/create', destination: '/purchases/invoices', permanent: false },
  { source: '/erp/inventory/products', destination: '/inventory/products', permanent: false },
  { source: '/erp/inventory/products/create', destination: '/inventory/products', permanent: false },
  { source: '/erp/accounting/journal', destination: '/accounting/journal-entries', permanent: false },
  { source: '/erp/accounting/journal/create', destination: '/accounting/journal-entries', permanent: false },
];

module.exports = nextConfig;
