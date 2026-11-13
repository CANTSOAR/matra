import path from 'node:path';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * The same demo-path suite, against the PRODUCTION build: `apps/web/dist` served by the API server with
 * NODE_ENV=production — strict CSP, same origin, DEMO banner on. Any CSP violation is a console error, which
 * fails the suite (see e2e/helpers.ts).
 *
 *   MATRA_DEMO_MODE=1 npm run build && npm run e2e:prod   (a production build must pin the matcher unless it is a demo)
 *   MATRA_E2E_DB=/some/scratch.db npm run e2e:prod
 */
const PORT = Number(process.env.MATRA_E2E_PROD_PORT) || 4300;
const DB = process.env.MATRA_E2E_DB || path.resolve('e2e/.data/e2e-prod.db');
// Throwaway pepper for this isolated test stack only. Real deployments set their own secret.
const PEPPER = 'e2e-prod-only-pepper-not-a-secret-0123456789';
// Throwaway threshold OPRF keys (production refuses to start without them, and never generates them): a fresh 2-of-3
// dealer ceremony into e2e/.keys/ on every run (outside the DB directory), plus a holder-token key. The three key
// holders run as SEPARATE processes (src/holder-server.ts, ports 4311–4313, each with its own quota DB), and the app
// server talks to them in remote mode, exactly as a multi-institution deployment would. No release delay, so the
// sealed-match scenario can see its group immediately.
const KEYS = path.resolve('e2e/.keys');
const HOLDER_PORT = Number(process.env.MATRA_E2E_HOLDER_PORT) || 4310;
const holders = [1, 2, 3];
const ceremony = `npm run -s -w @matra/server oprf-ceremony -- --threshold 2 --holders 3 --out "${KEYS}" --force --token-key > "${KEYS}/public.json"`;
const pub = (expr: string) => `$(node -p "const p = require('${KEYS}/public.json'); ${expr}")`;
const holderCmd = (i: number) =>
  `NODE_ENV=production MATRA_HOLDER_INDEX=${i} MATRA_OPRF_SHARE_FILE="${KEYS}/oprf-share-${i}.key" MATRA_HOLDER_TOKEN_PUBKEY="${pub('p.holderTokenPublicKey')}" ` +
  `MATRA_HOLDER_DB_PATH="${path.dirname(DB)}/holder-${i}.db" PORT=${HOLDER_PORT + i} npm run -s -w @matra/server holder`;
const waitFor = (i: number) => `until curl -sf http://127.0.0.1:${HOLDER_PORT + i}/health >/dev/null; do sleep 0.2; done`;
// Phone verification (W13): production refuses the mock SMS provider unless MATRA_DEMO_MODE=1 (this stack is a
// fictional-data demo, and the scenarios read the mock's on-screen code), and needs a phone-token key outside the DB dir.
const phoneKey = `node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > "${KEYS}/phone-hash.key"`;
// The matcher (W18) runs as its OWN process too (apps/matcher, port 4320, its own DB), with a SIMULATED attestation
// (production allows that only with MATRA_DEMO_MODE=1). The app server pins its platform key and its measurement, as a
// production deployment with a separate matcher must.
const MATCHER_PORT = Number(process.env.MATRA_E2E_MATCHER_PORT) || 4320;
const rand = (f: string) => `node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > "${KEYS}/${f}"`;
const matcherKeys = ['matcher.key', 'matcher-token.key', 'attestation-platform.key'].map(rand).join(' && ');
const matcherSecrets = `MATRA_MATCHER_KEY_FILE="${KEYS}/matcher.key" MATRA_MATCHER_TOKEN_FILE="${KEYS}/matcher-token.key" MATRA_ATTESTATION_PLATFORM_KEY_FILE="${KEYS}/attestation-platform.key"`;
const matcherCmd =
  `NODE_ENV=production MATRA_DEMO_MODE=1 ${matcherSecrets} MATRA_MATCHER_DB_PATH="${path.dirname(DB)}/matcher.db" ` +
  `MATRA_MATCH_RELEASE_DELAY_HOURS=0 PORT=${MATCHER_PORT} npm run -s -w @matra/matcher start`;
const matcherPins =
  `MATRA_MATCHER_URL=http://127.0.0.1:${MATCHER_PORT} MATRA_MATCHER_TOKEN_FILE="${KEYS}/matcher-token.key" ` +
  `MATRA_ATTESTATION_PLATFORM_PUBKEY="$(MATRA_ATTESTATION_PLATFORM_KEY_FILE="${KEYS}/attestation-platform.key" npm run -s -w @matra/matcher measure -- --platform-pubkey)" ` +
  `MATRA_MATCHER_MEASUREMENT="$(npm run -s -w @matra/matcher measure)"`;
const env =
  `${matcherPins} NODE_ENV=production MATRA_DEMO_MODE=1 MATRA_SMS_PROVIDER=mock MATRA_PHONE_HASH_KEY_FILE="${KEYS}/phone-hash.key" MATRA_PEPPER=${PEPPER} MATRA_DB_PATH="${DB}" MATRA_MATCH_RELEASE_DELAY_HOURS=0 ` +
  `MATRA_OPRF_HOLDER_URLS=${holders.map((i) => `http://127.0.0.1:${HOLDER_PORT + i}`).join(',')} ` +
  `MATRA_OPRF_SHARE_PUBKEYS="${pub("p.holders.map((h) => h.publicKey).join(',')")}" MATRA_HOLDER_TOKEN_KEY_FILE="${KEYS}/holder-token.key"`;

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: `http://localhost:${PORT}` },
  webServer: [
    {
      command: [
        `test -f apps/web/dist/index.html || (echo "run npm run build first" >&2; exit 1)`,
        `rm -f "${DB}" "${DB}-wal" "${DB}-shm" "${path.dirname(DB)}"/holder-*.db* "${path.dirname(DB)}"/matcher.db*`,
        `mkdir -p "${path.dirname(DB)}" "${KEYS}"`,
        ceremony,
        phoneKey,
        matcherKeys,
        // holders and the matcher in the background (Playwright stops the whole process group at the end of the run)
        `(${holders.map((i) => `${holderCmd(i)} &`).join(' ')} ${matcherCmd} & true)`,
        ...holders.map(waitFor),
        `until curl -sf http://127.0.0.1:${MATCHER_PORT}/v1/health >/dev/null; do sleep 0.2; done`,
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
