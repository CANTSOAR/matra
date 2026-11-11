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
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB_DIR, DIR, HOLDERS, KEYS, PUBLIC, THRESHOLD, TSX, appEnv, assertSafe, run, startBackends, stopAll } from './demo-lib.mjs';

export async function demoReset() {
  assertSafe();
  console.log(`[demo:reset] ${DIR}: deleting the demo databases and keys`);
  fs.rmSync(DB_DIR, { recursive: true, force: true });
  fs.rmSync(KEYS, { recursive: true, force: true });
  fs.mkdirSync(DB_DIR, { recursive: true });
  fs.mkdirSync(KEYS, { recursive: true, mode: 0o700 });

  const env = { ...process.env, MATRA_DB_PATH: path.join(DB_DIR, 'matra.db') };
  // 2-of-3 threshold OPRF: one share file per key holder (packages/crypto threshold.ts), plus the holder-token key
  const ceremony = JSON.parse(
    await run(TSX, ['apps/server/src/oprf-ceremony.ts', '--threshold', String(THRESHOLD), '--holders', String(HOLDERS.length), '--out', KEYS, '--force', '--token-key'], env),
  );
  const secret = (f) => fs.writeFileSync(path.join(KEYS, f), randomBytes(32).toString('hex'), { mode: 0o600 });
  for (const f of ['pepper.key', 'phone-hash.key', 'matcher.key', 'matcher-token.key', 'attestation-platform.key']) secret(f);
  // The demo organization's roster key (sign-roster --generate): the secret is given only to the seed, which signs the roster.
  const roster = await run(TSX, ['apps/server/src/sign-roster.ts', '--generate'], env);
  const rosterSecret = /secret[^:]*:\s*([0-9a-f]{64})/.exec(roster)?.[1];
  const rosterPublicKey = /public[^:]*:\s*(\S+)/.exec(roster)?.[1];
  if (!rosterSecret || !rosterPublicKey) throw new Error('could not read the generated roster key');
  fs.writeFileSync(path.join(KEYS, 'roster-signing.key'), rosterSecret, { mode: 0o600 });
  const platformPublicKey = (
    await run(TSX, ['apps/matcher/src/measure-cli.ts', '--platform-pubkey'], { ...env, MATRA_ATTESTATION_PLATFORM_KEY_FILE: path.join(KEYS, 'attestation-platform.key') })
  ).trim();
  const measurement = (await run(TSX, ['apps/matcher/src/measure-cli.ts'], env)).trim();
  const pub = { ...ceremony, rosterPublicKey, platformPublicKey, measurement, createdAt: new Date().toISOString() };
  fs.writeFileSync(PUBLIC, JSON.stringify(pub, null, 2));
  console.log(`[demo:reset] pins: OPRF ${pub.t}-of-${pub.m} group key ${pub.groupPublicKey}`);
  console.log(`[demo:reset]       roster key ${rosterPublicKey}, simulated platform key ${platformPublicKey}`);
  console.log(`[demo:reset]       matcher measurement ${measurement}`);

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
