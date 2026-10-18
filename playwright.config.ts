import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const PORT = 3100;
// Use the pre-installed Chromium when present (cloud sandboxes), else Playwright's own.
const executablePath = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: { executablePath },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `rm -rf .data/e2e && next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/signin`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      // Fully offline: embedded Postgres, simulated providers and TikTok, agents run in-process.
      DATABASE_URL: 'pglite:./.data/e2e/db',
      MOCK_PROVIDERS: 'true',
      DISPATCH_MODE: 'inline',
      INLINE_WAIT_SCALE: '0.01',
      NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`,
      AUTH_SECRET: 'e2e-secret',
      ENCRYPTION_KEY: 'e2e-encryption-key',
      N8N_WEBHOOK_SECRET: 'e2e-webhook-secret',
      AUTH_GOOGLE_ID: '',
      AWS_ACCESS_KEY_ID: '',
    },
  },
});
