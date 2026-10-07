import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests for the live demo path. They run against an ISOLATED stack — its own API
 * (port 4100) and database, its own Vite (port 5174) — so they never touch the dev DB.
 *
 *   npm run e2e                      (starts, wipes and seeds its own stack)
 *   MATRA_E2E_DB=/tmp/x.db npm run e2e
 *   MATRA_E2E_SCREENS=/tmp/screens npm run e2e   (where full-page screenshots go)
 */
const API_PORT = Number(process.env.MATRA_E2E_API_PORT) || 4100;
const WEB_PORT = Number(process.env.MATRA_E2E_WEB_PORT) || 5174;
const DB = process.env.MATRA_E2E_DB || path.resolve('e2e/.data/e2e.db');

export default defineConfig({
  testDir: './e2e',
  // Key derivation (600k PBKDF2 iterations) takes seconds per sign-in.
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: [
    {
      // Fresh DB every run so the suite is repeatable, then seed demo accounts, then serve.
      command: [
        `rm -f "${DB}" "${DB}-wal" "${DB}-shm"`,
        `mkdir -p "${path.dirname(DB)}"`,
        `MATRA_DB_PATH="${DB}" npm run seed --silent`,
        // No sealed-match release delay in tests (production default: 72 h), so test 5 sees its group immediately.
        `MATRA_DB_PATH="${DB}" PORT=${API_PORT} MATRA_AUTO_VERIFY_ATTORNEYS=1 MATRA_MATCH_RELEASE_DELAY_HOURS=0 npx tsx apps/server/src/index.ts`,
      ].join(' && '),
      url: `http://localhost:${API_PORT}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `MATRA_WEB_NO_HMR=1 MATRA_WEB_PORT=${WEB_PORT} MATRA_API_URL=http://localhost:${API_PORT} npm run dev -w @matra/web`,
      url: `http://localhost:${WEB_PORT}`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
