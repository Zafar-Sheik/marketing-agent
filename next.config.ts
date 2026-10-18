import type { NextConfig } from 'next';

const config: NextConfig = {
  // PGlite ships WebAssembly and must not be bundled.
  serverExternalPackages: ['@electric-sql/pglite', '@electric-sql/pglite-pgvector'],
  images: { remotePatterns: [{ protocol: 'https', hostname: '**.amazonaws.com' }] },
};

export default config;
