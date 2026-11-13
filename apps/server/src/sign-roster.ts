/**
 * Admin CLI: sign the current lists of verified people with the ORGANIZATION's Ed25519 key, and store them where the
 * app serves them (org-signing.ts):
 *   - the Legal Options Counselor roster (RSA public keys and licensed states; review M4) → /api/matching/config
 *   - the attorney directory (names and key fingerprints; threat model W3)                 → /api/attorneys
 *
 *   npm run -w @matra/server sign-roster -- --generate        print a NEW org key pair (do this once, offline)
 *   npm run -w @matra/server sign-roster                       sign the verified counselors and attorneys and store both
 *   npm run -w @matra/server sign-roster -- --dry-run          print both lists without storing them
 *
 * The org secret key comes from MATRA_COUNSELOR_ROSTER_SIGNING_KEY (64 hex chars) or
 * MATRA_COUNSELOR_ROSTER_SIGNING_KEY_FILE, provided ONLY for this invocation, by the person responsible for verifying
 * counselors and attorneys. It must never be stored on the server or in its environment: the point is that the app
 * server (and whoever controls it) cannot add a counselor or attorney, or swap a key, without this signature. The
 * matching public key is pinned into the web build (MATRA_COUNSELOR_ROSTER_PUBKEY, base64); survivors' clients then
 * seal only to listed counselors and share only with listed attorneys, with the listed keys. Re-run after verifying or
 * removing anyone (or anyone changing keys); verify-attorney does it for you when given the key. Honors MATRA_DB_PATH.
 */
import fs from 'node:fs';
import { generateRosterKey, rosterPublicKey, toBase64, toHex } from '@matra/crypto';
import { openDb } from './db.js';
import { resolveDbPath } from './config.js';
import { orgSigningKeyFromEnv, signOrgLists, storeOrgLists } from './org-signing.js';

const args = process.argv.slice(2);
if (args.includes('--generate')) {
  const k = generateRosterKey();
  console.log('Organization signing key pair (counselor roster and attorney directory). Keep the SECRET offline; never put it on the server.');
  console.log(`  secret (MATRA_COUNSELOR_ROSTER_SIGNING_KEY): ${toHex(k.secretKey)}`);
  console.log(`  public (MATRA_COUNSELOR_ROSTER_PUBKEY, web build): ${toBase64(k.publicKey)}`);
  process.exit(0);
}

let secretKey: Uint8Array | undefined;
try {
  secretKey = orgSigningKeyFromEnv(process.env, (p) => fs.readFileSync(p, 'utf8'));
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
if (!secretKey) {
  console.error('Set MATRA_COUNSELOR_ROSTER_SIGNING_KEY (64 hex chars) or MATRA_COUNSELOR_ROSTER_SIGNING_KEY_FILE. Generate one with --generate.');
  process.exit(1);
}
const publicKey = toBase64(rosterPublicKey(secretKey));
const pinned = process.env.MATRA_COUNSELOR_ROSTER_PUBKEY;
if (pinned && pinned !== publicKey) {
  console.error(`This signing key's public key (${publicKey}) is not MATRA_COUNSELOR_ROSTER_PUBKEY (${pinned}). Refusing.`);
  process.exit(1);
}

const db = openDb(resolveDbPath());
const lists = signOrgLists(db, secretKey);
secretKey.fill(0);
console.log(`Counselors in the roster (${lists.counselors.length}):`);
for (const c of lists.counselors)
  console.log(`  ${c.displayName}${c.organization ? ` · ${c.organization}` : ''}  licensed: ${c.licensedStates.join(', ') || 'none'}  (${c.userId})`);
console.log(`Attorneys in the directory (${lists.attorneys.length}):`);
for (const a of lists.attorneys) console.log(`  ${a.displayName}${a.organization ? ` · ${a.organization}` : ''}  key ${a.fingerprint}  (${a.userId})`);
if (args.includes('--dry-run')) {
  console.log(JSON.stringify({ roster: lists.roster, directory: lists.directory }, null, 2));
} else {
  storeOrgLists(db, lists);
  console.log(`Stored the signed roster and attorney directory (org public key ${publicKey}). Seals for counselors not listed are deleted on next use.`);
}
db.close();
