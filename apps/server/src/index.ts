import fs from 'node:fs';
import { createApp, flushPhoneTokens } from './app.js';
import {
  WEB_DIST_DIR,
  loadDemoMode,
  loadMatcherConfig,
  loadMatchingSettings,
  loadOprfLimits,
  loadOprfThreshold,
  loadPepper,
  loadPhoneVerification,
  resolveDbPath,
} from './config.js';
import { RemoteHolderPool } from './holders.js';

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
// MATRA_DEMO_MODE=1 (fictional data only) always shows the DEMO banner; it is also what lets mock providers run in production.
const demoMode = loadDemoMode();
if (demoMode) console.warn('[matra] MATRA_DEMO_MODE=1 — fictional-data demo: mock/simulated providers allowed, DEMO banner on.');
const demoBanner = process.env.MATRA_DEMO_BANNER === '1' || demoMode;
const trustProxy = Number(process.env.MATRA_TRUST_PROXY) || 0;

// Threshold OPRF key holders: all m shares in this process (dev / single-host demo), or m remote holder processes
// (MATRA_OPRF_HOLDER_URLS). Production refuses to start without every share or the pinned remote config, and never
// generates shares; see config.ts loadOprfThreshold and docs/DEPLOY.md.
const oprf = loadOprfThreshold();
const pepper = loadPepper();
// SMS phone verification before sealed matching (W13): production refuses the mock provider unless MATRA_DEMO_MODE=1,
// and refuses to start without MATRA_PHONE_HASH_KEY (src/sms.ts, docs/DEPLOY.md).
const phone = loadPhoneVerification();
console.log(`[matra] sealed matching: phone verification ${phone.required ? `required (${phone.verifier.name} SMS provider)` : 'OFF (development)'}`);
const matchingSettings = loadMatchingSettings();
// The matcher service (W15, W18): a separate process (MATRA_MATCHER_URL), or in-process with simulated attestation,
// which production refuses unless MATRA_DEMO_MODE=1.
const matcher = loadMatcherConfig(process.env, { releaseDelayHours: matchingSettings.releaseDelayHours });
console.log(`[matra] sealed matching: ${matcher.description}`);
if (oprf.remote) {
  // Each reachable holder must serve exactly its pinned share public key; a down holder only warns (t of m suffice).
  const { reachable } = await new RemoteHolderPool(oprf.t, oprf.remote, pepper).verifyKeys();
  console.log(`[matra] OPRF: ${oprf.t}-of-${oprf.m} remote key holders, ${reachable} reachable`);
} else if (production) {
  console.warn(`[matra] WARNING: all ${oprf.m} OPRF key shares are loaded into this process: no separation against the operator (docs/threat-model.md W14).`);
}

const app = createApp({
  dbPath,
  pepper,
  corsOrigins,
  autoVerifyAttorneys,
  logRequests: true,
  webDir,
  demoBanner,
  trustProxy,
  matching: {
    oprf,
    limits: loadOprfLimits(),
    ...matchingSettings,
    matcher: { client: matcher.client, pins: matcher.pins },
    requirePhoneVerification: phone.required,
    phone: {
      verifier: phone.verifier,
      hashKey: phone.hashKey,
      maxAccountsPerPhone: phone.maxAccountsPerPhone,
      exposeDemoCode: phone.exposeDemoCode,
      allowedCountryCodes: phone.allowedCountryCodes,
      sendLimits: phone.sendLimits,
    },
  },
});

const onListen = () => {
  console.log(`[matra] ${production ? 'production' : 'dev'} server on http://${host ?? 'localhost'}:${port}  (db: ${dbPath})`);
  if (webDir) console.log(`[matra] serving web app from ${webDir}${demoBanner ? ' with the DEMO banner' : ''}`);
};
const server = host ? app.listen(port, host, onListen) : app.listen(port, onListen);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    flushPhoneTokens(app); // buffered phone-token counts (W19) would otherwise be lost
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
