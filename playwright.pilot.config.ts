import path from 'node:path';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * The pilot: sealed matching OFF end to end (MATRA_MATCHING=off on the API server and in the web app; e2e/pilot.spec.ts).
 * Its own API (port 4600), database and Vite (port 5178), so it runs next to the other suites without touching them.
 * The seed makes no counselors here (seed.ts), and the server loads no OPRF, phone or matcher configuration at all.
 *
 *   npm run e2e:pilot   (also part of `npm run e2e`)
 */
const API_PORT = Number(process.env.MATRA_E2E_PILOT_API_PORT) || 4600;
const WEB_PORT = Number(process.env.MATRA_E2E_PILOT_WEB_PORT) || 5178;
const DB = process.env.MATRA_E2E_PILOT_DB || path.resolve('e2e/.data/e2e-pilot.db');
/** Draft slots' file beside it (apps/server/src/slots.ts draftsDbPathFor). */
const DRAFTS = DB.replace(/\.db$/, '') + '-drafts.db';

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: 'pilot.spec.ts',
  use: { ...base.use, baseURL: `http://localhost:${WEB_PORT}` },
  webServer: [
    {
      command: [
        `rm -f "${DB}" "${DB}-wal" "${DB}-shm" "${DRAFTS}" "${DRAFTS}-wal" "${DRAFTS}-shm"`,
        `mkdir -p "${path.dirname(DB)}"`,
        `MATRA_MATCHING=off MATRA_DB_PATH="${DB}" npm run seed --silent`,
        `MATRA_MATCHING=off MATRA_DB_PATH="${DB}" PORT=${API_PORT} MATRA_AUTO_VERIFY_ATTORNEYS=1 npx tsx apps/server/src/index.ts`,
      ].join(' && '),
      url: `http://localhost:${API_PORT}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `MATRA_MATCHING=off MATRA_WEB_NO_HMR=1 MATRA_WEB_PORT=${WEB_PORT} MATRA_API_URL=http://localhost:${API_PORT} npm run dev -w @matra/web`,
      url: `http://localhost:${WEB_PORT}`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
