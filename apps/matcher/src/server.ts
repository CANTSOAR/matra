/**
 * Process entrypoint for the matcher service (`npm run -w @matra/matcher start`). See src/matcher.ts for what it does,
 * src/config.ts for its environment, and src/app.ts for its API. Production refuses to start without its key and
 * token, and refuses the simulated attester unless MATRA_DEMO_MODE=1.
 */
import { createMatcher } from './index.js';
import { createMatcherApp } from './app.js';
import { loadMatcherSettings } from './config.js';
import { matcherDebugState } from './debug.js';
import { inspectorEnabled } from '@matra/shared';

const s = loadMatcherSettings();
const { matcher, store } = createMatcher({ dbPath: s.dbPath, keys: s.keys, releaseDelayMs: s.releaseDelayMs, rosterKey: s.rosterKey });
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
// MATRA_INSPECTOR=1 (development, or a fictional-data demo): GET /v1/debug/state for the "what the server sees" page.
const debugState = inspectorEnabled(process.env) ? () => matcherDebugState(store, s.attester) : undefined;
if (debugState) console.warn('[matcher] MATRA_INSPECTOR=1 — /v1/debug/state shows everything this matcher holds (dev / demo only).');
const app = createMatcherApp({ matcher, attester: s.attester, token: s.token, logRequests: process.env.MATRA_LOG_REQUESTS !== '0', debugState });
const server = app.listen(s.port, host, () => {
  console.log(`[matcher] on http://${host}:${s.port}  (db: ${s.dbPath}, attestation: ${s.attester.platform}, measurement ${s.attester.measurement})`);
  if (s.attester.platform === 'simulated')
    console.warn(`[matcher] SIMULATED attestation (platform key ${s.platformPublicKey}): not hardware attestation; fictional data only.`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
