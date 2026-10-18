import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    setupFiles: ['src/test/setup.ts'],
    // next-auth imports 'next/server' without an extension; let Vite resolve it.
    server: { deps: { inline: ['next-auth', '@auth/core'] } },
  },
});
