/**
 * Dealer key ceremony for the threshold OPRF (W14):
 *
 *   npm run -w @matra/server oprf-ceremony -- --threshold 2 --holders 3 --out <dir> [--force]
 *
 * Generates a fresh OPRF key k, Shamir-splits it t-of-m over the ristretto255 scalar field (packages/crypto
 * threshold.ts), writes one file per holder, `<dir>/oprf-share-<i>.key` (64 hex chars, mode 0600), and prints the
 * public part as JSON for pinning:
 *
 *   { "t": 2, "m": 3, "groupPublicKey": "<base64>", "holders": [{ "index": 1, "publicKey": "<base64>" }, …] }
 *
 *   → app server: MATRA_OPRF_THRESHOLD=t, MATRA_OPRF_HOLDERS=m, and either MATRA_OPRF_SHARE_<i>_FILE (in-process) or
 *     MATRA_OPRF_HOLDER_URLS + MATRA_OPRF_SHARE_PUBKEYS (holders' publicKey, comma-separated, index order);
 *   → web build:  MATRA_OPRF_THRESHOLD, MATRA_OPRF_GROUP_PUBKEY, MATRA_OPRF_SHARE_PUBKEYS (pins);
 *   → holder i:   MATRA_HOLDER_INDEX=i, MATRA_OPRF_SHARE_FILE=<its file>.
 *
 * Procedure: run it OFFLINE on a machine nobody keeps; hand each share file to a DIFFERENT institution over a channel
 * only that institution can read; then delete <dir>. The dealer briefly knows k (and any t files together are k), which
 * is why the files must never travel together and why a distributed key generation (no dealer) is listed as future
 * work in docs/SECURITY_WHITEPAPER.md. The byte buffers holding k and the share keys are zeroed before this script
 * exits, but k, the polynomial coefficients and every intermediate are also JavaScript bigints, which cannot be wiped:
 * they stay in memory until garbage collection (possibly copied). Another reason to run it on an offline machine that
 * is then discarded, and to move to a DKG.
 * Refuses to write into the database directory (MATRA_DB_PATH) or over existing share files without --force.
 *
 * --token-key (single-operator demos and tests only): also writes `<dir>/holder-token.key`, a fresh Ed25519 seed for
 * the app server's MATRA_HOLDER_TOKEN_KEY_FILE, and adds its public key (MATRA_HOLDER_TOKEN_PUBKEY for the holders) to
 * the output as "holderTokenPublicKey". In a real deployment the app server's operator generates that key, not the dealer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { toBase64, toHex } from '@matra/crypto';
import { DATA_DIR, writeOprfCeremony } from './config.js';
import { holderTokenPublicKeyFromSeed } from './holders.js';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const t = Number(opt('threshold') ?? 2);
const m = Number(opt('holders') ?? 3);
const out = opt('out');
if (!out) {
  console.error('usage: oprf-ceremony --threshold <t> --holders <m> --out <dir> [--force]');
  process.exit(1);
}
const dir = path.resolve(out);
const dbDir = path.dirname(path.resolve(process.env.MATRA_DB_PATH || path.join(DATA_DIR, 'matra.db')));
const inside = (parent: string, child: string) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
if (inside(dbDir, dir)) {
  console.error(`Refusing to write OPRF shares into the database directory (${dbDir}): a copy of the DB volume must never include them.`);
  process.exit(1);
}
const existing = Array.from({ length: m }, (_, i) => path.join(dir, `oprf-share-${i + 1}.key`)).filter((f) => fs.existsSync(f));
if (existing.length && !args.includes('--force')) {
  console.error(`Share files already exist in ${dir} (${existing.map((f) => path.basename(f)).join(', ')}). Use --force to replace them.`);
  process.exit(1);
}
try {
  const pub: ReturnType<typeof writeOprfCeremony> & { holderTokenPublicKey?: string } = writeOprfCeremony(dir, t, m);
  if (args.includes('--token-key')) {
    const seed = randomBytes(32);
    fs.writeFileSync(path.join(dir, 'holder-token.key'), toHex(seed), { mode: 0o600 });
    pub.holderTokenPublicKey = toBase64(holderTokenPublicKeyFromSeed(seed));
    seed.fill(0);
  }
  console.log(JSON.stringify(pub, null, 2));
  console.error(`Wrote ${m} share files to ${dir}. Hand each to a different holder institution, then delete this directory.`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
