/**
 * Admin CLI: sign the current list of verified Legal Options Counselors (with their RSA public keys) with the
 * ORGANIZATION's Ed25519 key, and store the signed roster where /api/matching/config serves it (review M4).
 *
 *   npm run -w @matra/server sign-roster -- --generate        print a NEW org key pair (do this once, offline)
 *   npm run -w @matra/server sign-roster                       sign the verified counselors and store the roster
 *   npm run -w @matra/server sign-roster -- --dry-run          print the roster without storing it
 *
 * The org secret key comes from MATRA_COUNSELOR_ROSTER_SIGNING_KEY (64 hex chars) or
 * MATRA_COUNSELOR_ROSTER_SIGNING_KEY_FILE, provided ONLY for this invocation, by the person responsible for verifying
 * counselors. It must never be stored on the server or in its environment: the point is that the app server (and
 * whoever controls it) cannot add a counselor or swap a counselor's key without this signature. The matching public key
 * is pinned into the web build (MATRA_COUNSELOR_ROSTER_PUBKEY, base64); survivors' clients then seal only to listed
 * counselors. Re-run after verifying or removing a counselor (or a counselor changing keys). Honors MATRA_DB_PATH.
 */
import fs from 'node:fs';
import { generateRosterKey, rosterPublicKey, signCounselorRoster, toBase64, toHex } from '@matra/crypto';
import { openDb } from './db.js';
import { resolveDbPath } from './config.js';

const args = process.argv.slice(2);
if (args.includes('--generate')) {
  const k = generateRosterKey();
  console.log('Organization counselor-roster key pair. Keep the SECRET offline; never put it on the server.');
  console.log(`  secret (MATRA_COUNSELOR_ROSTER_SIGNING_KEY): ${toHex(k.secretKey)}`);
  console.log(`  public (MATRA_COUNSELOR_ROSTER_PUBKEY, web build): ${toBase64(k.publicKey)}`);
  process.exit(0);
}

const hex =
  process.env.MATRA_COUNSELOR_ROSTER_SIGNING_KEY ??
  (process.env.MATRA_COUNSELOR_ROSTER_SIGNING_KEY_FILE ? fs.readFileSync(process.env.MATRA_COUNSELOR_ROSTER_SIGNING_KEY_FILE, 'utf8') : undefined);
if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex.trim())) {
  console.error('Set MATRA_COUNSELOR_ROSTER_SIGNING_KEY (64 hex chars) or MATRA_COUNSELOR_ROSTER_SIGNING_KEY_FILE. Generate one with --generate.');
  process.exit(1);
}
const secretKey = Uint8Array.from(hex.trim().toLowerCase().match(/../g)!.map((b) => parseInt(b, 16)));
const publicKey = toBase64(rosterPublicKey(secretKey));
const pinned = process.env.MATRA_COUNSELOR_ROSTER_PUBKEY;
if (pinned && pinned !== publicKey) {
  console.error(`This signing key's public key (${publicKey}) is not MATRA_COUNSELOR_ROSTER_PUBKEY (${pinned}). Refusing.`);
  process.exit(1);
}

const db = openDb(resolveDbPath());
const rows = db
  .prepare(
    `SELECT c.user_id, c.display_name, c.organization, u.public_key FROM counselor_profiles c JOIN users u ON u.id = c.user_id
      WHERE c.verified = 1 ORDER BY c.display_name`,
  )
  .all() as Array<{ user_id: string; display_name: string; organization: string | null; public_key: string }>;
const roster = signCounselorRoster(
  rows.map((r) => ({ userId: r.user_id, publicKey: JSON.parse(r.public_key) as JsonWebKey })),
  secretKey,
);
console.log(`Counselors in the roster (${rows.length}):`);
for (const r of rows) console.log(`  ${r.display_name}${r.organization ? ` · ${r.organization}` : ''}  (${r.user_id})`);
if (args.includes('--dry-run')) {
  console.log(JSON.stringify(roster, null, 2));
} else {
  db.prepare(
    `INSERT INTO matching_meta (key, value) VALUES ('counselor_roster', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  ).run(JSON.stringify(roster));
  console.log(`Stored the signed roster (org public key ${publicKey}). Seals for counselors not listed are deleted on next use.`);
}
db.close();
