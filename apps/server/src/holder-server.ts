/**
 * Process entrypoint for one standalone OPRF key holder (`npm run -w @matra/server holder`). See src/holder.ts for
 * what it does and src/config.ts loadHolderSettings for its environment. In production it refuses to start without its
 * share and the app server's pinned token public key.
 */
import { createHolderApp } from './holder.js';
import { loadHolderSettings } from './config.js';

const s = loadHolderSettings();
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const app = createHolderApp({ index: s.index, share: s.share, tokenPublicKey: s.tokenPublicKey, dbPath: s.dbPath, limits: s.limits, dailyBudget: s.dailyBudget, logRequests: process.env.MATRA_LOG_REQUESTS !== '0' });
const server = app.listen(s.port, host, () => {
  console.log(`[matra] OPRF key holder ${s.index} on http://${host}:${s.port}  (quota db: ${s.dbPath}, daily budget: ${s.dailyBudget})`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
