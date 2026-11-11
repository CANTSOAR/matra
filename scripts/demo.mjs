#!/usr/bin/env node
/**
 * `npm run demo`: the whole Matra stack on this machine, in demo mode, with FICTIONAL data (docs/DEMO_SCRIPT.md).
 *
 *   key holders 1–3   http://127.0.0.1:4011–4013   one OPRF key share each (2 of 3 needed), own quota DB
 *   matcher           http://127.0.0.1:4020        separate process, SIMULATED attestation, own DB
 *   app server        http://127.0.0.1:4000        stores only ciphertext; mock SMS provider; DEMO banner
 *   web app           http://localhost:5173        pinned to this demo's keys and matcher measurement
 *   Server view       http://localhost:5173/inspector
 *
 * Every service runs with NODE_ENV=production and MATRA_DEMO_MODE=1 (the only way production accepts the mock SMS
 * provider and the simulated attestation) and MATRA_INSPECTOR=1. Runs `demo:reset` first when there is no demo yet;
 * `npm run demo -- --reset` always starts from a fresh one. Ctrl-C stops everything.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DB_DIR, PORTS, PUBLIC, ROOT, TSX, VITE, appEnv, assertSafe, loadPublic, run, start, startBackends, stopAll, waitFor, webEnv } from './demo-lib.mjs';
import { demoReset } from './demo-reset.mjs';

async function main() {
  assertSafe();
  if (process.argv.includes('--reset') || !fs.existsSync(PUBLIC) || !fs.existsSync(path.join(DB_DIR, 'matra.db'))) await demoReset();
  const pub = loadPublic();
  const now = (await run(TSX, ['apps/matcher/src/measure-cli.ts'])).trim();
  if (now !== pub.measurement)
    console.warn(
      `[demo] The matcher's code changed since demo:reset (measurement ${now.slice(0, 16)}… ≠ pinned ${pub.measurement.slice(0, 16)}…). ` +
        'The web app will refuse to seal routing data to it: that is the tamper demo. Run `npm run demo -- --reset` to re-pin.',
    );

  await startBackends(pub);
  start('app', TSX, ['apps/server/src/index.ts'], appEnv(pub));
  await waitFor(`http://127.0.0.1:${PORTS.api}/api/health`, 'the app server');
  start('web', VITE, [], webEnv(pub), path.join(ROOT, 'apps', 'web'));
  await waitFor(`http://localhost:${PORTS.web}`, 'the web app');

  console.log(`
  Matra demo — FICTIONAL DATA ONLY (simulated attestation, mock SMS: not a real deployment)

    App          http://localhost:${PORTS.web}
    Server view  http://localhost:${PORTS.web}/inspector   (what each server holds, next to what was typed)

    Survivors    jane.demo (empty: the live flow) · sam.demo · morgan.demo · taylor.demo · riley.demo
                 passphrase: demo-survivor-passphrase
    Attorneys    attorney.nj1 (Riley shared with them) · attorney.ny1 · attorney.nj2
                 passphrase: demo-attorney-passphrase
    Counselors   counselor.ny (licensed NY) · counselor.nj (NJ) · counselor.pa (PA)
                 passphrase: demo-counselor-passphrase

  Ctrl-C stops everything. docs/DEMO_SCRIPT.md has the walkthrough.
`);
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => void stopAll().then(() => process.exit(0)));
main().catch(async (e) => {
  console.error(`[demo] failed: ${e.message}`);
  await stopAll();
  process.exit(1);
});
