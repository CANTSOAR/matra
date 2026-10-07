import fs from 'node:fs';
import { createApp } from './app.js';
import { WEB_DIST_DIR, loadMatchingSettings, loadOprfKey, loadOprfLimits, loadPepper, resolveDbPath } from './config.js';

const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT) || 4000;
const host = process.env.HOST || (production ? '0.0.0.0' : undefined);
const dbPath = resolveDbPath();
const corsOrigins = process.env.MATRA_CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean);
const autoVerifyAttorneys = process.env.MATRA_AUTO_VERIFY_ATTORNEYS === '1';
if (autoVerifyAttorneys) console.warn('[matra] WARNING: MATRA_AUTO_VERIFY_ATTORNEYS=1 — new attorneys are auto-verified (dev only).');

// Production serves the built web app from the same origin (no CORS needed). MATRA_WEB_DIR overrides the location;
// MATRA_SERVE_WEB=0 turns it off (API only), MATRA_SERVE_WEB=1 turns it on outside production.
const serveWeb = process.env.MATRA_SERVE_WEB ? process.env.MATRA_SERVE_WEB === '1' : production;
const webDir = serveWeb ? process.env.MATRA_WEB_DIR || WEB_DIST_DIR : undefined;
if (webDir && !fs.existsSync(webDir)) {
  console.error(`[matra] web app not built: ${webDir} is missing. Run \`npm run build\` first.`);
  process.exit(1);
}
const demoBanner = process.env.MATRA_DEMO_BANNER === '1';
const trustProxy = Number(process.env.MATRA_TRUST_PROXY) || 0;

const app = createApp({
  dbPath,
  pepper: loadPepper(),
  corsOrigins,
  autoVerifyAttorneys,
  logRequests: true,
  webDir,
  demoBanner,
  trustProxy,
  // Both OPRF key shares are loaded into this process for the MVP. See docs/SECURITY_WHITEPAPER.md for running them
  // as separate services with separately held keys.
  // Production refuses to start without both keys (never generated next to the DB); see config.ts / docs/DEPLOY.md.
  matching: { keyA: loadOprfKey('a'), keyB: loadOprfKey('b'), limits: loadOprfLimits(), ...loadMatchingSettings() },
});

const onListen = () => {
  console.log(`[matra] ${production ? 'production' : 'dev'} server on http://${host ?? 'localhost'}:${port}  (db: ${dbPath})`);
  if (webDir) console.log(`[matra] serving web app from ${webDir}${demoBanner ? ' with the DEMO banner' : ''}`);
};
const server = host ? app.listen(port, host, onListen) : app.listen(port, onListen);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
