import path from 'node:path';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * The demo path on the DEMO STACK itself (`npm run demo`, docs/DEMO_SCRIPT.md): three separate OPRF key holders, a
 * separate matcher with simulated attestation, the app server, every one with NODE_ENV=production + MATRA_DEMO_MODE=1
 * + MATRA_INSPECTOR=1, the seeded fictional accounts, and the web app pinned to that stack's keys and matcher. Its own
 * directory (e2e/.demo, reset on every run) and ports, so it never touches a demo you are running.
 *
 *   npm run e2e:demo   (also the second half of `npm run e2e`)
 */
const WEB = Number(process.env.MATRA_E2E_DEMO_WEB_PORT) || 5176;
const ports = { MATRA_DEMO_API_PORT: '4500', MATRA_DEMO_WEB_PORT: String(WEB), MATRA_DEMO_HOLDER_PORT: '4510', MATRA_DEMO_MATCHER_PORT: '4520' };
const env = Object.entries({ MATRA_DEMO_DIR: path.resolve('e2e/.demo'), ...ports })
  .map(([k, v]) => `${k}="${v}"`)
  .join(' ');

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: 'demo-stack.spec.ts',
  use: { ...base.use, baseURL: `http://localhost:${WEB}` },
  webServer: [
    {
      command: `${env} node scripts/demo.mjs --reset`,
      url: `http://localhost:${WEB}`,
      timeout: 240_000,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
