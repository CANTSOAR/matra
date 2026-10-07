import { createApp } from './app.js';
import { loadPepper, resolveDbPath } from './config.js';

const port = Number(process.env.PORT) || 4000;
const dbPath = resolveDbPath();
const corsOrigins = process.env.MATRA_CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean);
const autoVerifyAttorneys = process.env.MATRA_AUTO_VERIFY_ATTORNEYS === '1';
if (autoVerifyAttorneys) console.warn('[matra] WARNING: MATRA_AUTO_VERIFY_ATTORNEYS=1 — new attorneys are auto-verified (dev only).');

const app = createApp({ dbPath, pepper: loadPepper(), corsOrigins, autoVerifyAttorneys, logRequests: true });

const server = app.listen(port, () => {
  console.log(`[matra] API listening on http://localhost:${port}  (db: ${dbPath})`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
