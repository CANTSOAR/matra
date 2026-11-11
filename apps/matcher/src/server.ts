/**
 * Process entrypoint for the matcher service (`npm run -w @matra/matcher start`). See src/matcher.ts for what it does,
 * src/config.ts for its environment, and src/app.ts for its API. Production refuses to start without its key and
 * token, and refuses the simulated attester unless MATRA_DEMO_MODE=1.
 */
import { createMatcher } from './index.js';
import { createMatcherApp } from './app.js';
import { loadMatcherSettings } from './config.js';

const s = loadMatcherSettings();
const { matcher } = createMatcher({ dbPath: s.dbPath, keys: s.keys, releaseDelayMs: s.releaseDelayMs, rosterKey: s.rosterKey });
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const app = createMatcherApp({ matcher, attester: s.attester, token: s.token, logRequests: process.env.MATRA_LOG_REQUESTS !== '0' });
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
