#!/usr/bin/env node
/**
 * `npm run demo:reset`: a fresh, fictional-data demo (docs/DEMO_SCRIPT.md, docs/design/WEEKEND_MVP.md §4.1).
 *
 *   1. deletes <dir>/db and <dir>/keys (default .demo/; refuses any directory not named ".demo", and NODE_ENV=production)
 *   2. generates the demo key material in <dir>/keys: a 2-of-3 OPRF dealer ceremony (one share file per key holder) and
 *      the holder-token key; the server pepper; the phone-token HMAC key; the matcher key and its app-server token; the
 *      SIMULATED attestation "platform" key; the demo organization's counselor-roster signing key
 *   3. records the public pins in <dir>/keys/public.json (OPRF group + share keys, roster key, platform key, and the
 *      measurement of the matcher code as it is now: change that code afterwards and the web app refuses the matcher)
 *   4. starts the three key holders and the matcher, runs the demo seed through the real API (apps/server/src/demo-seed.ts),
 *      and stops them again
 *
 * `npm run demo` runs this itself the first time. In a real deployment none of these keys would ever be on one machine.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB_DIR, DIR, KEYS, PUBLIC, TSX, appEnv, assertSafe, generateKeys, run, startBackends, stopAll } from './demo-lib.mjs';

export async function demoReset() {
  assertSafe();
  console.log(`[demo:reset] ${DIR}: deleting the demo databases and keys`);
  fs.rmSync(DB_DIR, { recursive: true, force: true });
  fs.rmSync(KEYS, { recursive: true, force: true });
  fs.mkdirSync(DB_DIR, { recursive: true });
  fs.mkdirSync(KEYS, { recursive: true, mode: 0o700 });

  const pub = await generateKeys(KEYS, { ...process.env, MATRA_DB_PATH: path.join(DB_DIR, 'matra.db') });
  fs.writeFileSync(PUBLIC, JSON.stringify(pub, null, 2));
  console.log(`[demo:reset] pins: OPRF ${pub.t}-of-${pub.m} group key ${pub.groupPublicKey}`);
  console.log(`[demo:reset]       roster key ${pub.rosterPublicKey}, simulated platform key ${pub.platformPublicKey}`);
  console.log(`[demo:reset]       matcher measurement ${pub.measurement}`);

  try {
    await startBackends(pub);
    await run(TSX, ['apps/server/src/demo-seed.ts'], { ...appEnv(pub), MATRA_COUNSELOR_ROSTER_SIGNING_KEY_FILE: path.join(KEYS, 'roster-signing.key') }).then((out) =>
      process.stdout.write(out),
    );
  } finally {
    await stopAll();
  }
  console.log(`[demo:reset] done. Start it with: npm run demo`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  demoReset().catch(async (e) => {
    console.error(`[demo:reset] failed: ${e.message}`);
    await stopAll();
    process.exit(1);
  });
}
