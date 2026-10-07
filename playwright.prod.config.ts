import path from 'node:path';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * The same demo-path suite, against the PRODUCTION build: `apps/web/dist` served by the API server with
 * NODE_ENV=production — strict CSP, same origin, DEMO banner on. Any CSP violation is a console error, which
 * fails the suite (see e2e/helpers.ts).
 *
 *   npm run build && npm run e2e:prod
 *   MATRA_E2E_DB=/some/scratch.db npm run e2e:prod
 */
const PORT = Number(process.env.MATRA_E2E_PROD_PORT) || 4300;
const DB = process.env.MATRA_E2E_DB || path.resolve('e2e/.data/e2e-prod.db');
// Throwaway pepper for this isolated test stack only. Real deployments set their own secret.
const PEPPER = 'e2e-prod-only-pepper-not-a-secret-0123456789';
const env = `NODE_ENV=production MATRA_PEPPER=${PEPPER} MATRA_DB_PATH="${DB}"`;

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: `http://localhost:${PORT}` },
  webServer: [
    {
      command: [
        `test -f apps/web/dist/index.html || (echo "run npm run build first" >&2; exit 1)`,
        `rm -f "${DB}" "${DB}-wal" "${DB}-shm"`,
        `mkdir -p "${path.dirname(DB)}"`,
        `${env} npm run seed --silent`,
        `${env} PORT=${PORT} MATRA_AUTO_VERIFY_ATTORNEYS=1 MATRA_DEMO_BANNER=1 npm start --silent`,
      ].join(' && '),
      url: `http://localhost:${PORT}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
